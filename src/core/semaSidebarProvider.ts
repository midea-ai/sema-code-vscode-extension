import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import type { AgentMode } from 'sema-core/types';

import { SessionHistoryManager } from '../managers/SessionHistoryManager';
import { FileStateDiffManager } from '../managers/FileStateDiffManager';
import { FileOperationManager } from '../managers/FileOperationManager';
import { SystemConfigManager } from '../managers/SystemConfigManager';
import { ChatWebviewProvider } from '../webview/chat/chatWebview';
import { ConfigWebviewProvider } from '../webview/config/configWebview';
import { SessionHistoryWebviewProvider } from '../webview/sessionHistory/sessionHistoryWebview';
import { SemaProcessWrapper, MAX_SESSIONS } from './semaProcessWrapper';
import { SemaSessionWrapper, SessionWrapperCallbacks, Message } from './semaSessionWrapper';
import { TOOL_NAME_VIEW_FILE } from '../utils/tool';
import { pet } from '../pet/pet-client';
import { ensurePetRunning, killPet } from '../pet/pet-launcher';
import { wirePetEvents, setPetSessionState } from '../pet/pet-events';

/** chatWebview 用于驱动会话生命周期的控制接口 */
export interface SessionController {
    getActiveSessionId(): string | null;
    getSessionWrapper(sessionId: string): SemaSessionWrapper | undefined;
    createSession(agentMode?: AgentMode): Promise<{ ok: boolean; error?: string }>;
    switchSession(sessionId: string): void;
    closeSession(sessionId: string): Promise<void>;
}

export class SemaSidebarProvider implements vscode.WebviewViewProvider {
    private workingDir: string;

    private chatWebviewProvider: ChatWebviewProvider;
    private configWebviewProvider!: ConfigWebviewProvider;
    private sessionHistoryWebviewProvider!: SessionHistoryWebviewProvider;

    private processWrapper: SemaProcessWrapper;
    private sessions: Map<string, SemaSessionWrapper> = new Map();
    private activeSessionId: string | null = null;

    private sessionHistoryManager: SessionHistoryManager;
    private fileStateDiffManager: FileStateDiffManager;
    private fileOperationManager: FileOperationManager;
    private systemConfigManager: SystemConfigManager;

    private saveSessionTimers: Map<string, NodeJS.Timeout> = new Map();
    /** 每个会话的桌宠事件解绑函数。桌宠监听所有会话，而非仅当前活跃会话。 */
    private petUnwires: Map<string, () => void> = new Map();

    constructor(private readonly context: vscode.ExtensionContext) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workingDir = workspaceFolders?.[0]?.uri.fsPath ?? path.join(os.homedir(), 'sema-demo');

        this.fileOperationManager = new FileOperationManager();
        this.fileStateDiffManager = new FileStateDiffManager(
            this.workingDir,
            (filePath, line) => this.fileOperationManager.openFileAtLine(filePath, line ?? 1)
        );
        this.systemConfigManager = new SystemConfigManager(this.context);

        this.processWrapper = new SemaProcessWrapper(
            this.workingDir,
            this.systemConfigManager,
            {
                onModelUpdate: this.handleModelUpdate,
                onOpenAgentDetail: (taskId: string) => {
                    this.chatWebviewProvider.postMessage({
                        type: 'openAgentDetail',
                        sessionId: this.activeSessionId,
                        taskId,
                    });
                },
            }
        );

        const sessionController: SessionController = {
            getActiveSessionId: () => this.activeSessionId,
            getSessionWrapper: (sessionId) => this.sessions.get(sessionId),
            createSession: (agentMode) => this.createNewSession({ agentMode }),
            switchSession: (sessionId) => this.switchActiveSession(sessionId),
            closeSession: (sessionId) => this.closeSession(sessionId),
        };

        this.chatWebviewProvider = new ChatWebviewProvider(
            this.context.extensionUri,
            this.processWrapper,
            this.fileStateDiffManager,
            this.fileOperationManager,
            (page?: string, taskId?: string) => this.openConfigPanel(page, taskId),
            this.context,
            sessionController
        );

        this.sessionHistoryManager = new SessionHistoryManager(
            context,
            this.workingDir,
            () => this.activeSessionId
        );
        this.configWebviewProvider = new ConfigWebviewProvider(this.processWrapper, this.fileOperationManager);
        this.configWebviewProvider.setOnSystemConfigChanged((key, value) => {
            if (key === 'skipFileEditPermission') {
                this.chatWebviewProvider.postMessage({
                    type: 'systemConfigUpdate',
                    skipFileEditPermission: value
                });
            }
            if (key === 'enablePet') {
                if (value) void this.startPet();
                else void this.stopPet();
            }
        });
        this.sessionHistoryWebviewProvider = new SessionHistoryWebviewProvider(
            this.sessionHistoryManager,
            { loadSession: (sessionId) => this.loadHistorySession(sessionId) }
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this.chatWebviewProvider.setWebviewView(webviewView);
    }

    // ─── 会话回调（所有 SemaSessionWrapper 共用一份）──────────────────────────

    private get sessionCallbacks(): SessionWrapperCallbacks {
        return {
            onSessionReady: this.handleSessionReady,
            onMessage: this.handleMessage,
            onStateChange: this.handleStateChange,
            onTopicUpdate: this.handleTopicUpdate,
            onToolExecutionComplete: this.handleToolExecutionComplete,
            onFileReference: this.handleFileReference,
            onTaskStart: this.handleTaskStart,
            onTaskEnd: this.handleTaskEnd,
            onSessionCleared: this.handleSessionCleared,
            onOpenAgentDetail: (sessionId, taskId) => {
                this.chatWebviewProvider.postMessage({ type: 'openAgentDetail', sessionId, taskId });
            },
            onUserResponded: (sessionId) => {
                if (this.isPetEnabled()) setPetSessionState(sessionId, 'working');
            },
            onTitleUpdate: this.handleTitleUpdate,
        };
    }

    // ─── 会话生命周期 ─────────────────────────────────────────────────────────

    /**
     * 创建一个新会话。超限或 core 拒绝时向前端发送 sessionCreateFailed。
     */
    public async createNewSession(opts: {
        agentMode?: AgentMode;
        sessionId?: string;
        historyContent?: Message[];
        title?: string;
    } = {}): Promise<{ ok: boolean; error?: string }> {
        if (this.sessions.size >= MAX_SESSIONS) {
            const error = `最多同时打开 ${MAX_SESSIONS} 个会话，请先关闭已有会话`;
            this.chatWebviewProvider.postMessage({ type: 'sessionCreateFailed', error });
            return { ok: false, error };
        }

        try {
            if (this.sessions.size === 0) {
                await this.fileStateDiffManager.createSnapshot();
            }

            const result = await this.processWrapper.createSession({
                sessionId: opts.sessionId,
                agentMode: opts.agentMode,
            });

            if (!result.ok) {
                this.chatWebviewProvider.postMessage({ type: 'sessionCreateFailed', error: result.error });
                return { ok: false, error: result.error };
            }

            const wrapper = new SemaSessionWrapper(
                result.session,
                this.sessionCallbacks,
                opts.agentMode ?? 'Agent'
            );
            this.sessions.set(wrapper.sessionId, wrapper);

            if (opts.historyContent && opts.historyContent.length > 0) {
                if (opts.title) wrapper.updateTitle(opts.title);
                wrapper.updateMessageHistory(opts.historyContent);
            }

            this.activeSessionId = wrapper.sessionId;
            this.processWrapper.setActiveSession(wrapper.sessionId);

            this.chatWebviewProvider.postMessage({
                type: 'sessionOpened',
                sessionId: wrapper.sessionId,
                title: wrapper.title || '新会话',
            });

            this.wirePetForSession(wrapper.sessionId);
            this.sessionHistoryWebviewProvider?.refreshSessionList();
            return { ok: true };
        } catch (error) {
            const msg = error instanceof Error ? error.message : '创建会话失败';
            console.error('Error creating session:', error);
            this.chatWebviewProvider.postMessage({ type: 'sessionCreateFailed', error: msg });
            return { ok: false, error: msg };
        }
    }

    public switchActiveSession(sessionId: string): void {
        if (!this.sessions.has(sessionId)) return;
        this.activeSessionId = sessionId;
        this.processWrapper.setActiveSession(sessionId);
        // 桌宠监听所有会话，切换活跃会话无需重新绑定。
    }

    public async closeSession(sessionId: string): Promise<void> {
        const wrapper = this.sessions.get(sessionId);
        if (!wrapper) return;

        try {
            await this.sessionHistoryManager.saveSession(wrapper);
        } catch (error) {
            console.error('Error saving session before close:', error);
        }

        wrapper.dispose();
        this.processWrapper.closeSession(sessionId);
        this.sessions.delete(sessionId);

        const timer = this.saveSessionTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.saveSessionTimers.delete(sessionId);
        }

        if (this.activeSessionId === sessionId) {
            const next = this.sessions.keys().next().value ?? null;
            this.activeSessionId = next ?? null;
            if (next) this.processWrapper.setActiveSession(next);
        }

        this.chatWebviewProvider.postMessage({
            type: 'sessionClosed',
            sessionId,
            nextActiveId: this.activeSessionId,
        });

        this.unwirePetForSession(sessionId);
        this.sessionHistoryWebviewProvider?.refreshSessionList();
    }

    public getSessionWrapper(sessionId: string): SemaSessionWrapper | undefined {
        return this.sessions.get(sessionId);
    }

    public getActiveSessionId(): string | null {
        return this.activeSessionId;
    }

    /** 兼容旧命令：开始新对话 = 打开一个新会话 tab */
    public async newSession(): Promise<void> {
        try {
            await this.createNewSession({});
        } catch (error) {
            console.error('Error starting new session:', error);
        }
    }

    public async openHistoryPanel(): Promise<void> {
        try {
            await this.sessionHistoryWebviewProvider.show(this.context.extensionUri);
        } catch (error) {
            console.error('Error opening history panel:', error);
            vscode.window.showErrorMessage(`打开历史会话面板失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    public openConfigPanel(page?: string, taskId?: string) {
        this.configWebviewProvider.show(this.context.extensionUri, page, taskId);
    }

    // ─── 桌宠 ─────────────────────────────────────────────────────────────────

    public isPetEnabled(): boolean {
        const cfg = this.processWrapper.getSystemConfig() as Record<string, any>;
        return !!cfg.enablePet;
    }

    /** 给指定会话挂载桌宠事件（桌宠监听所有会话）。 */
    private wirePetForSession(sessionId: string): void {
        if (!this.isPetEnabled()) return;
        if (this.petUnwires.has(sessionId)) return;
        const session = this.processWrapper.getSession(sessionId);
        if (session) {
            this.petUnwires.set(sessionId, wirePetEvents(sessionId, session));
        }
    }

    /** 解绑指定会话的桌宠事件。 */
    private unwirePetForSession(sessionId: string): void {
        const unwire = this.petUnwires.get(sessionId);
        if (unwire) {
            unwire();
            this.petUnwires.delete(sessionId);
        }
    }

    /** 解绑全部会话，再按当前桌宠开关重新挂载所有会话。 */
    private rewireAllPetEvents(): void {
        for (const unwire of this.petUnwires.values()) unwire();
        this.petUnwires.clear();
        if (!this.isPetEnabled()) return;
        for (const sessionId of this.sessions.keys()) {
            this.wirePetForSession(sessionId);
        }
    }

    public async startPet(): Promise<void> {
        try {
            const ok = await ensurePetRunning(this.context.extensionPath);
            if (!ok) {
                vscode.window.setStatusBarMessage('Sema Pet: 启动失败（解压失败 / 端口被占？）', 5000);
                return;
            }
            this.rewireAllPetEvents();
            const registered = await pet.register(this.workingDir);
            if (!registered) {
                vscode.window.setStatusBarMessage('Sema Pet: 注册会话失败，桌宠不会显示当前项目', 5000);
                console.warn('[pet] register failed for cwd=', this.workingDir);
                return;
            }
            vscode.window.setStatusBarMessage('✓ Sema Pet 已启动', 3000);
        } catch (e) {
            console.error('[pet] start failed:', e);
            vscode.window.setStatusBarMessage(`Sema Pet: 启动异常 ${(e as Error).message}`, 5000);
        }
    }

    public async stopPet(): Promise<void> {
        try {
            for (const unwire of this.petUnwires.values()) unwire();
            this.petUnwires.clear();
            await pet.dispose();
            killPet();
            vscode.window.setStatusBarMessage('Sema Pet 已关闭', 3000);
        } catch (e) {
            console.error('[pet] stop failed:', e);
        }
    }

    public rewirePetEventsIfEnabled(): void {
        this.rewireAllPetEvents();
    }

    // ─── 会话事件 handlers ────────────────────────────────────────────────────

    private handleSessionReady = async (_sessionId: string, data: any): Promise<void> => {
        try {
            if (data.readFileTimestamps && typeof data.readFileTimestamps === 'object') {
                for (const filePath of Object.keys(data.readFileTimestamps)) {
                    await this.fileStateDiffManager.addFileToSnapshotIfNew(filePath);
                }
            }
        } catch (error) {
            console.error('Error handling session ready:', error);
        }
    };

    private handleMessage = (msg: any): void => {
        this.chatWebviewProvider?.postMessage(msg);
    };

    private handleModelUpdate = (data: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'modelUpdate', data });
        this.configWebviewProvider.refreshConfigPage();
    };

    private handleStateChange = (sessionId: string, state: 'idle' | 'processing'): void => {
        if (state === 'idle') {
            this.debouncedSaveSession(sessionId);
        }
    };

    private handleTopicUpdate = (sessionId: string, _topic: any): void => {
        this.debouncedSaveSession(sessionId);
    };

    private handleToolExecutionComplete = (_sessionId: string, data: any): void => {
        if (data.toolName === TOOL_NAME_VIEW_FILE) {
            this.fileStateDiffManager.addFileToSnapshotIfNew(data.title);
        }
    };

    private handleFileReference = (_sessionId: string, data: any): void => {
        if (data.references && Array.isArray(data.references)) {
            for (const ref of data.references) {
                if (ref.type === 'file' && ref.name) {
                    this.fileStateDiffManager.addFileToSnapshotIfNew(ref.name);
                }
            }
        }
    };

    private handleTaskStart = (sessionId: string, data: any): void => {
        this.configWebviewProvider.pushTaskStart(data);
        this.chatWebviewProvider.postMessage({ type: 'taskStart', sessionId, data });
    };

    private handleTaskEnd = (sessionId: string, data: any): void => {
        this.configWebviewProvider.pushTaskEnd(data);
        this.chatWebviewProvider.postMessage({ type: 'taskEnd', sessionId, data });
    };

    private handleSessionCleared = (sessionId: string): void => {
        this.fileStateDiffManager.createSnapshot();
        this.chatWebviewProvider.clearSessionPanels(sessionId);
    };

    private handleTitleUpdate = (sessionId: string, title: string): void => {
        this.chatWebviewProvider.postMessage({ type: 'sessionTitleUpdate', sessionId, title });
    };

    // ─── 历史会话 ─────────────────────────────────────────────────────────────

    private async loadHistorySession(sessionId: string): Promise<void> {
        try {
            // 已打开则直接切换到对应 tab
            if (this.sessions.has(sessionId)) {
                this.switchActiveSession(sessionId);
                this.chatWebviewProvider.postMessage({ type: 'switchToSession', sessionId });
                return;
            }

            const session = await this.sessionHistoryManager.getSession(sessionId);
            if (!session) {
                vscode.window.showErrorMessage('会话不存在或已被删除');
                return;
            }
            if (!session.content || session.content.length === 0) {
                vscode.window.showErrorMessage('无法加载会话：会话数据为空');
                return;
            }

            // 失败时（如会话数超限）由 createNewSession 内部发送 sessionCreateFailed，
            // 前端会在页面上展示错误，这里不再弹出 VS Code 通知。
            await this.createNewSession({
                sessionId,
                agentMode: session.agentMode ?? 'Agent',
                historyContent: session.content,
                title: session.title,
            });
        } catch (error) {
            console.error('Error loading history session:', error);
            vscode.window.showErrorMessage(`加载会话失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    private debouncedSaveSession(sessionId: string): void {
        const existing = this.saveSessionTimers.get(sessionId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(async () => {
            this.saveSessionTimers.delete(sessionId);
            try {
                const wrapper = this.sessions.get(sessionId);
                if (wrapper) {
                    await this.sessionHistoryManager.saveSession(wrapper);
                    this.sessionHistoryWebviewProvider?.refreshSessionList();
                }
            } catch (error) {
                console.error('Error saving session:', error);
            }
        }, 300);
        this.saveSessionTimers.set(sessionId, timer);
    }

    public dispose(): void {
        for (const timer of this.saveSessionTimers.values()) {
            clearTimeout(timer);
        }
        this.saveSessionTimers.clear();
        for (const unwire of this.petUnwires.values()) unwire();
        this.petUnwires.clear();
        for (const wrapper of this.sessions.values()) {
            wrapper.dispose();
        }
        this.sessions.clear();
        void this.processWrapper.dispose();
    }
}
