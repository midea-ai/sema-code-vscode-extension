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
import { SemaCoreWrapper } from './semaCoreWrapper';


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
                onMessageComplete:        this.handleMessageComplete,
                onModelUpdate:            this.handleModelUpdate,
                onStateChange:            this.handleStateChange,
                onToolPermissionRequest:  this.handleToolPermissionRequest,
                onAskQuestionRequest:     this.handleAskQuestionRequest,
                onPlanExitRequest:        this.handlePlanExitRequest,
                onUsageUpdate:            this.handleUsageUpdate,
                onTodosUpdate:            this.handleTodosUpdate,
                onTopicUpdate:            this.handleTopicUpdate,
                onInputReceived:          this.handleInputReceived,
                onInputProcessing:        this.handleInputProcessing,
                onToolExecutionComplete:  this.handleToolExecutionComplete,
            },
            this.systemConfigManager
        );

        this.chatWebviewProvider = new ChatWebviewProvider(
            this.context.extensionUri,
            this.coreManager,
            this.fileStateDiffManager,
            this.fileOperationManager,
            () => this.openConfigPanel()
        );

        this.sessionHistoryManager = new SessionHistoryManager(context, this.workingDir, this.coreManager);
        this.configWebviewProvider = new ConfigWebviewProvider(this.coreManager);
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
            if (this.coreManager.getCurrentState() === 'processing') {
                const completed = await this.coreManager.interruptAndWait();
                if (!completed) {
                    console.warn('[NewSession] 等待中断完成超时，继续创建新会话');
                }
            }

            clearTimeout(this.saveSessionTimer);
            await this.sessionHistoryManager.saveSession();

            this.coreManager.clearMessageHistory();
            this.chatWebviewProvider.clearSessionPanels();
            this.chatWebviewProvider.postMessage({ type: 'resetTokenInfo' });
            this.chatWebviewProvider.postMessage({ type: 'disableInput', message: '正在初始化 CLI，请稍候...' });

            await this.fileStateDiffManager.createSnapshot();
            await this.coreManager.createSession();

            this.sessionHistoryWebviewProvider.refreshSessionList();
        } catch (error) {
            console.error('Error starting new session:', error);
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });
        }
    }

    public async openHistoryPanel() {
        try {
            await this.sessionHistoryWebviewProvider.show(this.context.extensionUri);
        } catch (error) {
            console.error('Error opening history panel:', error);
            vscode.window.showErrorMessage(`打开历史会话面板失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    public openConfigPanel() {
        this.configWebviewProvider.show(this.context.extensionUri);
    }

    // ─── Core event handlers ──────────────────────────────────────────────────

    private handleSessionReady = async (data: any): Promise<void> => {
        try {
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });

            if (data.projectInputHistory && Array.isArray(data.projectInputHistory)) {
                this.chatWebviewProvider.postMessage({
                    type: 'initializeInputHistory',
                    projectInputHistory: data.projectInputHistory
                });
            }

            if (data.usage) {
                this.chatWebviewProvider.postMessage({ type: 'updateTokenInfo', tokenInfo: data.usage });
            }
        } catch (error) {
            console.error('Error handling session ready:', error);
            this.chatWebviewProvider.postMessage({ type: 'enableInput' });
        }
    };

    private handleMessage = (msg: any): void => {
        this.chatWebviewProvider?.postMessage(msg);
    };

    private handleMessageComplete = (): void => {
        // 由 handleStateChange('idle') 统一触发保存，避免重复
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

    private handleToolPermissionRequest = (data: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'toolPermissionRequest', data });
    };

    private handleAskQuestionRequest = (data: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'askQuestionRequest', data });
    };

    private handlePlanExitRequest = (data: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'planExitRequest', data });
    };

    private handleUsageUpdate = (data: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'updateTokenInfo', tokenInfo: data.usage });
    };

    private handleTodosUpdate = (todos: any): void => {
        this.chatWebviewProvider.postMessage({ type: 'todosUpdate', todos });
    };

    private handleTopicUpdate = (_topic: any): void => {
        this.debouncedSaveSession();
    };

    private handleInputReceived = (data: any): void => {
        this.chatWebviewProvider?.postMessage({ type: 'inputReceived', data });
    };

    private handleInputProcessing = (data: any): void => {
        this.chatWebviewProvider?.postMessage({ type: 'inputProcessing', data });
    };

    private handleToolExecutionComplete = (data: any): void => {
        if (data.toolName === 'Read') {
            this.fileStateDiffManager.addFileToSnapshotIfNew(data.title);
        }
    };

    // ─── Session management ───────────────────────────────────────────────────

    private async loadHistorySession(sessionId: string): Promise<void> {
        try {
            const session = await this.sessionHistoryManager.getSession(sessionId);
            if (!session) {
                vscode.window.showErrorMessage('会话不存在或已被删除');
                return;
            }

            if (this.coreManager.getCurrentState() === 'processing') {
                const completed = await this.coreManager.interruptAndWait();
                if (!completed) {
                    console.warn('[LoadSession] 等待中断完成超时，继续加载会话');
                }
            }

            clearTimeout(this.saveSessionTimer);
            await this.sessionHistoryManager.saveSession();

            this.coreManager.clearMessageHistory();
            this.chatWebviewProvider.clearSessionPanels();

            if (session.content && session.content.length > 0) {
                try {
                    await this.fileStateDiffManager.createSnapshot();
                    await this.coreManager.createSession(sessionId);
                    await this.coreManager.updateMessageHistory(session.content);
                    this.coreManager.updateTitle(session.title);
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
