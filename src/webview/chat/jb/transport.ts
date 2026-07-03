// 低层传输：对接 Kotlin 注入的 window.__semaHostQuery / __semaHostToWeb。
// 帧与 sema-grpc 的 BridgeCommand/BridgeEvent 对应（sema-core 透明镜像，此处不做协议翻译）。

type GrpcEventHandler = (event: string, data: any, sessionId: string) => void;
type AppMessageHandler = (msg: any) => void;

interface Pending {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
}

function safeParse(s: string): any {
    try { return JSON.parse(s); } catch { return s; }
}

export class Transport {
    private seq = 0;
    private pending = new Map<string, Pending>();
    private eventHandler: GrpcEventHandler | null = null;
    private appMessageHandler: AppMessageHandler | null = null;
    private hostCommandHandler: AppMessageHandler | null = null;

    constructor() {
        (window as any).__semaHostToWeb = (json: string) => this.onHostFrame(json);
    }

    setEventHandler(h: GrpcEventHandler): void {
        this.eventHandler = h;
    }

    /**
     * 宿主（Kotlin 标题栏 Action / 历史面板）主动下发的入站命令（channel=host）。
     * 与 setAppMessageHandler 不同：这里是「宿主 → controller 入站」（如 createSession /
     * loadHistorySession），交给 controller 当作一条 web 消息处理；appMessageHandler 是「宿主 → UI」。
     */
    setHostCommandHandler(h: AppMessageHandler): void {
        this.hostCommandHandler = h;
    }

    /** 编辑器侧（Kotlin）回推的 UI 消息（如 fileChangeStats）直接灌给 app。 */
    setAppMessageHandler(h: AppMessageHandler): void {
        this.appMessageHandler = h;
    }

    /** 调用一个 sema-core 方法（action 名 = core 方法名）。resolve 为该命令 ack 的 data。 */
    call(action: string, payload?: any, sessionId = ''): Promise<any> {
        const id = `c${++this.seq}`;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.sendToHost({
                channel: 'grpc',
                id,
                action,
                payload: payload !== undefined ? JSON.stringify(payload) : '',
                sessionId,
            });
        });
    }

    /** 编辑器操作（Kotlin 本地处理，不进 sidecar）——即发即忘。 */
    editor(type: string, extra: Record<string, any> = {}): void {
        this.sendToHost({ channel: 'editor', type, ...extra });
    }

    /**
     * 编辑器操作的请求/应答版（Kotlin 本地处理并回值）。用于配置页的本地持久化
     * （systemConfig / disabledTools 等）：Kotlin 存盘后带同一 reqId 回帧，此处 resolve。
     */
    callEditor(type: string, payload?: any): Promise<any> {
        const reqId = `e${++this.seq}`;
        return new Promise((resolve, reject) => {
            this.pending.set(reqId, { resolve, reject });
            this.sendToHost({ channel: 'editor', type, reqId, payload: payload !== undefined ? JSON.stringify(payload) : '' });
        });
    }

    private sendToHost(obj: any): void {
        const fn = (window as any).__semaHostQuery;
        if (typeof fn === 'function') fn(JSON.stringify(obj));
    }

    private onHostFrame(json: string): void {
        let frame: any;
        try { frame = JSON.parse(json); } catch { return; }

        // 宿主主动下发的入站命令（Kotlin Action / 历史面板 → controller）
        if (frame.channel === 'host') {
            const msg = frame.message ? safeParse(frame.message) : undefined;
            if (msg) this.hostCommandHandler?.(msg);
            return;
        }

        // 编辑器侧回帧
        if (frame.channel === 'editor') {
            // callEditor 的应答：带 reqId，命中挂起的 promise
            if (frame.reqId) {
                const p = this.pending.get(frame.reqId);
                if (p) {
                    this.pending.delete(frame.reqId);
                    const data = frame.data ? safeParse(frame.data) : undefined;
                    if (frame.error) p.reject(new Error(typeof frame.error === 'string' ? frame.error : '编辑器操作失败'));
                    else p.resolve(data);
                    return;
                }
            }
            // 主动回推的 UI 消息（channel=editor，message 为 JSON 字符串）→ 直接派发给 app
            const msg = frame.message ? safeParse(frame.message) : undefined;
            if (msg) this.appMessageHandler?.(msg);
            return;
        }

        if (frame.channel !== 'grpc') return;

        const { event, cmdId, sessionId } = frame;
        const data = frame.data ? safeParse(frame.data) : undefined;

        // ack / error：命中挂起的 call
        if (event === 'ack' || event === 'error') {
            const p = cmdId ? this.pending.get(cmdId) : undefined;
            if (p) {
                this.pending.delete(cmdId);
                if (event === 'ack') p.resolve(data);
                else p.reject(new Error(data?.message || '命令失败'));
            }
            return;
        }

        // 会话级事件（sema-core 原始事件名）→ 交给上层按 sessionId 派发
        this.eventHandler?.(event, data, sessionId || '');
    }
}
