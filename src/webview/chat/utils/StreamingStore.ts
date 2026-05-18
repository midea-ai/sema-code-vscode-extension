type TextListener = (data: { contentDelta?: string; reasoningDelta?: string }) => void;
type ToolListener = (delta: string) => void;

/**
 * 流式消息缓冲：在订阅者就位前累积内容，订阅时一次性回放。
 * 多会话下按 sessionId 隔离，避免切换会话时误清其他会话的 buffer。
 */
class StreamingStore {
    private textListeners = new Map<string, Set<TextListener>>();
    private toolListeners = new Map<string, Set<ToolListener>>();
    private textBuffers = new Map<string, { content: string; reasoning: string }>();
    private toolBuffers = new Map<string, string>();

    private key(sessionId: string, id: string): string {
        return `${sessionId}::${id}`;
    }

    subscribeText(sessionId: string, id: string, cb: TextListener): () => void {
        const k = this.key(sessionId, id);
        if (!this.textListeners.has(k)) {
            this.textListeners.set(k, new Set());
        }
        this.textListeners.get(k)!.add(cb);
        const buf = this.textBuffers.get(k);
        if (buf) {
            if (buf.content) cb({ contentDelta: buf.content });
            if (buf.reasoning) cb({ reasoningDelta: buf.reasoning });
        }
        return () => {
            const set = this.textListeners.get(k);
            set?.delete(cb);
            if (set?.size === 0) this.textListeners.delete(k);
        };
    }

    subscribeTool(sessionId: string, id: string, cb: ToolListener): () => void {
        const k = this.key(sessionId, id);
        if (!this.toolListeners.has(k)) {
            this.toolListeners.set(k, new Set());
        }
        this.toolListeners.get(k)!.add(cb);
        const buf = this.toolBuffers.get(k);
        if (buf) {
            cb(buf);
        }
        return () => {
            const set = this.toolListeners.get(k);
            set?.delete(cb);
            if (set?.size === 0) this.toolListeners.delete(k);
        };
    }

    emitText(sessionId: string, id: string, data: { contentDelta?: string; reasoningDelta?: string }): void {
        const k = this.key(sessionId, id);
        if (!this.textBuffers.has(k)) {
            this.textBuffers.set(k, { content: '', reasoning: '' });
        }
        const buf = this.textBuffers.get(k)!;
        if (data.contentDelta) buf.content += data.contentDelta;
        if (data.reasoningDelta) buf.reasoning += data.reasoningDelta;

        this.textListeners.get(k)?.forEach(cb => cb(data));
    }

    emitTool(sessionId: string, id: string, delta: string): void {
        const k = this.key(sessionId, id);
        this.toolBuffers.set(k, (this.toolBuffers.get(k) || '') + delta);

        this.toolListeners.get(k)?.forEach(cb => cb(delta));
    }

    /** 清空指定会话的所有 buffer 与监听器 */
    clear(sessionId: string): void {
        const prefix = `${sessionId}::`;
        for (const k of [...this.textListeners.keys()]) {
            if (k.startsWith(prefix)) this.textListeners.delete(k);
        }
        for (const k of [...this.toolListeners.keys()]) {
            if (k.startsWith(prefix)) this.toolListeners.delete(k);
        }
        for (const k of [...this.textBuffers.keys()]) {
            if (k.startsWith(prefix)) this.textBuffers.delete(k);
        }
        for (const k of [...this.toolBuffers.keys()]) {
            if (k.startsWith(prefix)) this.toolBuffers.delete(k);
        }
    }
}

export const streamingStore = new StreamingStore();
