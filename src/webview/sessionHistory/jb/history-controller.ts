import { Transport } from '../../chat/jb/transport';

/**
 * 历史会话面板（JB 版）的消息控制器。复刻 VSCode 的 sessionHistoryWebview 协议，
 * 但数据源换成 Kotlin 本地存储（callEditor('history', ...)）。
 * - webviewReady → 拉列表并回 updateSessions
 * - loadSession  → 转 Kotlin（Kotlin 经 bus 推给聊天 webview 重放，即发即忘）
 * - deleteSession→ 转 Kotlin 删除，成功后经 gRPC 通知 core 清理历史文件，再刷新列表
 * Kotlin 主动推的 updateSessions（会话变化时）经 transport.appMessageHandler 灌回 App。
 */
export class HistoryController {
    constructor(private t: Transport, private postToApp: (msg: any) => void) {
        this.t.setAppMessageHandler((m) => this.postToApp(m));
    }

    async handleWebMessage(msg: any): Promise<void> {
        switch (msg.type) {
            case 'webviewReady':
                await this.sendList();
                break;
            case 'loadSession':
                this.t.editor('history', { payload: JSON.stringify({ op: 'load', sessionId: msg.sessionId }) });
                break;
            case 'deleteSession':
                // 已打开的会话 Kotlin 会拒绝（抛错），忽略即可；列表随后刷新
                try {
                    await this.t.callEditor('history', { op: 'delete', sessionId: msg.sessionId });
                    // 本地存档删除成功后，同步清理 core 侧 ~/.sema/history 下的会话历史文件（core 未支持时静默）
                    try { await this.t.call('deleteSessionHistory', { sessionId: msg.sessionId }, ''); } catch { /* ignore */ }
                } catch { /* ignore */ }
                await this.sendList();
                break;
            default:
                break;
        }
    }

    private async sendList(): Promise<void> {
        try {
            const data = await this.t.callEditor('history', { op: 'list' });
            this.postToApp({
                type: 'updateSessions',
                sessions: data?.sessions ?? [],
                currentSessionId: data?.currentSessionId ?? null,
                openSessionIds: data?.openSessionIds ?? [],
            });
        } catch {
            this.postToApp({ type: 'updateSessions', sessions: [], currentSessionId: null, openSessionIds: [] });
        }
    }
}
