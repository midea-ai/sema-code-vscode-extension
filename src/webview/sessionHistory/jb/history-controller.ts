import { Transport } from '../../chat/jb/transport';
import { searchSessionMessages, type SessionSearchHit } from '../search';
import { turnNavItems } from '../../chat/utils/turnNav';

/**
 * 历史会话面板（JB 版）的消息控制器。复刻 VSCode 的 sessionHistoryWebview 协议，
 * 但数据源换成 Kotlin 本地存储（callEditor('history', ...)）。
 * - webviewReady → 拉列表并回 updateSessions
 * - loadSession  → 转 Kotlin（Kotlin 经 bus 推给聊天 webview 重放，即发即忘）
 * - deleteSession→ 转 Kotlin 删除，成功后经 gRPC 通知 core 清理历史文件，再刷新列表
 * - searchSessions→ 用 list 已带回的 content 就地匹配（不额外读盘、不缓存）
 * Kotlin 主动推的 updateSessions（会话变化时）与 langUpdate（配置页改界面语言时，字段 lang）
 * 均为 channel=editor 的 message 帧，经 transport.appMessageHandler 原样灌回 App（App 自己 setLang）。
 */
export class HistoryController {
    /** 最近一次 list 的结果：JB 的 list 带完整 content，正文检索直接用它 */
    private sessions: any[] = [];

    constructor(private t: Transport, private postToApp: (msg: any) => void) {
        // Kotlin 主动推的列表（会话变化时）也同步给检索，保证正文匹配用最新数据
        this.t.setAppMessageHandler((m) => {
            if (m?.type === 'updateSessions') { this.sessions = m.sessions ?? []; }
            this.postToApp(m);
        });
    }

    async handleWebMessage(msg: any): Promise<void> {
        switch (msg.type) {
            case 'webviewReady':
                await this.sendList();
                break;
            case 'searchSessions': {
                const query = String(msg.query || '');
                const results: SessionSearchHit[] = [];
                for (const session of this.sessions) {
                    const content = Array.isArray(session?.content) ? session.content : [];
                    const hit = searchSessionMessages(String(session?.id || ''), content, query);
                    if (hit) { results.push(hit); }
                }
                this.postToApp({ type: 'searchResults', requestId: msg.requestId, query, results });
                break;
            }
            case 'sessionPreview': {
                // 悬浮预览：list 已把 content 带进内存，就地算最近 5 轮
                const session = this.sessions.find(s => s?.id === msg.sessionId);
                const content = Array.isArray(session?.content) ? session.content : [];
                this.postToApp({
                    type: 'sessionPreviewResult',
                    sessionId: msg.sessionId,
                    turns: turnNavItems(content, false).slice(-5),
                });
                break;
            }
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
            this.sessions = data?.sessions ?? [];
            this.postToApp({
                type: 'updateSessions',
                sessions: this.sessions,
                currentSessionId: data?.currentSessionId ?? null,
                openSessionIds: data?.openSessionIds ?? [],
            });
        } catch {
            this.sessions = [];
            this.postToApp({ type: 'updateSessions', sessions: [], currentSessionId: null, openSessionIds: [] });
        }
    }
}
