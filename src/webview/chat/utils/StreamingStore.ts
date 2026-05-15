type TextListener = (data: { contentDelta?: string; reasoningDelta?: string }) => void;
type ToolListener = (delta: string) => void;

class StreamingStore {
    private textListeners = new Map<string, Set<TextListener>>();
    private toolListeners = new Map<string, Set<ToolListener>>();
    // 缓冲区：在订阅者就位前累积内容，订阅时一次性回放
    private textBuffers = new Map<string, { content: string; reasoning: string }>();
    private toolBuffers = new Map<string, string>();

    subscribeText(id: string, cb: TextListener): () => void {
        if (!this.textListeners.has(id)) {
            this.textListeners.set(id, new Set());
        }
        this.textListeners.get(id)!.add(cb);
        // 回放已缓冲的内容
        const buf = this.textBuffers.get(id);
        if (buf) {
            if (buf.content) cb({ contentDelta: buf.content });
            if (buf.reasoning) cb({ reasoningDelta: buf.reasoning });
        }
        return () => {
            const set = this.textListeners.get(id);
            set?.delete(cb);
            if (set?.size === 0) this.textListeners.delete(id);
        };
    }

    subscribeTool(id: string, cb: ToolListener): () => void {
        if (!this.toolListeners.has(id)) {
            this.toolListeners.set(id, new Set());
        }
        this.toolListeners.get(id)!.add(cb);
        // 回放已缓冲的内容
        const buf = this.toolBuffers.get(id);
        if (buf) {
            cb(buf);
        }
        return () => {
            const set = this.toolListeners.get(id);
            set?.delete(cb);
            if (set?.size === 0) this.toolListeners.delete(id);
        };
    }

    emitText(id: string, data: { contentDelta?: string; reasoningDelta?: string }): void {
        // 累积到缓冲区
        if (!this.textBuffers.has(id)) {
            this.textBuffers.set(id, { content: '', reasoning: '' });
        }
        const buf = this.textBuffers.get(id)!;
        if (data.contentDelta) buf.content += data.contentDelta;
        if (data.reasoningDelta) buf.reasoning += data.reasoningDelta;

        this.textListeners.get(id)?.forEach(cb => cb(data));
    }

    emitTool(id: string, delta: string): void {
        // 累积到缓冲区
        this.toolBuffers.set(id, (this.toolBuffers.get(id) || '') + delta);

        this.toolListeners.get(id)?.forEach(cb => cb(delta));
    }

    clear(): void {
        this.textListeners.clear();
        this.toolListeners.clear();
        this.textBuffers.clear();
        this.toolBuffers.clear();
    }
}

export const streamingStore = new StreamingStore();
