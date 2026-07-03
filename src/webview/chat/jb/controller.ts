import { SemaSessionWrapper, SessionWrapperCallbacks } from '../../../core/semaSessionWrapper';
import { Transport } from './transport';
import { RemoteCore, RemoteSession } from './remote';

/** 同时打开的会话上限（对齐 semaProcessWrapper.MAX_SESSIONS = 5，本地常量避免拽入 node 依赖）。 */
const MAX_SESSIONS = 5;

/**
 * 复刻 VSCode 端 semaSidebarProvider + chatWebview 的「会话编排 + 消息路由」，
 * 但用 RemoteCore/RemoteSession（走 gRPC）替代进程内对象。
 * SemaSessionWrapper 原样复用 —— 它产出的 UI 消息经 postToApp 回灌给 React。
 */
export class Controller {
    private core: RemoteCore;
    private sessions = new Map<string, { wrapper: SemaSessionWrapper; remote: RemoteSession }>();
    private activeSessionId: string | null = null;
    private initialized = false;
    /** createSession ack 返回前到达的会话事件，先按 sessionId 缓冲，wrapper 就绪后回放。 */
    private eventBuffer = new Map<string, Array<{ event: string; data: any }>>();
    /** 会话历史存档防抖定时器（对齐 semaSidebarProvider.saveSessionTimers，300ms）。 */
    private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private t: Transport, private postToApp: (msg: any) => void) {
        this.core = new RemoteCore(t);
        t.setEventHandler((event, data, sessionId) => this.onGrpcEvent(event, data, sessionId));
        // Kotlin 编辑器侧回推的 UI 消息（如 fileChangeStats）直接灌回 app
        t.setAppMessageHandler((m) => this.postToApp(m));
        // 宿主主动下发的入站命令（标题栏「新建会话」Action / 历史面板「加载会话」）→ 当作 web 消息处理
        t.setHostCommandHandler((m) => { void this.handleWebMessage(m); });
    }

    private onGrpcEvent(event: string, data: any, sessionId: string): void {
        const entry = sessionId ? this.sessions.get(sessionId) : undefined;
        if (entry) { entry.remote.emit(event, data); return; }
        if (sessionId) {
            const buf = this.eventBuffer.get(sessionId) ?? [];
            buf.push({ event, data });
            this.eventBuffer.set(sessionId, buf);
        }
    }

    /** 所有会话共用一份回调（对齐 semaSidebarProvider.sessionCallbacks）。 */
    private get callbacks(): SessionWrapperCallbacks {
        return {
            onMessage: (m) => this.postToApp(m),
            onSessionReady: () => {},
            // 存档触发点（对齐 semaSidebarProvider）：状态回 idle、话题更新时防抖存历史。
            onStateChange: (sid, state) => { if (state === 'idle') this.debouncedSaveSession(sid); },
            onTopicUpdate: (sid) => this.debouncedSaveSession(sid),
            // 快照触发点：write/edit 工具完成时，用 patch 反推出改动前的原始内容存快照（幂等）。
            // 不在"读文件时"抓：sidecar 独立进程写盘，宿主异步快照有竞态会抓到写后内容。
            onToolExecutionComplete: (_sid, data: any) => this.requestSnapshotFromPatch(data),
            onFileReference: () => {},
            onTaskStart: (sessionId, data) => this.postToApp({ type: 'taskStart', sessionId, data }),
            onTaskEnd: (sessionId, data) => this.postToApp({ type: 'taskEnd', sessionId, data }),
            onSessionCleared: (sessionId) => { this.t.editor('resetSnapshots'); this.clearPanels(sessionId); },
            onOpenAgentDetail: (sessionId, taskId) => this.postToApp({ type: 'openAgentDetail', sessionId, taskId }),
            onUserResponded: () => {},
            onTitleUpdate: (sessionId, title) => this.postToApp({ type: 'sessionTitleUpdate', sessionId, title }),
        };
    }

    /** 入站：对齐 chatWebview 的 handlers 表（MVP 聊天子集 + 编辑器转发）。 */
    async handleWebMessage(msg: any): Promise<void> {
        const sid: string | undefined = msg.sessionId;
        switch (msg.type) {
            case 'frontendReady':
                await this.ensureInit();
                await this.createSession({ mode: msg.mode });
                await this.checkConfiguration();
                break;
            case 'createSession': await this.createSession({ mode: msg.mode }); break;
            // 从历史面板加载会话（跨 JCEF：Kotlin bus → host 通路下发）
            case 'loadHistorySession': await this.loadHistorySession(msg.session); break;
            case 'switchSession': if (sid) { this.activeSessionId = sid; this.reportState(); } break;
            case 'closeSession': this.closeSession(sid); break;
            case 'webviewSessionReady': this.sessions.get(sid ?? '')?.wrapper.sendInitialState(); break;

            case 'sendInput': this.handleUserInput(sid, msg.text, msg.attachments); break;
            case 'interrupt': this.interrupt(sid); break;
            case 'toolPermissionResponse': this.sessions.get(sid ?? '')?.wrapper.respondToToolPermission(msg.response); break;
            case 'askFormResponse': this.sessions.get(sid ?? '')?.wrapper.respondToPickOption(msg.response); break;
            case 'planExitResponse': this.handlePlanExit(sid, msg.response); break;
            case 'updateAgentMode': this.sessions.get(sid ?? '')?.wrapper.updateAgentMode(msg.mode); break;
            case 'updatePermissionLevel': this.sessions.get(sid ?? '')?.wrapper.updatePermissionLevel(msg.level); break;

            case 'requestModelInfo': await this.sendModelInfo(); break;
            case 'requestSystemConfig': this.sendSystemConfig(); break;
            case 'switchModel': await this.core.switchModel(msg.modelName).catch(() => {}); break;
            case 'requestCommands': this.postToApp({ type: 'customCommandsLoaded', commands: [] }); break;
            case 'requestSkills': this.postToApp({ type: 'skillsLoaded', skills: [] }); break;
            case 'requestAgents': this.postToApp({ type: 'agentsLoaded', agents: [] }); break;
            case 'requestInputHistory': this.postToApp({ type: 'inputHistoryLoaded', items: [] }); break;

            // 打开配置页（编辑器区独立 tab，由 Kotlin FileEditorManager 承载）
            case 'openConfig': this.t.editor('openConfig', { page: msg.page, taskId: msg.taskId }); break;

            // 编辑器操作 → 转发 Kotlin
            case 'openFile': this.t.editor('openFile', { filePath: msg.filePath, line: msg.line, endLine: msg.endLine }); break;
            case 'openExternal': this.t.editor('openExternal', { url: msg.url }); break;
            case 'showFileDiff': this.t.editor('showFileDiff', { filePath: msg.filePath, minLine: msg.minLine }); break;
            case 'showPermissionDiff': this.t.editor('showPermissionDiff', { filePath: msg.filePath, diffContent: msg.diffContent }); break;
            case 'getFileChangeStats': this.t.editor('getFileChangeStats', { filePath: msg.filePath, sessionId: sid }); break;

            // 拒绝/回滚：转发 Kotlin 用快照写回或删除，并同步清理 UI 面板（对齐 chatWebview）
            case 'restoreFromSnapshots':
                this.t.editor('revertFiles', { filePaths: msg.filePaths });
                this.postToApp({ type: 'clearFileChanges', sessionId: sid });
                break;
            case 'restoreFromSnapshot':
                this.t.editor('revertFile', { filePath: msg.filePath });
                this.postToApp({ type: 'removeFileChange', sessionId: sid, filePath: msg.filePath });
                break;

            // MVP 未接入的请求：立即回空，避免 UI 等待卡住
            case 'requestWorkspaceFiles': this.postToApp({ type: 'workspaceFiles', reqId: msg.reqId, files: [] }); break;
            case 'searchWorkspaceFiles': this.postToApp({ type: 'workspaceFiles', reqId: msg.reqId, files: [] }); break;

            default: break; // saveInputHistory 等：忽略
        }
    }

    private async ensureInit(): Promise<void> {
        if (this.initialized) return;
        await this.core.init({});
        this.initialized = true;
    }

    /**
     * 建会话。复刻 VSCode createNewSession 的历史重放：传 sessionId → sema-core 按 id 重新
     * 水合 LLM 上下文（可续聊）；传 historyContent → 纯客户端把历史 UI 消息灌回 React。
     */
    private async createSession(opts: { mode?: any; sessionId?: string; historyContent?: any[]; title?: string } = {}): Promise<void> {
        // 会话数上限（对齐 VSCode createNewSession）。已打开的历史会话走切 tab 不到这里。
        if (this.sessions.size >= MAX_SESSIONS) {
            this.postToApp({ type: 'sessionCreateFailed', error: `最多同时打开 ${MAX_SESSIONS} 个会话，请先关闭已有会话` });
            return;
        }
        const res = await this.core.createSession({ sessionId: opts.sessionId });
        if (!res.ok || !res.sessionId) {
            this.postToApp({ type: 'sessionCreateFailed', error: res.error });
            return;
        }
        const remote = new RemoteSession(res.sessionId, this.t);
        const wrapper = new SemaSessionWrapper(remote as any, this.callbacks, opts.mode ?? 'Agent');
        this.sessions.set(res.sessionId, { wrapper, remote });
        this.activeSessionId = res.sessionId;

        // 回放缓冲事件（如 session:ready）
        const buf = this.eventBuffer.get(res.sessionId);
        if (buf) {
            this.eventBuffer.delete(res.sessionId);
            for (const e of buf) remote.emit(e.event, e.data);
        }

        // 先建 tab（sessionOpened），再重放历史消息，保证 React 按 sessionId 能收到内容更新。
        this.postToApp({ type: 'sessionOpened', sessionId: res.sessionId, title: opts.title || '新会话' });
        if (opts.historyContent && opts.historyContent.length > 0) {
            if (opts.title) wrapper.updateTitle(opts.title);
            wrapper.updateMessageHistory(opts.historyContent);
        }
        this.reportState();
    }

    /**
     * 从历史面板加载会话：已打开则切 tab；否则用原 id + historyContent 建会话并重放
     * （对齐 semaSidebarProvider.loadHistorySession）。
     */
    private async loadHistorySession(session: any): Promise<void> {
        if (!session?.id) return;
        if (this.sessions.has(session.id)) {
            this.activeSessionId = session.id;
            this.postToApp({ type: 'switchToSession', sessionId: session.id });
            this.reportState();
            return;
        }
        await this.createSession({
            sessionId: session.id,
            historyContent: session.content,
            title: session.title,
            mode: session.agentMode,
        });
    }

    private handleUserInput(sid: string | undefined, text: string, attachments?: any): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        entry.wrapper.processUserInput(text, undefined, attachments);
    }

    private interrupt(sid: string | undefined): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        this.clearPanels(sid!);
        entry.wrapper.interruptSession();
    }

    private handlePlanExit(sid: string | undefined, response: any): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        entry.wrapper.respondToPlanExit(response);
        entry.wrapper.updateAgentMode('Agent');
        this.postToApp({ type: 'agentModeUpdate', sessionId: sid, mode: 'Agent' });
    }

    private closeSession(sid: string | undefined): void {
        if (!sid) return;
        // 关闭前立即存档（对齐 VSCode closeSession → saveSession）
        this.saveSession(sid);
        const timer = this.saveTimers.get(sid);
        if (timer) { clearTimeout(timer); this.saveTimers.delete(sid); }
        this.core.closeSession(sid);
        this.sessions.delete(sid);
        if (this.activeSessionId === sid) {
            this.activeSessionId = this.sessions.keys().next().value ?? null;
        }
        this.postToApp({ type: 'sessionClosed', sessionId: sid, nextActiveId: this.activeSessionId });
        this.reportState();
    }

    private async sendModelInfo(): Promise<void> {
        try {
            const d = await this.core.getModelData();
            this.postToApp({ type: 'updateModelInfo', modelName: d?.modelName || '', availableModels: d?.modelList || [] });
        } catch (e: any) {
            this.postToApp({ type: 'error', message: `获取模型信息失败: ${e?.message || ''}` });
        }
    }

    private sendSystemConfig(): void {
        // MVP：JB 端暂无系统配置持久化，给默认值让 UI 正常渲染
        this.postToApp({ type: 'systemConfigUpdate', skipFileEditPermission: false, thinking: true, showThinkingText: true });
    }

    private async checkConfiguration(): Promise<void> {
        try {
            const d = await this.core.getModelData();
            if (!d?.modelName) this.postToApp({ type: 'showModelConfigReminder' });
        } catch {
            this.postToApp({ type: 'showModelConfigReminder' });
        }
    }

    /**
     * write/edit 工具完成 → 让 Kotlin 用 patch 反推出改动前的原始内容并存快照（幂等）。
     * type='new'（新建文件）不需要原始快照（回滚＝删除），Kotlin 侧跳过。
     */
    private requestSnapshotFromPatch(data: any): void {
        const content = data?.content;
        const title: string | undefined = data?.title;
        if (!title || !content || (content.type !== 'diff' && content.type !== 'new') || !Array.isArray(content.patch)) return;
        this.t.editor('snapshotFromPatch', { filePath: title, patchType: content.type, patch: content.patch });
    }

    // ─── 会话历史存档（对齐 SessionHistoryManager，存盘在 Kotlin）──────────────

    /** 上报当前打开的会话 id 列表 + 活跃 id 给 Kotlin，供历史列表徽标/排序。 */
    private reportState(): void {
        this.t.editor('history', {
            payload: JSON.stringify({
                op: 'reportState',
                openIds: Array.from(this.sessions.keys()),
                activeId: this.activeSessionId,
            }),
        });
    }

    private debouncedSaveSession(sid: string | undefined): void {
        if (!sid) return;
        const existing = this.saveTimers.get(sid);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.saveTimers.delete(sid);
            this.saveSession(sid);
        }, 300);
        this.saveTimers.set(sid, timer);
    }

    /** 构造会话记录（清洗后）→ 存 Kotlin。空标题/空消息不存（对齐 SessionHistoryManager.saveSession）。 */
    private saveSession(sid: string | undefined): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        const wrapper = entry.wrapper;
        const title = wrapper.title;
        if (!title) return;
        const messages = this.sanitizeMessages(wrapper.getMessageHistory() || []);
        if (messages.length === 0) return;
        const session = {
            id: wrapper.sessionId,
            title,
            content: messages,
            agentMode: wrapper.getAgentMode?.() ?? 'Agent',
        };
        this.t.editor('history', { payload: JSON.stringify({ op: 'save', session }) });
    }

    /** 过滤不完整 assistant 消息，running 的 Agent Task 标记 interrupted（复刻 SessionHistoryManager）。 */
    private sanitizeMessages(messages: any[]): any[] {
        const result: any[] = [];
        for (const m of messages) {
            if (m.type === 'assistant') {
                const isCompleted = m.content?.completed === true;
                const hasContent = m.content?.content && m.content.content.length > 0;
                if (!isCompleted && !hasContent) continue;
            }
            if (m.type === 'tool' && m.toolName === 'Agent' && m.content?.status === 'running') {
                result.push({ ...m, content: { ...m.content, status: 'interrupted' } });
            } else {
                result.push(m);
            }
        }
        return result;
    }

    private clearPanels(sessionId: string): void {
        const types = ['closePermissionPanel', 'closeAskFormPanel', 'closePlanExitPanel', 'clearPendingInputs', 'clearTodos', 'clearFileChanges'];
        for (const type of types) this.postToApp({ type, sessionId });
    }
}
