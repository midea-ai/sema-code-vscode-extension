import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { FileStateDiffManager } from '../../managers/FileStateDiffManager';
import { FileOperationManager } from '../../managers/FileOperationManager';
import { SemaCoreWrapper } from '../../core/semaCoreWrapper';
import { transformCommandToPrompt } from '../../utils/prompt';

/**
 * ChatWebviewProvider - 管理聊天界面 Webview，直接处理所有消息
 */
export class ChatWebviewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly coreManager: SemaCoreWrapper,
        private readonly fileStateDiffManager: FileStateDiffManager,
        private readonly fileOperationManager: FileOperationManager,
        private readonly onOpenConfig: (page?: string) => void
    ) { }

    private listenersRegistered = false;

    public setWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        this.view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.view.webview.html = this.getHtmlContent(this.view.webview);

        if (!this.listenersRegistered) {
            this.setupEventListeners();
            this.listenersRegistered = true;
        }

        this.view.webview.onDidReceiveMessage(async (msg) => {
            const handlers: Record<string, () => Promise<void>> = {
                frontendReady: () => this.onFrontendReady(),
                sendInput: () => this.handleUserInput(msg.text, msg.files),
                openConfig: () => Promise.resolve(this.onOpenConfig(msg.page)),
                interrupt: () => this.interrupt(),
                openFile: () => this.fileOperationManager.openFileAtLine(msg.filePath, msg.line, msg.endLine),
                requestWorkspaceFiles: () => this.sendWorkspaceFiles(),
                searchWorkspaceFiles: () => this.searchWorkspaceFiles(msg.query || ''),
                requestModelInfo: () => this.sendModelInfo(),
                switchModel: () => this.switchModel(msg.modelName),
                restoreFromSnapshots: () => this.restoreFromSnapshots(msg.filePaths),
                showFileDiff: () => this.fileStateDiffManager.showFileDiff(msg.filePath, msg.minLine),
                showPermissionDiff: () => this.fileStateDiffManager.showPermissionDiff(msg.filePath, msg.diffContent),
                getFileChangeStats: () => this.getFileChangeStats(msg.filePath),
                searchContentInFiles: () => this.searchContentInFiles(msg.content),
                toolPermissionResponse: () => Promise.resolve(this.handleToolPermissionResponse(msg.response)),
                askQuestionResponse: () => Promise.resolve(this.coreManager.respondToAskQuestion(msg.response)),
                planExitResponse: () => this.handlePlanExitResponse(msg.response),
                verifyFilePath: () => this.verifyFilePath(msg.filePath, msg.tempId, msg.originalCode, msg.lineInfo),
                insertPermissionRequest: () => Promise.resolve(this.coreManager.insertPermissionRequestMessage(msg.permissionData)),
                updateAgentMode: () => this.coreManager.updateAgentMode(msg.mode),
                requestCommands: () => this.sendCommands(),
                openBashOutput: () => this.fileOperationManager.openBashOutputAsDocument(msg.content, msg.command, msg.toolId),
                transferAgentToBackground: async () => { this.coreManager.transferAgentToBackground(msg.taskId); },
            };
            await handlers[msg.type]?.();
        });
    }

    public postMessage(message: any): void {
        this.view?.webview.postMessage(message);
    }

    public clearSessionPanels(): void {
        this.postMessage({ type: 'closePermissionPanel' });
        this.postMessage({ type: 'closeAskQuestionPanel' });
        this.postMessage({ type: 'closePlanExitPanel' });
        this.postMessage({ type: 'clearPendingInputs' });
        this.postMessage({ type: 'clearTodos' });
        this.postMessage({ type: 'clearFileChanges' });
    }

    // ─── Direct semaCore event listeners ─────────────────────────────────────

    private setupEventListeners(): void {
        this.coreManager.getSemaCore().on('tool:permission:request', (data: any) => {
            this.postMessage({ type: 'toolPermissionRequest', data });
        });
        this.coreManager.getSemaCore().on('ask:question:request', (data: any) => {
            this.postMessage({ type: 'askQuestionRequest', data });
        });
        this.coreManager.getSemaCore().on('plan:exit:request', (data: any) => {
            this.postMessage({ type: 'planExitRequest', data });
        });
        this.coreManager.getSemaCore().on('conversation:usage', (data: any) => {
            this.postMessage({ type: 'updateTokenInfo', tokenInfo: data.usage });
        });
        this.coreManager.getSemaCore().on('todos:update', (data: any) => {
            this.postMessage({ type: 'todosUpdate', todos: data });
        });
        this.coreManager.getSemaCore().on('input:received', (data: any) => {
            this.postMessage({ type: 'inputReceived', data });
        });
        this.coreManager.getSemaCore().on('input:processing', (data: any) => {
            this.postMessage({ type: 'inputProcessing', data });
        });
        this.coreManager.getSemaCore().on('btw:response', (data: any) => {
            this.postMessage({ type: 'btwResponse', data });
        });
    }

    // ─── Message handlers ────────────────────────────────────────────────────

    private async onFrontendReady(): Promise<void> {
        await this.coreManager.createSession();
        await this.checkConfiguration();
    }

    private async handleUserInput(text: string, files?: Array<any>): Promise<void> {
        try {

            let content = text;
            if (files && files.length > 0) {
                const fileContext = files.map((file: any) =>
                    file.startLine && file.endLine
                        ? `@${file.path}:${file.startLine}-${file.endLine}`
                        : `@${file.path}`
                ).join(' ');
                content = `${text} ${fileContext} `;
            }

            const transformedContent = transformCommandToPrompt(content);
            if (transformedContent && transformedContent !== content) {
                await this.coreManager.processUserInput(transformedContent, content);
            } else {
                await this.coreManager.processUserInput(content);
            }
        } catch (error) {
            this.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : '处理用户输入时发生错误'
            });
        }
    }

    private async interrupt(): Promise<void> {
        try {
            this.postMessage({ type: 'closePermissionPanel' });
            this.postMessage({ type: 'closeAskQuestionPanel' });
            this.postMessage({ type: 'closePlanExitPanel' });
            this.postMessage({ type: 'clearPendingInputs' });
            this.coreManager.interruptSession();
            this.coreManager.stopAllTasks();
        } catch (error) {
            console.error('Error interrupting session:', error);
        }
    }

    private async sendWorkspaceFiles(): Promise<void> {
        const files = await this.fileOperationManager.getWorkspaceFiles();
        this.postMessage({
            type: 'workspaceFiles',
            files: files.map(item => ({ path: item.path, isDirectory: item.isDirectory, isOpen: item.isOpen }))
        });
    }

    private async searchWorkspaceFiles(query: string): Promise<void> {
        const files = await this.fileOperationManager.searchWorkspaceFiles(query);
        this.postMessage({
            type: 'workspaceFiles',
            files: files.map(item => ({ path: item.path, isDirectory: item.isDirectory, isOpen: item.isOpen }))
        });
    }

    private async sendModelInfo(): Promise<void> {
        try {
            const modelData = await this.coreManager.getModelData();
            this.postMessage({
                type: 'updateModelInfo',
                modelName: modelData.modelName || '',
                availableModels: modelData.modelList || []
            });
        } catch (error) {
            this.postMessage({ type: 'error', message: `获取模型信息失败: ${error instanceof Error ? error.message : '未知错误'}` });
        }
    }

    private async switchModel(modelName: string): Promise<void> {
        try {
            await this.coreManager.switchModel(modelName);
        } catch (error) {
            this.postMessage({ type: 'error', message: `切换模型失败: ${error instanceof Error ? error.message : '未知错误'}` });
        }
    }

    private async restoreFromSnapshots(filePaths: string[]): Promise<void> {
        await this.fileStateDiffManager.revertAllChanges(filePaths);
        this.postMessage({ type: 'clearFileChanges' });
    }

    private async getFileChangeStats(filePath: string): Promise<void> {
        if (!filePath) return;
        try {
            const stats = await this.fileStateDiffManager.getFileChangeStats(filePath);
            this.postMessage({ type: 'fileChangeStats', fullPath: filePath, stats });
        } catch (error) {
            console.error('Failed to get file change stats:', error);
        }
    }

    private async searchContentInFiles(content: string): Promise<void> {
        try {
            const result = await this.fileOperationManager.searchContentInFiles(content);
            this.postMessage({ type: 'contentSearchResult', result });
        } catch (error) {
            console.error('Failed to search content in files:', error);
            this.postMessage({ type: 'contentSearchResult', result: null });
        }
    }

    private handleToolPermissionResponse(response: any): void {
        this.coreManager.respondToToolPermission(response);
    }

    private async handlePlanExitResponse(response: any): Promise<void> {
        if (response.selected === 'clearContextAndStart') {
            this.coreManager.clearMessageHistory();

            this.postMessage({ type: 'closePermissionPanel' });
            this.postMessage({ type: 'closeAskQuestionPanel' });
            this.postMessage({ type: 'closePlanExitPanel' });
            this.postMessage({ type: 'clearPendingInputs' });
            this.postMessage({ type: 'clearTodos' });

            this.postMessage({ type: 'resetTokenInfo' });
        }
        this.coreManager.respondToPlanExit(response);
        await this.coreManager.updateAgentMode('Agent');
        this.postMessage({ type: 'agentModeUpdate', mode: 'Agent' });
    }

    private async verifyFilePath(filePath: string, tempId: string, originalCode: string, lineInfo?: string): Promise<void> {
        try {
            const exists = await this.fileOperationManager.verifyFilePath(filePath);
            this.postMessage({ type: 'filePathVerified', tempId, exists, filePath, originalCode, lineInfo });
        } catch (error) {
            console.error('Failed to verify file path:', error);
            this.postMessage({ type: 'filePathVerified', tempId, exists: false, filePath, originalCode, lineInfo });
        }
    }

    private async sendCommands(): Promise<void> {
        try {
            const commands = await this.coreManager.getCommandsInfo();
            this.postMessage({ type: 'customCommandsLoaded', commands });
        } catch (error) {
            console.error('Error loading commands:', error);
        }
    }

    private async checkConfiguration(): Promise<void> {
        try {
            const isReady = await this.coreManager.waitForReady(5000);
            if (!isReady) {
                console.warn('SemaCore 初始化超时，无法检查配置状态');
                return;
            }
            const modelData = await this.coreManager.getModelData();
            if (!modelData.modelList || modelData.modelList.length === 0) {
                this.postMessage({ type: 'showModelConfigReminder', message: 'Code Agent Model 尚未配置，请先配置模型信息' });
            }
        } catch (error) {
            console.error('Error checking configuration:', error);
            vscode.window.showWarningMessage('Code Agent Model 配置检查失败，请配置模型信息', '打开配置')
                .then(selection => { if (selection === '打开配置') this.onOpenConfig(); });
        }
    }

    // ─── HTML ─────────────────────────────────────────────────────────────────

    private getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js')
        );
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;
        script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;
        font-src ${webview.cspSource};
        img-src ${webview.cspSource} https://img.shields.io data:;">
    <title>Code Assistant</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private getNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }
}
