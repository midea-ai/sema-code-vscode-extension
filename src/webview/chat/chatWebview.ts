import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { FileStateDiffManager } from '../../managers/FileStateDiffManager';
import { FileOperationManager } from '../../managers/FileOperationManager';
import { SemaProcessWrapper } from '../../core/semaProcessWrapper';
import type { SessionController } from '../../core/semaSidebarProvider';
import { transformCommandToPrompt } from '../../utils/prompt';
import type { InputImageAttachment } from 'sema-core';

const FILE_REFERENCE_QUOTE_REGEX = /[\s。，、；：！？""''「」『』（）《》〈〉【】,;!?]/;

function escapeQuotedFileReferencePath(filePath: string): string {
    return filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatFileReference(file: any, quoted = true): string {
    const pathText = String(file.path ?? '');
    const needsQuotes = quoted && FILE_REFERENCE_QUOTE_REGEX.test(pathText);
    const pathRef = needsQuotes ? `"${escapeQuotedFileReferencePath(pathText)}"` : pathText;
    const hasLineRange = file.startLine !== undefined && file.endLine !== undefined;
    return hasLineRange
        ? `@${pathRef}:${file.startLine}-${file.endLine}`
        : `@${pathRef}`;
}

/**
 * ChatWebviewProvider - 管理聊天界面 Webview（单 webview，多会话按 sessionId 路由）
 */
export class ChatWebviewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly processWrapper: SemaProcessWrapper,
        private readonly fileStateDiffManager: FileStateDiffManager,
        private readonly fileOperationManager: FileOperationManager,
        private readonly onOpenConfig: (page?: string, taskId?: string) => void,
        private readonly context: vscode.ExtensionContext,
        private readonly sessionController: SessionController
    ) { }

    private static readonly INPUT_HISTORY_KEY = 'sema.inputHistory';
    private static readonly INPUT_HISTORY_MAX = 50;

    public setWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        const workspaceFolderUris = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
        this.view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri, ...workspaceFolderUris]
        };
        this.view.webview.html = this.getHtmlContent(this.view.webview);

        this.view.webview.onDidReceiveMessage(async (msg) => {
            const sid: string | undefined = msg.sessionId;
            const handlers: Record<string, () => Promise<void> | void> = {
                // ── 会话生命周期 ──
                frontendReady: () => this.onFrontendReady(),
                createSession: () => { void this.sessionController.createSession(msg.mode); },
                switchSession: () => this.sessionController.switchSession(msg.sessionId),
                closeSession: () => this.sessionController.closeSession(msg.sessionId),
                webviewSessionReady: () => this.sessionController.getSessionWrapper(msg.sessionId)?.sendInitialState(),

                // ── 会话级交互 ──
                sendInput: () => this.handleUserInput(sid, msg.text, msg.files, msg.attachments),
                interrupt: () => this.interrupt(sid),
                toolPermissionResponse: () => this.sessionController.getSessionWrapper(sid!)?.respondToToolPermission(msg.response),
                askFormResponse: () => this.sessionController.getSessionWrapper(sid!)?.respondToPickOption(msg.response),
                planExitResponse: () => this.handlePlanExitResponse(sid, msg.response),
                insertPermissionRequest: () => this.sessionController.getSessionWrapper(sid!)?.insertPermissionRequestMessage(msg.permissionData),
                insertAskFormRequest: () => this.sessionController.getSessionWrapper(sid!)?.insertAskFormRequestMessage(msg.askFormData),
                updateAgentMode: () => this.sessionController.getSessionWrapper(sid!)?.updateAgentMode(msg.mode),
                updatePermissionLevel: () => this.sessionController.getSessionWrapper(sid!)?.updatePermissionLevel(msg.level),
                transferAgentToBackground: () => { this.sessionController.getSessionWrapper(sid!)?.transferAgentToBackground(msg.taskId); },

                // ── 进程级 / 工具类 ──
                openConfig: () => this.onOpenConfig(msg.page, msg.taskId),
                openFile: () => this.fileOperationManager.openFileAtLine(msg.filePath, msg.line, msg.endLine),
                requestWorkspaceFiles: () => this.sendWorkspaceFiles(msg.reqId),
                searchWorkspaceFiles: () => this.searchWorkspaceFiles(msg.query || '', msg.reqId),
                requestModelInfo: () => this.sendModelInfo(),
                switchModel: () => this.switchModel(msg.modelName),
                restoreFromSnapshots: () => this.restoreFromSnapshots(sid, msg.filePaths),
                restoreFromSnapshot: () => this.restoreFromSnapshot(sid, msg.filePath),
                getForkPreview: () => this.handleGetForkPreview(sid, msg.uuid, msg.reqId),
                forkSession: () => this.handleForkSession(sid, msg.uuid, msg.restoreFiles, msg.reqId),
                showFileDiff: () => this.fileStateDiffManager.showFileDiff(sid!, msg.filePath, msg.minLine),
                showPermissionDiff: () => this.fileStateDiffManager.showPermissionDiff(sid!, msg.filePath, msg.diffContent),
                getFileChangeStats: () => this.getFileChangeStats(sid, msg.filePath),
                searchContentInFiles: () => this.searchContentInFiles(msg.content),
                requestClipboardFiles: () => this.requestClipboardFiles(),
                verifyFilePath: () => this.verifyFilePath(msg.filePath, msg.tempId, msg.originalCode, msg.lineInfo),
                resolveImagePath: () => this.resolveImagePath(msg.filePath, msg.tempId),
                openExternal: () => this.openExternal(msg.url),
                requestSystemConfig: () => this.sendSystemConfig(),
                requestCommands: () => this.sendCommands(),
                requestSkills: () => this.sendSkills(),
                requestAgents: () => this.sendAgents(),
                openBashOutput: () => this.fileOperationManager.openBashOutputAsDocument(msg.content, msg.command, msg.toolId),
                requestInputHistory: () => this.sendInputHistory(),
                saveInputHistory: () => this.appendInputHistory(msg.item),
            };
            await handlers[msg.type]?.();
        });
    }

    public postMessage(message: any): void {
        this.view?.webview.postMessage(message);
    }

    /** 清空指定会话的面板（权限/表单/计划/待办/文件变更等） */
    public clearSessionPanels(sessionId: string): void {
        this.postMessage({ type: 'closePermissionPanel', sessionId });
        this.postMessage({ type: 'closeAskFormPanel', sessionId });
        this.postMessage({ type: 'closePlanExitPanel', sessionId });
        this.postMessage({ type: 'clearPendingInputs', sessionId });
        this.postMessage({ type: 'clearTodos', sessionId });
        this.postMessage({ type: 'clearFileChanges', sessionId });
    }

    // ─── 消息 handlers ────────────────────────────────────────────────────────

    private async onFrontendReady(): Promise<void> {
        await this.sessionController.createSession();
        await this.checkConfiguration();
    }

    private async handleUserInput(sessionId: string | undefined, text: string, files?: Array<any>, attachments?: InputImageAttachment[]): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper) return;
        try {
            let content = text;
            if (files && files.length > 0) {
                const refs = files.map((file: any) => ({
                    encoded: formatFileReference(file),
                    display: formatFileReference(file, false)
                }));
                for (const { encoded, display } of refs) {
                    if (encoded !== display) {
                        content = content.split(display).join(encoded);
                    }
                }
                const fileContext = refs
                    .filter(({ encoded }: { encoded: string; display: string }) => !content.includes(encoded))
                    .map(({ encoded }: { encoded: string }) => encoded)
                    .join(' ');
                content = fileContext ? `${content} ${fileContext} ` : content;
            }

            const transformedContent = transformCommandToPrompt(content);
            if (transformedContent && transformedContent !== content) {
                wrapper.processUserInput(transformedContent, content, attachments);
            } else {
                wrapper.processUserInput(content, undefined, attachments);
            }
        } catch (error) {
            this.postMessage({
                type: 'error',
                sessionId,
                message: error instanceof Error ? error.message : '处理用户输入时发生错误'
            });
        }
    }

    private interrupt(sessionId: string | undefined): void {
        if (!sessionId) return;
        const wrapper = this.sessionController.getSessionWrapper(sessionId);
        if (!wrapper) return;
        try {
            this.postMessage({ type: 'closePermissionPanel', sessionId });
            this.postMessage({ type: 'closeAskFormPanel', sessionId });
            this.postMessage({ type: 'closePlanExitPanel', sessionId });
            this.postMessage({ type: 'clearPendingInputs', sessionId });
            wrapper.interruptSession();
            wrapper.stopAllTasks();
        } catch (error) {
            console.error('Error interrupting session:', error);
        }
    }

    private async handlePlanExitResponse(sessionId: string | undefined, response: any): Promise<void> {
        if (!sessionId) return;
        const wrapper = this.sessionController.getSessionWrapper(sessionId);
        if (!wrapper) return;

        if (response.selected === 'clearContextAndStart') {
            wrapper.clearMessageHistory();
            this.postMessage({ type: 'closePermissionPanel', sessionId });
            this.postMessage({ type: 'closeAskFormPanel', sessionId });
            this.postMessage({ type: 'closePlanExitPanel', sessionId });
            this.postMessage({ type: 'clearPendingInputs', sessionId });
            this.postMessage({ type: 'clearTodos', sessionId });
            this.postMessage({ type: 'resetTokenInfo', sessionId });
        }
        wrapper.respondToPlanExit(response);
        wrapper.updateAgentMode('Agent');
        this.postMessage({ type: 'agentModeUpdate', sessionId, mode: 'Agent' });
    }

    private async sendWorkspaceFiles(reqId?: number): Promise<void> {
        const files = await this.fileOperationManager.getWorkspaceFiles();
        this.postMessage({
            type: 'workspaceFiles',
            reqId,
            files: files.map(item => ({ path: item.path, isDirectory: item.isDirectory, isOpen: item.isOpen }))
        });
    }

    private async searchWorkspaceFiles(query: string, reqId?: number): Promise<void> {
        const files = await this.fileOperationManager.searchWorkspaceFiles(query);
        this.postMessage({
            type: 'workspaceFiles',
            reqId,
            files: files.map(item => ({ path: item.path, isDirectory: item.isDirectory, isOpen: item.isOpen }))
        });
    }

    private async sendSystemConfig(): Promise<void> {
        try {
            const config = this.processWrapper.getSystemConfig();
            this.postMessage({
                type: 'systemConfigUpdate',
                skipFileEditPermission: config.skipFileEditPermission || false,
                thinking: config.thinking !== false,
                showThinkingText: (config as Record<string, any>).showThinkingText !== false
            });
        } catch (error) {
            console.error('Error sending system config:', error);
        }
    }

    private async sendModelInfo(): Promise<void> {
        try {
            const modelData = await this.processWrapper.getModelData();
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
            await this.processWrapper.switchModel(modelName);
        } catch (error) {
            this.postMessage({ type: 'error', message: `切换模型失败: ${error instanceof Error ? error.message : '未知错误'}` });
        }
    }

    private async restoreFromSnapshots(sessionId: string | undefined, filePaths: string[]): Promise<void> {
        if (!sessionId) return;
        await this.fileStateDiffManager.revertAllChanges(sessionId, filePaths);
        this.postMessage({ type: 'clearFileChanges', sessionId });
    }

    private async restoreFromSnapshot(sessionId: string | undefined, filePath: string): Promise<void> {
        if (!sessionId || !filePath) return;
        await this.fileStateDiffManager.revertAllChanges(sessionId, [filePath]);
        this.postMessage({ type: 'removeFileChange', sessionId, filePath });
    }

    private handleGetForkPreview(sessionId: string | undefined, uuid: string, reqId: string): void {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper || !uuid) {
            this.postMessage({ type: 'forkPreviewResult', sessionId, reqId, error: '无法获取 fork 预览' });
            return;
        }
        try {
            const preview = wrapper.getForkPreview(uuid);
            this.postMessage({ type: 'forkPreviewResult', sessionId, reqId, preview });
        } catch (error) {
            this.postMessage({
                type: 'forkPreviewResult', sessionId, reqId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async handleForkSession(sessionId: string | undefined, uuid: string, restoreFiles: boolean, reqId: string): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper || !uuid) {
            this.postMessage({ type: 'forkResult', sessionId, reqId, uuid, result: { ok: false, error: '会话不可用' } });
            return;
        }
        try {
            const result = await wrapper.fork(uuid, { restoreFiles: !!restoreFiles });
            this.postMessage({ type: 'forkResult', sessionId, reqId, uuid, result });
        } catch (error) {
            this.postMessage({
                type: 'forkResult', sessionId, reqId, uuid,
                result: { ok: false, error: error instanceof Error ? error.message : String(error) }
            });
        }
    }

    private async getFileChangeStats(sessionId: string | undefined, filePath: string): Promise<void> {
        if (!sessionId || !filePath) return;
        try {
            const stats = await this.fileStateDiffManager.getFileChangeStats(sessionId, filePath);
            this.postMessage({ type: 'fileChangeStats', sessionId, fullPath: filePath, stats });
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

    private async requestClipboardFiles(): Promise<void> {
        try {
            const paths = await this.fileOperationManager.readClipboardFiles();
            this.postMessage({ type: 'clipboardFilesResult', paths });
        } catch (error) {
            console.error('Failed to read clipboard files:', error);
            this.postMessage({ type: 'clipboardFilesResult', paths: [] });
        }
    }

    private async resolveImagePath(filePath: string, tempId: string): Promise<void> {
        try {
            const dataUri = await this.fileOperationManager.resolveImageDataUri(filePath);
            if (!dataUri) {
                this.postMessage({ type: 'imagePathResolved', tempId, exists: false });
                return;
            }
            this.postMessage({ type: 'imagePathResolved', tempId, exists: true, src: dataUri });
        } catch (error) {
            console.error('Failed to resolve image path:', error);
            this.postMessage({ type: 'imagePathResolved', tempId, exists: false });
        }
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

    private openExternal(url: string): void {
        if (!url) return;
        try {
            vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (error) {
            console.error('Failed to open external url:', error);
        }
    }

    private sendInputHistory(): void {
        const items = this.context.workspaceState.get<any[]>(ChatWebviewProvider.INPUT_HISTORY_KEY, []);
        this.postMessage({ type: 'inputHistoryLoaded', items: Array.isArray(items) ? items : [] });
    }

    private async appendInputHistory(item: any): Promise<void> {
        if (!item || typeof item.text !== 'string' || !item.text.trim()) return;
        const list = this.context.workspaceState.get<any[]>(ChatWebviewProvider.INPUT_HISTORY_KEY, []);
        const arr = Array.isArray(list) ? list.slice() : [];
        const last = arr[arr.length - 1];
        const isDup = last && last.text === item.text
            && JSON.stringify(last.mentions || []) === JSON.stringify(item.mentions || []);
        if (!isDup) arr.push(item);
        while (arr.length > ChatWebviewProvider.INPUT_HISTORY_MAX) arr.shift();
        await this.context.workspaceState.update(ChatWebviewProvider.INPUT_HISTORY_KEY, arr);
    }

    private async sendCommands(): Promise<void> {
        try {
            const commands = await this.processWrapper.getCommandsInfo();
            this.postMessage({ type: 'customCommandsLoaded', commands });
        } catch (error) {
            console.error('Error loading commands:', error);
        }
    }

    private async sendSkills(): Promise<void> {
        try {
            const skills = await this.processWrapper.getSkillsInfo();
            this.postMessage({ type: 'skillsLoaded', skills });
        } catch (error) {
            console.error('Error loading skills:', error);
        }
    }

    private async sendAgents(): Promise<void> {
        try {
            const agents = await this.processWrapper.getAgentsInfo();
            this.postMessage({ type: 'agentsLoaded', agents });
        } catch (error) {
            console.error('Error loading agents:', error);
        }
    }

    private async checkConfiguration(): Promise<void> {
        try {
            const modelData = await this.processWrapper.getModelData();
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
        font-src ${webview.cspSource} data:;
        img-src ${webview.cspSource} https: data: blob:;">
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
