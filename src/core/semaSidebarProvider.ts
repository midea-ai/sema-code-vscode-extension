import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import type { SemaSession } from 'sema-core';
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
import { ClawCoordinator } from '../claw/coordinator';
import { CLAW_SESSION_ID } from '../claw/paths';
import { TOOL_NAME_VIEW_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE } from '../utils/tool';
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
    /** 分支到新聊天：全量复制源会话历史到新会话并以新 tab 打开 */
    branchSession(sessionId: string): Promise<{ ok: boolean; error?: string }>;
}

export class SemaSidebarProvider implements vscode.WebviewViewProvider {
    private workingDir: string;

    private chatWebviewProvider: ChatWebviewProvider;
    private configWebviewProvider!: ConfigWebviewProvider;
    private sessionHistoryWebviewProvider!: SessionHistoryWebviewProvider;

    private processWrapper: SemaProcessWrapper;
    /** 远程入口（claw）。极薄壳，运行时按需懒载，不开则零开销。 */
    private clawCoordinator: ClawCoordinator;
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
                onOpenAgentDetail: (taskId: string, sessionId?: string) => {
                    const targetSessionId = sessionId ?? this.activeSessionId;
                    // 任务不属于当前活跃会话时，先切换活跃会话
                    if (targetSessionId && targetSessionId !== this.activeSessionId) {
                        this.switchActiveSession(targetSessionId);
                        this.chatWebviewProvider.postMessage({ type: 'switchToSession', sessionId: targetSessionId });
                    }
                    this.chatWebviewProvider.postMessage({
                        type: 'openAgentDetail',
                        sessionId: targetSessionId,
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
            branchSession: (sessionId) => this.branchToNewChat(sessionId),
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
            () => this.activeSessionId,
            () => Array.from(this.sessions.keys())
        );
        this.clawCoordinator = new ClawCoordinator(
            this.processWrapper,
            this.workingDir,
            (m) => console.log('[claw]', m),
            {
                onSessionAttach: (session) => { void this.attachClawSession(session); },
                onSessionDetach: (sessionId) => this.detachClawSession(sessionId),
                onPermissionResolved: (sessionId) => {
                    this.chatWebviewProvider.postMessage({ type: 'closePermissionPanel', sessionId });
                },
            },
        );
        this.configWebviewProvider = new ConfigWebviewProvider(this.processWrapper, this.fileOperationManager, this.clawCoordinator);
        this.configWebviewProvider.setOnSystemConfigChanged((key, value) => {
            if (key === 'skipFileEditPermission' || key === 'thinking' || key === 'showThinkingText') {
                const cfg = this.processWrapper.getSystemConfig() as Record<string, any>;
                this.chatWebviewProvider.postMessage({
                    type: 'systemConfigUpdate',
                    skipFileEditPermission: !!cfg.skipFileEditPermission,
                    thinking: cfg.thinking !== false,
                    showThinkingText: cfg.showThinkingText !== false
                });
            }
            if (key === 'enablePet') {
                if (value) void this.startPet();
                else void this.stopPet();
            }
        });
        this.sessionHistoryWebviewProvider = new SessionHistoryWebviewProvider(
            this.sessionHistoryManager,
            {
                loadSession: (sessionId) => this.loadHistorySession(sessionId),
                onSessionDeleted: (sessionId) => this.processWrapper.deleteSessionHistory(sessionId),
            }
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
            onUserResponded: (sessionId, permissionSelected) => {
                // 电脑端应答了 claw 会话的权限 → 清掉 bridge 的待确认状态（否则手机端
                // 会被一直挡在"请先回复 y/n"），并把同意/拒绝的结果回传手机。
                if (sessionId === CLAW_SESSION_ID) {
                    this.clawCoordinator.notifyDesktopPermissionAnswered(permissionSelected);
                }
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
            // 为该会话建立独立的快照作用域（清掉可能残留的同 id 旧状态）
            await this.fileStateDiffManager.createSnapshot(wrapper.sessionId);

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
        // 活跃会话变化时刷新历史面板，使「活跃/打开」徽标与排序同步。
        this.sessionHistoryWebviewProvider?.refreshSessionList();
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
        // 释放该会话的快照与临时文件，避免泄漏
        this.fileStateDiffManager.createSnapshot(sessionId);

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

    // ─── 远程会话（claw）UI 接入 ───────────────────────────────────────────────

    /**
     * 把 claw 远程会话以普通 tab 形式接入聊天界面。
     * 该 session 已由 ClawSession 创建，这里只补一个 SemaSessionWrapper（与 ClawBridge
     * 并存，各自独立订阅同一 session），并发 sessionOpened。activate:false 让 tab 静默
     * 出现而不抢占当前焦点。core 已有的历史会在前端 webviewSessionReady 时补显示。
     */
    private async attachClawSession(session: SemaSession): Promise<void> {
        if (this.sessions.has(session.sessionId)) return;
        const wrapper = new SemaSessionWrapper(session, this.sessionCallbacks, 'Agent');
        this.sessions.set(wrapper.sessionId, wrapper);
        await this.fileStateDiffManager.createSnapshot(wrapper.sessionId);

        // 复用插件侧历史，让 chat 页打开 claw 会话时能看到之前的对话（与普通会话一致）。
        try {
            const history = await this.sessionHistoryManager.getSession(session.sessionId);
            if (history?.content?.length) {
                if (history.title) wrapper.updateTitle(history.title);
                wrapper.updateMessageHistory(history.content);
            }
        } catch (error) {
            console.error('Error loading claw session history:', error);
        }

        // 开启 claw 时切到该会话，让用户直接看到远程对话；isClaw 让 tab 用紫色标识。
        this.activeSessionId = wrapper.sessionId;
        this.processWrapper.setActiveSession(wrapper.sessionId);
        this.chatWebviewProvider.postMessage({
            type: 'sessionOpened',
            sessionId: wrapper.sessionId,
            title: wrapper.title || '微信远程',
            isClaw: true,
        });
        this.wirePetForSession(wrapper.sessionId);
        this.sessionHistoryWebviewProvider?.refreshSessionList();
    }

    /** claw 关闭/释放时移除其 tab。 */
    private detachClawSession(sessionId: string): void {
        const wrapper = this.sessions.get(sessionId);
        if (!wrapper) return;
        wrapper.dispose();
        this.sessions.delete(sessionId);
        this.fileStateDiffManager.createSnapshot(sessionId);

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

    private handleSessionReady = async (sessionId: string, data: any): Promise<void> => {
        try {
            if (data.readFileTimestamps && typeof data.readFileTimestamps === 'object') {
                for (const filePath of Object.keys(data.readFileTimestamps)) {
                    await this.fileStateDiffManager.addFileToSnapshotIfNew(sessionId, filePath);
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

    private handleToolExecutionComplete = (sessionId: string, data: any): void => {
        if (data.toolName === TOOL_NAME_VIEW_FILE) {
            this.fileStateDiffManager.addFileToSnapshotIfNew(sessionId, data.title);
        } else if (
            (data.toolName === TOOL_NAME_WRITE_FILE || data.toolName === TOOL_NAME_PATCH_FILE) &&
            data.content && typeof data.content === 'object' && (data.content as any).type === 'new'
        ) {
            // 新建文件：钉空基线，避免 fork 后重读把已修改内容误当基线
            this.fileStateDiffManager.pinEmptySnapshotIfNew(sessionId, data.title);
        }
    };

    private handleFileReference = (sessionId: string, data: any): void => {
        if (data.references && Array.isArray(data.references)) {
            for (const ref of data.references) {
                if (ref.type === 'file' && ref.name) {
                    this.fileStateDiffManager.addFileToSnapshotIfNew(sessionId, ref.name);
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
        this.fileStateDiffManager.createSnapshot(sessionId);
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

    /**
     * 分支到新聊天：core 侧 branch() 新建会话并全量复制历史（editlog 副本一并复制，
     * 源会话与工作区文件不动），插件侧把源会话的消息列表复制给新 wrapper 并以新 tab 打开。
     * 失败时通过 sessionCreateFailed 在页面顶部展示错误。
     */
    private async branchToNewChat(sourceId: string): Promise<{ ok: boolean; error?: string }> {
        const fail = (error: string) => {
            this.chatWebviewProvider.postMessage({ type: 'sessionCreateFailed', error });
            return { ok: false, error };
        };
        const source = this.sessions.get(sourceId);
        if (!source) return fail('会话不可用');
        // 先于 core 检查会话数上限：core branch 会落盘新历史文件，开不出 tab 会留下孤儿会话
        if (this.sessions.size >= MAX_SESSIONS) {
            return fail(`最多同时打开 ${MAX_SESSIONS} 个会话，请先关闭已有会话`);
        }
        if (source.getCurrentState() !== 'idle') return fail('会话处理中，请等待空闲后再分支');

        try {
            const result = await source.branch();
            if (result.ok === false) return fail(`分支失败：${result.error}`);

            const title = source.title ? `${source.title} (分支)` : '分支会话';
            const created = await this.createNewSession({
                sessionId: result.sessionId,
                agentMode: source.getAgentMode(),
                historyContent: source.getMessageHistory(),
                title,
            });
            if (!created.ok) return created;

            // 立即写入历史面板，不必等新会话首次 idle
            const wrapper = this.sessions.get(result.sessionId);
            if (wrapper) {
                await this.sessionHistoryManager.saveSession(wrapper);
                this.sessionHistoryWebviewProvider?.refreshSessionList();
            }
            return { ok: true };
        } catch (error) {
            console.error('Error branching session:', error);
            return fail(`分支失败：${error instanceof Error ? error.message : '未知错误'}`);
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
        // 释放 claw（仅当曾开启才有副作用：释放锁 + 停轮询 + dispose claw 会话）。
        void this.clawCoordinator.dispose();
        void this.processWrapper.dispose();
    }
}
