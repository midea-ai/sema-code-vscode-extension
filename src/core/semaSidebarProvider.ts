import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

import { SessionHistoryManager } from '../managers/SessionHistoryManager';
import { FileStateDiffManager } from '../managers/FileStateDiffManager';
import { FileOperationManager } from '../managers/FileOperationManager';
import { SystemConfigManager } from '../managers/SystemConfigManager';
import { ChatWebviewProvider } from '../webview/chat/chatWebview';
import { ConfigWebviewProvider } from '../webview/config/configWebview';
import { SessionHistoryWebviewProvider } from '../webview/sessionHistory/sessionHistoryWebview';
import { SemaCoreWrapper, AgentMode } from './semaCoreWrapper';
import { TOOL_NAME_VIEW_FILE } from '../utils/tool';
import { pet } from '../pet/pet-client';
import { ensurePetRunning, killPet } from '../pet/pet-launcher';
import { wirePetEvents } from '../pet/pet-events';


export class SemaSidebarProvider implements vscode.WebviewViewProvider {
    private workingDir: string;

    private chatWebviewProvider: ChatWebviewProvider;
    private configWebviewProvider!: ConfigWebviewProvider;
    private sessionHistoryWebviewProvider!: SessionHistoryWebviewProvider;

    private coreManager: SemaCoreWrapper;
    private sessionHistoryManager: SessionHistoryManager;
    private fileStateDiffManager: FileStateDiffManager;
    private fileOperationManager: FileOperationManager;
    private systemConfigManager: SystemConfigManager;

    private saveSessionTimer?: NodeJS.Timeout;

    constructor(private readonly context: vscode.ExtensionContext) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workingDir = workspaceFolders?.[0]?.uri.fsPath ?? path.join(os.homedir(), 'sema-demo');

        this.fileOperationManager = new FileOperationManager();
        this.fileStateDiffManager = new FileStateDiffManager(
            this.workingDir,
            (filePath, line) => this.fileOperationManager.openFileAtLine(filePath, line ?? 1)
        );
        this.systemConfigManager = new SystemConfigManager(this.context);

        this.coreManager = new SemaCoreWrapper(
            this.workingDir,
            {
                onSessionReady:           this.handleSessionReady,
                onMessage:                this.handleMessage,
                onModelUpdate:            this.handleModelUpdate,
                onStateChange:            this.handleStateChange,
                onTopicUpdate:            this.handleTopicUpdate,
                onToolExecutionComplete:  this.handleToolExecutionComplete,
                onFileReference:          this.handleFileReference,
                onTaskStart:              this.handleTaskStart,
                onTaskEnd:                this.handleTaskEnd,
                onSessionCleared:         this.handleSessionCleared,
                onOpenAgentDetail:        (taskId: string) => {
                    this.chatWebviewProvider.postMessage({ type: 'openAgentDetail', taskId });
                },
                onUserResponded:          () => {
                    if (this.isPetEnabled()) pet.state('working');
                },
            },
            this.systemConfigManager
        );

        this.chatWebviewProvider = new ChatWebviewProvider(
            this.context.extensionUri,
            this.coreManager,
            this.fileStateDiffManager,
            this.fileOperationManager,
            (page?: string, taskId?: string) => this.openConfigPanel(page, taskId),
            this.context,
            (mode: AgentMode) => this.switchAgentModeWithNewSession(mode)
        );

        this.sessionHistoryManager = new SessionHistoryManager(context, this.workingDir, this.coreManager);
        this.configWebviewProvider = new ConfigWebviewProvider(this.coreManager, this.fileOperationManager);
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

    public async newSession() {
        try {
            await this.startFreshSession();
        } catch (error) {
            console.error('Error starting new session:', error);
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });
        }
    }

    public async switchAgentModeWithNewSession(mode: AgentMode) {
        try {
            await this.startFreshSession();
            await this.coreManager.updateAgentMode(mode);
            this.chatWebviewProvider.postMessage({ type: 'agentModeUpdate', mode });
        } catch (error) {
            console.error('Error switching agent mode with new session:', error);
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });
        }
    }

    private async startFreshSession() {
        clearTimeout(this.saveSessionTimer);
        await this.sessionHistoryManager.saveSession();

        this.coreManager.clearMessageHistory();
        this.chatWebviewProvider.clearSessionPanels();
        this.chatWebviewProvider.postMessage({ type: 'resetTokenInfo' });
        this.chatWebviewProvider.postMessage({ type: 'disableInput', message: '正在初始化 CLI，请稍候...' });

        await this.fileStateDiffManager.createSnapshot();
        await this.coreManager.createSession();
        this.chatWebviewProvider.postMessage({ type: 'autoEditUpdate', enable: false });

        this.sessionHistoryWebviewProvider.refreshSessionList();
    }

    public async openHistoryPanel() {
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

    public getSemaCore() {
        return this.coreManager.getSemaCore();
    }

    public isPetEnabled(): boolean {
        const cfg = this.coreManager.getSystemConfig() as Record<string, any>;
        return !!cfg.enablePet;
    }

    public async startPet(): Promise<void> {
        try {
            const ok = await ensurePetRunning(this.context.extensionPath);
            if (!ok) {
                vscode.window.setStatusBarMessage('Sema Pet: 启动失败（解压失败 / 端口被占？）', 5000);
                return;
            }
            // 先订阅事件再 register：避免启动窗口期（register 重试最坏可达数秒）内的状态变化丢失。
            // pet-client 会把 register 前的最后一次 state 缓存下来，register 成功后重放。
            const semaCore = this.getSemaCore?.();
            if (semaCore) wirePetEvents(semaCore);
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
            await pet.dispose();
            killPet();
            vscode.window.setStatusBarMessage('Sema Pet 已关闭', 3000);
        } catch (e) {
            console.error('[pet] stop failed:', e);
        }
    }

    public rewirePetEventsIfEnabled(): void {
        if (!this.isPetEnabled()) return;
        const semaCore = this.getSemaCore?.();
        if (semaCore) wirePetEvents(semaCore);
    }

    // ─── Core event handlers ──────────────────────────────────────────────────

    private handleSessionReady = async (data: any): Promise<void> => {
        try {
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });

            if (data.usage) {
                this.chatWebviewProvider.postMessage({ type: 'updateTokenInfo', tokenInfo: data.usage });
            }

            if (Array.isArray(data.todos) && data.todos.length > 0) {
                this.chatWebviewProvider.postMessage({ type: 'todosUpdate', todos: data.todos });
            }

            if (data.readFileTimestamps && typeof data.readFileTimestamps === 'object') {
                for (const filePath of Object.keys(data.readFileTimestamps)) {
                    await this.fileStateDiffManager.addFileToSnapshotIfNew(filePath);
                }
            }
        } catch (error) {
            console.error('Error handling session ready:', error);
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });
        }
    };

    private handleMessage = (msg: any): void => {
        this.chatWebviewProvider?.postMessage(msg);
    };

    private handleModelUpdate = (data: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'modelUpdate', data });
        this.configWebviewProvider.refreshConfigPage();
    };

    private handleStateChange = async (state: 'idle' | 'processing'): Promise<void> => {
        this.chatWebviewProvider.postMessage({ type: 'stateUpdate', state });
        if (state === 'idle') {
            this.debouncedSaveSession();
        }
    };

    private handleTopicUpdate = (_topic: any): void => {
        this.debouncedSaveSession();
    };

    private handleToolExecutionComplete = (data: any): void => {
        if (data.toolName === TOOL_NAME_VIEW_FILE) {
            this.fileStateDiffManager.addFileToSnapshotIfNew(data.title);
        }
    };

    private handleFileReference = (data: any): void => {
        if (data.references && Array.isArray(data.references)) {
            for (const ref of data.references) {
                if (ref.type === 'file' && ref.name) {
                    this.fileStateDiffManager.addFileToSnapshotIfNew(ref.name);
                }
            }
        }
    };

    private handleTaskStart = (data: any): void => {
        this.configWebviewProvider.pushTaskStart(data);
        this.chatWebviewProvider.postMessage({ type: 'taskStart', data });
    };

    private handleTaskEnd = (data: any): void => {
        this.configWebviewProvider.pushTaskEnd(data);
        this.chatWebviewProvider.postMessage({ type: 'taskEnd', data });
    };

    private handleSessionCleared = (): void => {
        this.fileStateDiffManager.createSnapshot();
        this.chatWebviewProvider.clearSessionPanels();
    };

    // ─── Session management ───────────────────────────────────────────────────

    private async loadHistorySession(sessionId: string): Promise<void> {
        try {
            const session = await this.sessionHistoryManager.getSession(sessionId);
            if (!session) {
                vscode.window.showErrorMessage('会话不存在或已被删除');
                return;
            }

            clearTimeout(this.saveSessionTimer);
            await this.sessionHistoryManager.saveSession();

            this.coreManager.clearMessageHistory();
            this.chatWebviewProvider.clearSessionPanels();

            if (session.content && session.content.length > 0) {
                try {
                    await this.fileStateDiffManager.createSnapshot();
                    await this.coreManager.createSession(sessionId);
                    this.chatWebviewProvider.postMessage({ type: 'autoEditUpdate', enable: false });
                    await this.coreManager.updateMessageHistory(session.content);
                    this.coreManager.updateTitle(session.title);

                    const targetMode: AgentMode = session.agentMode ?? 'Agent';
                    await this.coreManager.updateAgentMode(targetMode);
                    this.chatWebviewProvider.postMessage({ type: 'agentModeUpdate', mode: targetMode });
                } catch (error) {
                    console.error('Failed to load session:', error);
                    vscode.window.showErrorMessage(`加载会话失败：${error instanceof Error ? error.message : '未知错误'}`);
                }
            } else {
                vscode.window.showErrorMessage('无法加载会话：会话数据为空');
            }
        } catch (error) {
            console.error('Error loading history session:', error);
            vscode.window.showErrorMessage(`加载会话失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    private debouncedSaveSession(): void {
        clearTimeout(this.saveSessionTimer);
        this.saveSessionTimer = setTimeout(async () => {
            try {
                await this.sessionHistoryManager.saveSession();
                this.sessionHistoryWebviewProvider?.refreshSessionList();
            } catch (error) {
                console.error('Error saving session:', error);
            }
        }, 300);
    }

    public dispose(): void {
        clearTimeout(this.saveSessionTimer);
        this.coreManager.dispose();
    }
}
