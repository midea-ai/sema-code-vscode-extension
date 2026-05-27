import * as vscode from 'vscode';
import { SessionHistoryManager } from '../../managers/SessionHistoryManager';

// 定义回调函数类型
export interface SessionHistoryCallbacks {
    loadSession?: (sessionId: string) => Promise<void>;
}

/**
 * SessionHistoryWebviewProvider 类 - 管理历史会话的独立 Webview 面板
 */
export class SessionHistoryWebviewProvider {
    private panel?: vscode.WebviewPanel;
    private sessionHistoryManager: SessionHistoryManager;
    private callbacks: SessionHistoryCallbacks;

    constructor(
        sessionHistoryManager: SessionHistoryManager,
        callbacks: SessionHistoryCallbacks = {}
    ) {
        this.sessionHistoryManager = sessionHistoryManager;
        this.callbacks = callbacks;
    }

    /**
     * 显示历史会话面板
     */
    public async show(extensionUri: vscode.Uri) {

        // 如果面板已存在，则显示并更新内容
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            await this.refreshSessionList();
            return;
        }

        // 创建新面板
        this.panel = vscode.window.createWebviewPanel(
            'semaHistoryWebview',
            '历史会话',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
                retainContextWhenHidden: true
            }
        );

        // 生成HTML时不需要预先获取数据，React应用会在准备好后请求
        this.panel.webview.html = this.getHtmlContent(this.panel.webview, extensionUri);

        // 处理消息
        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'webviewReady': {
                    // React 应用已准备好，发送会话数据
                    const { sessions: currentSessions, currentSessionId: activeSessionId, openSessionIds } =
                        await this.sessionHistoryManager.getSessionsWithActiveId();
                    this.panel?.webview.postMessage({
                        type: 'updateSessions',
                        sessions: currentSessions,
                        currentSessionId: activeSessionId,
                        openSessionIds
                    });
                    break;
                }
                case 'loadSession':
                    if (this.callbacks.loadSession) {
                        try {
                            await this.callbacks.loadSession(message.sessionId);
                        } catch (error) {
                            console.error('Failed to load session:', error);
                            vscode.window.showErrorMessage(`加载会话失败：${error instanceof Error ? error.message : '未知错误'}`);
                        }
                    }
                    await this.refreshSessionList();
                    break;
                case 'deleteSession':
                    // 禁止删除已在 chat 中打开的会话（含活跃会话）
                    if (this.sessionHistoryManager.getOpenSessionIds().includes(message.sessionId)) {
                        vscode.window.showWarningMessage('无法删除已打开的会话');
                        return;
                    }

                    await this.sessionHistoryManager.deleteSession(message.sessionId);
                    await this.refreshSessionList();
                    break;
            }
        });

        // 面板关闭时清理
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    /**
     * 刷新会话列表（用于外部调用）
     */
    public async refreshSessionList(): Promise<void> {
        if (!this.panel) { return; }
        const { sessions, currentSessionId, openSessionIds } = await this.sessionHistoryManager.getSessionsWithActiveId();
        this.panel.webview.postMessage({
            type: 'updateSessions',
            sessions,
            currentSessionId,
            openSessionIds
        });
    }

    /**
     * 生成 HTML 内容 - 加载 React 应用
     */
    private getHtmlContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'sessionHistory.js')
        );

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src ${webview.cspSource};">
    <title>历史会话</title>
</head>
<body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

}


