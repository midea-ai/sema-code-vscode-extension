import { SemaSessionWrapper, SessionWrapperCallbacks, PermissionLevel } from '../../../core/semaSessionWrapper';
import { transformCommandToPrompt } from '../../../utils/prompt';
import { TOOL_NAME_VIEW_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE } from '../../../utils/tool';
import { Transport } from './transport';
import { RemoteCore, RemoteSession } from './remote';

/** 同时打开的会话上限（对齐 semaProcessWrapper.MAX_SESSIONS = 5，本地常量避免拽入 node 依赖）。 */
const MAX_SESSIONS = 5;

// @file 引用格式化（1:1 复刻 chatWebview 的本地实现，helper 未导出故此处重写）。
const FILE_REFERENCE_QUOTE_REGEX = /[\s。，、；：！？""''「」『』（）《》〈〉【】,;!?]/;
function escapeQuotedFileReferencePath(filePath: string): string {
    return filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function formatFileReference(file: any, quoted = true): string {
    const pathText = String(file.path ?? '');
    const needsQuotes = quoted && FILE_REFERENCE_QUOTE_REGEX.test(pathText);
    const pathRef = needsQuotes ? `"${escapeQuotedFileReferencePath(pathText)}"` : pathText;
    const hasLineRange = file.startLine !== undefined && file.endLine !== undefined;
    return hasLineRange ? `@${pathRef}:${file.startLine}-${file.endLine}` : `@${pathRef}`;
}

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
        // 进程级事件（空 sessionId）：不属于任何会话，走进程级分发（D2/A2）。
        if (!sessionId) { this.onProcessEvent(event, data); return; }
        const entry = this.sessions.get(sessionId);
        if (entry) { entry.remote.emit(event, data); return; }
        const buf = this.eventBuffer.get(sessionId) ?? [];
        buf.push({ event, data });
        this.eventBuffer.set(sessionId, buf);
    }

    /**
     * 进程级事件（跨连接广播来的合成帧）。model:update 由配置页改模型后桥广播而来，
     * 转成聊天页可消费的 modelUpdate（对齐 VSCode semaSidebarProvider 推给聊天页的 {type:'modelUpdate'}）。
     */
    private onProcessEvent(event: string, data: any): void {
        switch (event) {
            case 'model:update': this.postToApp({ type: 'modelUpdate', data }); break;
            default: break;
        }
    }

    /** 所有会话共用一份回调（对齐 semaSidebarProvider.sessionCallbacks）。 */
    private get callbacks(): SessionWrapperCallbacks {
        return {
            onMessage: (m) => this.postToApp(m),
            // 读时快照（对齐 VSCode handleSessionReady）：按历史读过的文件补快照（按会话隔离）。
            onSessionReady: (sid, data: any) => {
                const ts = data?.readFileTimestamps;
                if (ts && typeof ts === 'object') for (const filePath of Object.keys(ts)) this.addFileToSnapshotIfNew(sid, filePath);
            },
            // 存档触发点（对齐 semaSidebarProvider）：状态回 idle、话题更新时防抖存历史。
            onStateChange: (sid, state) => { if (state === 'idle') this.debouncedSaveSession(sid); },
            onTopicUpdate: (sid) => this.debouncedSaveSession(sid),
            // 读时快照（对齐 VSCode handleToolExecutionComplete）：view_file 首次读文件时打快照；
            // 新建文件（write/patch 且 type==='new'）钉空基线，避免 fork 后重读把已改内容误当基线。
            onToolExecutionComplete: (sid, data: any) => {
                if (data?.toolName === TOOL_NAME_VIEW_FILE) {
                    this.addFileToSnapshotIfNew(sid, data.title);
                } else if (
                    (data?.toolName === TOOL_NAME_WRITE_FILE || data?.toolName === TOOL_NAME_PATCH_FILE) &&
                    data?.content && typeof data.content === 'object' && data.content.type === 'new'
                ) {
                    this.pinEmptySnapshotIfNew(sid, data.title);
                }
            },
            // 读时快照（对齐 VSCode handleFileReference）：@ 引用文件时打快照（按会话隔离）。
            onFileReference: (sid, data: any) => { for (const ref of data?.references ?? []) if (ref?.type === 'file' && ref?.name) this.addFileToSnapshotIfNew(sid, ref.name); },
            onTaskStart: (sessionId, data) => this.postToApp({ type: 'taskStart', sessionId, data }),
            onTaskEnd: (sessionId, data) => this.postToApp({ type: 'taskEnd', sessionId, data }),
            onSessionCleared: (sessionId) => { this.t.editor('resetSnapshots', { sessionId }); this.clearPanels(sessionId); },
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
                await this.createSession({ agentMode: msg.mode, permissionLevel: msg.permissionLevel });
                await this.checkConfiguration();
                break;
            case 'createSession': await this.createSession({ agentMode: msg.mode, permissionLevel: msg.permissionLevel }); break;
            // 从历史面板加载会话（跨 JCEF：Kotlin bus → host 通路下发）
            case 'loadHistorySession': await this.loadHistorySession(msg.session); break;
            case 'switchSession': if (sid) { this.activeSessionId = sid; this.core.setActiveSession(sid); this.reportState(); } break;
            case 'closeSession': this.closeSession(sid); break;
            case 'webviewSessionReady': this.sessions.get(sid ?? '')?.wrapper.sendInitialState(); break;

            case 'sendInput': this.handleUserInput(sid, msg.text, msg.files, msg.attachments); break;
            case 'interrupt': this.interrupt(sid); break;
            // 撤销/回退（D1）：async 往返，按 reqId 回发预览/结果，避免弹窗挂起。
            case 'getForkPreview': await this.handleGetForkPreview(sid, msg.uuid, msg.reqId); break;
            case 'forkSession': await this.handleForkSession(sid, msg.uuid, msg.restoreFiles, msg.reqId); break;
            // 分支到新聊天：core 复制截断历史到新会话，本端以新 tab 打开。
            case 'branchSession': await this.handleBranchSession(sid, msg.reqId, msg.beforeMessageUuid); break;
            // 子 agent 转后台（D4，会话级）。
            case 'transferAgentToBackground': void this.sessions.get(sid ?? '')?.remote.transferAgentToBackground(msg.taskId); break;
            case 'toolPermissionResponse': this.sessions.get(sid ?? '')?.wrapper.respondToToolPermission(msg.response); break;
            case 'askFormResponse': this.sessions.get(sid ?? '')?.wrapper.respondToPickOption(msg.response); break;
            case 'planExitResponse': this.handlePlanExit(sid, msg.response); break;
            // Stop 时把挂起的权限/表单请求标记为中断态回插历史（对齐 VSCode insert*RequestMessage）
            case 'insertPermissionRequest': this.sessions.get(sid ?? '')?.wrapper.insertPermissionRequestMessage(msg.permissionData); break;
            case 'insertAskFormRequest': this.sessions.get(sid ?? '')?.wrapper.insertAskFormRequestMessage(msg.askFormData); break;
            case 'updateAgentMode': this.sessions.get(sid ?? '')?.wrapper.updateAgentMode(msg.mode); break;
            case 'updatePermissionLevel': this.sessions.get(sid ?? '')?.wrapper.updatePermissionLevel(msg.level); break;

            case 'requestModelInfo': await this.sendModelInfo(); break;
            case 'requestSystemConfig': void this.sendSystemConfig(); break;
            case 'switchModel': await this.core.switchModel(msg.modelName).catch(() => {}); break;
            case 'requestCommands': void this.sendCommands(); break;
            case 'requestSkills': void this.sendSkills(); break;
            case 'requestAgents': void this.sendAgents(); break;
            case 'requestInputHistory': this.t.editor('requestInputHistory'); break;

            // 打开配置页（编辑器区独立 tab，由 Kotlin FileEditorManager 承载）
            case 'openConfig': this.t.editor('openConfig', { page: msg.page, taskId: msg.taskId }); break;
            // 打开 bash 输出/命令（只读 tab，由 Kotlin EditorOps.openBashOutput 承载；字段对齐 VSCode openBashOutputAsDocument）
            case 'openBashOutput': this.t.editor('openBashOutput', { content: msg.content, command: msg.command, toolId: msg.toolId }); break;

            // 编辑器操作 → 转发 Kotlin
            case 'openFile': this.t.editor('openFile', { filePath: msg.filePath, line: msg.line, endLine: msg.endLine }); break;
            case 'openExternal': this.t.editor('openExternal', { url: msg.url }); break;
            // 文件校验 / 图片解析：Kotlin 原生处理后经 editor 通路回推 filePathVerified / imagePathResolved（对齐 VSCode，fire-and-forget）
            case 'verifyFilePath': this.t.editor('verifyFilePath', { filePath: msg.filePath, tempId: msg.tempId, originalCode: msg.originalCode, lineInfo: msg.lineInfo }); break;
            case 'resolveImagePath': this.t.editor('resolveImagePath', { filePath: msg.filePath, tempId: msg.tempId }); break;
            case 'showFileDiff': this.t.editor('showFileDiff', { filePath: msg.filePath, minLine: msg.minLine, sessionId: sid }); break;
            case 'showPermissionDiff': this.t.editor('showPermissionDiff', { filePath: msg.filePath, diffContent: msg.diffContent, sessionId: sid }); break;
            case 'getFileChangeStats': this.t.editor('getFileChangeStats', { filePath: msg.filePath, sessionId: sid }); break;

            // 拒绝/回滚：转发 Kotlin 用快照写回或删除，并同步清理 UI 面板（对齐 chatWebview）
            case 'restoreFromSnapshots':
                this.t.editor('revertFiles', { filePaths: msg.filePaths, sessionId: sid });
                this.postToApp({ type: 'clearFileChanges', sessionId: sid });
                break;
            case 'restoreFromSnapshot':
                this.t.editor('revertFile', { filePath: msg.filePath, sessionId: sid });
                this.postToApp({ type: 'removeFileChange', sessionId: sid, filePath: msg.filePath });
                break;

            // 工作区文件 / 内容搜索 / 剪贴板：Kotlin 原生处理后经 editor 通路回推（对齐 VSCode，fire-and-forget；reqId 原样回带）
            case 'requestWorkspaceFiles': this.t.editor('requestWorkspaceFiles', { reqId: msg.reqId }); break;
            case 'searchWorkspaceFiles': this.t.editor('searchWorkspaceFiles', { query: msg.query || '', reqId: msg.reqId }); break;
            case 'searchContentInFiles': this.t.editor('searchContentInFiles', { content: msg.content }); break;
            case 'requestClipboardFiles': this.t.editor('requestClipboardFiles'); break;
            // 输入历史：读/写走 Kotlin 项目级持久化
            case 'saveInputHistory': this.t.editor('saveInputHistory', { item: msg.item }); break;

            default: break;
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
    private async createSession(opts: { agentMode?: any; permissionLevel?: any; sessionId?: string; historyContent?: any[]; title?: string } = {}): Promise<{ ok: boolean; error?: string }> {
        // 会话数上限（对齐 VSCode createNewSession）。已打开的历史会话走切 tab 不到这里。
        if (this.sessions.size >= MAX_SESSIONS) {
            const error = `最多同时打开 ${MAX_SESSIONS} 个会话，请先关闭已有会话`;
            this.postToApp({ type: 'sessionCreateFailed', error });
            return { ok: false, error };
        }
        // 建会话即透传 per-session 档位/模式（D7）；无值时回落系统配置的默认档位。
        const permissionLevel = opts.permissionLevel ?? await this.getDefaultPermissionLevel();
        const res = await this.core.createSession({ sessionId: opts.sessionId, permissionLevel, agentMode: opts.agentMode });
        if (!res.ok || !res.sessionId) {
            this.postToApp({ type: 'sessionCreateFailed', error: res.error });
            return { ok: false, error: res.error };
        }
        const remote = new RemoteSession(res.sessionId, this.t);
        const wrapper = new SemaSessionWrapper(remote as any, this.callbacks, opts.agentMode ?? 'Agent', permissionLevel);
        this.sessions.set(res.sessionId, { wrapper, remote });
        this.activeSessionId = res.sessionId;
        this.core.setActiveSession(res.sessionId); // 对齐 VSCode：建会话即标记 core 活跃会话（cron 通知定位用）
        // 为该会话建立独立的快照作用域（清掉可能残留的同 id 旧状态）。
        this.t.editor('resetSnapshots', { sessionId: res.sessionId });

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
        return { ok: true };
    }

    /**
     * 从历史面板加载会话：已打开则切 tab；否则用原 id + historyContent 建会话并重放
     * （对齐 semaSidebarProvider.loadHistorySession）。
     */
    private async loadHistorySession(session: any): Promise<void> {
        if (!session?.id) return;
        if (this.sessions.has(session.id)) {
            this.activeSessionId = session.id;
            this.core.setActiveSession(session.id);
            this.postToApp({ type: 'switchToSession', sessionId: session.id });
            this.reportState();
            return;
        }
        await this.createSession({
            sessionId: session.id,
            historyContent: session.content,
            title: session.title,
            agentMode: session.agentMode,
        });
    }

    private handleUserInput(sid: string | undefined, text: string, files?: Array<any>, attachments?: any): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        // @file 引用编码（对齐 chatWebview.handleUserInput）：把内联的 display 引用替换成 encoded（含引号转义），
        // 再把 content 里尚缺的引用补到末尾。
        let content = text;
        if (files && files.length > 0) {
            const refs = files.map((file: any) => ({
                encoded: formatFileReference(file),
                display: formatFileReference(file, false),
            }));
            for (const { encoded, display } of refs) {
                if (encoded !== display) content = content.split(display).join(encoded);
            }
            const fileContext = refs
                .filter(({ encoded }) => !content.includes(encoded))
                .map(({ encoded }) => encoded)
                .join(' ');
            content = fileContext ? `${content} ${fileContext} ` : content;
        }
        // 斜杠命令展开（D6，对齐 chatWebview:150-155）：命中改写时传展开后文本 + 原文为 orgContent，
        // 让 UI 保留「原文 vs 展开」区分；未命中则 orgContent 为 undefined。
        const transformed = transformCommandToPrompt(content);
        if (transformed && transformed !== content) {
            entry.wrapper.processUserInput(transformed, content, attachments);
        } else {
            entry.wrapper.processUserInput(content, undefined, attachments);
        }
    }

    private interrupt(sid: string | undefined): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        this.clearPanels(sid!);
        // 中断主回合 + 停后台子 agent（D3，对齐 chatWebview:174-175）。
        entry.wrapper.interruptSession();
        void entry.remote.stopAllTasks();
    }

    /** 撤销/回退预览（D1，对齐 chatWebview.handleGetForkPreview）：async 往返，按 reqId 回发。 */
    private async handleGetForkPreview(sid: string | undefined, uuid: string, reqId: any): Promise<void> {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry || !uuid) {
            this.postToApp({ type: 'forkPreviewResult', sessionId: sid, reqId, error: '会话不可用' });
            return;
        }
        try {
            const preview = await entry.remote.getForkPreview(uuid);
            this.postToApp({ type: 'forkPreviewResult', sessionId: sid, reqId, preview });
        } catch (e: any) {
            this.postToApp({ type: 'forkPreviewResult', sessionId: sid, reqId, error: e?.message || '预览失败' });
        }
    }

    /** 执行 fork/回退（D1，对齐 chatWebview.handleForkSession）：async 往返，按 reqId 回发结果。 */
    private async handleForkSession(sid: string | undefined, uuid: string, restoreFiles: any, reqId: any): Promise<void> {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry || !uuid) {
            this.postToApp({ type: 'forkResult', sessionId: sid, reqId, uuid, result: { ok: false, error: '会话不可用' } });
            return;
        }
        try {
            const result = await entry.remote.fork(uuid, { restoreFiles: !!restoreFiles });
            // core（sidecar 进程）直接写盘回滚，IDE 的 VFS/已打开编辑器不感知外部改动，
            // 按实际回滚的文件列表（绝对路径）让 Kotlin 主动刷新 VFS 重读磁盘。
            const restored = Array.isArray(result?.restoredFiles) ? result.restoredFiles : [];
            if (restored.length > 0) this.t.editor('refreshFiles', { filePaths: restored });
            this.postToApp({ type: 'forkResult', sessionId: sid, reqId, uuid, result });
        } catch (e: any) {
            this.postToApp({ type: 'forkResult', sessionId: sid, reqId, uuid, result: { ok: false, error: e?.message || 'fork 失败' } });
        }
    }

    /**
     * 分支到新聊天（对齐 semaSidebarProvider.branchToNewChat + chatWebview.handleBranchSession）：
     * core 侧 branch() 新建会话并复制历史（截断后的 editlog 副本一并复制，源会话与工作区文件不动），
     * 本端把截断后的 UI 消息列表复制给新 wrapper 并以新 tab 打开（sessionOpened）。
     * beforeMessageUuid 为截断锚点（core 语义：历史截到该用户输入之前），不传则全量复制。
     * 无论成败都回 branchResult 解除前端「分支中」状态；失败另发 sessionCreateFailed 顶部提示。
     */
    private async handleBranchSession(sid: string | undefined, reqId: any, beforeMessageUuid?: string): Promise<void> {
        const fail = (error: string) => {
            this.postToApp({ type: 'sessionCreateFailed', error });
            this.postToApp({ type: 'branchResult', sessionId: sid, reqId, ok: false, error });
        };
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) { fail('会话不可用'); return; }
        // 先于 core 检查会话数上限：core branch 会落盘新历史文件，开不出 tab 会留下孤儿会话
        if (this.sessions.size >= MAX_SESSIONS) {
            fail(`最多同时打开 ${MAX_SESSIONS} 个会话，请先关闭已有会话`);
            return;
        }
        if (entry.wrapper.getCurrentState() !== 'idle') { fail('会话处理中，请等待空闲后再分支'); return; }

        try {
            const result = await entry.remote.branch(beforeMessageUuid);
            if (!result || result.ok === false || !result.sessionId) {
                fail(`分支失败：${result?.error || '未知错误'}`);
                return;
            }

            // 新 tab 的消息列表与 core 落盘历史保持一致：有锚点时截到该用户输入之前
            // （锚点是用户输入的 uuid，即 core inputId）。锚点在列表里找不到时回退全量
            // （core 已成功，以其结果为准，不再报错）。
            let historyContent = entry.wrapper.getMessageHistory();
            if (beforeMessageUuid) {
                const cutIndex = historyContent.findIndex(m => m.uuid === beforeMessageUuid);
                if (cutIndex >= 0) historyContent = historyContent.slice(0, cutIndex);
            }

            const title = entry.wrapper.title ? `${entry.wrapper.title} (分支)` : '分支会话';
            const created = await this.createSession({
                sessionId: result.sessionId,
                agentMode: entry.wrapper.getAgentMode(),
                historyContent,
                title,
            });
            if (!created.ok) {
                // createSession 内部已发 sessionCreateFailed，这里只补 branchResult
                this.postToApp({ type: 'branchResult', sessionId: sid, reqId, ok: false, error: created.error });
                return;
            }

            // 立即写入历史存档，不必等新会话首次 idle（Kotlin save 后自动推 updateSessions 刷新历史面板）
            this.saveSession(result.sessionId);
            this.postToApp({ type: 'branchResult', sessionId: sid, reqId, ok: true });
        } catch (e: any) {
            fail(`分支失败：${e?.message || '未知错误'}`);
        }
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
        // 释放该会话的快照与临时文件，避免泄漏。
        this.t.editor('resetSnapshots', { sessionId: sid });
        if (this.activeSessionId === sid) {
            this.activeSessionId = this.sessions.keys().next().value ?? null;
            if (this.activeSessionId) this.core.setActiveSession(this.activeSessionId); // 对齐 VSCode：关闭后活跃权交给下一个会话
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

    /** 读系统配置里的默认权限档位（Kotlin 本地持久化，对齐 semaSidebarProvider.getDefaultPermissionLevel），非法值回落 'Ask' */
    private async getDefaultPermissionLevel(): Promise<PermissionLevel> {
        try {
            const res = await this.t.callEditor('systemConfig', { op: 'get' });
            const level = res?.config?.defaultPermissionLevel;
            return level === 'AutoEdit' || level === 'AutoRun' || level === 'Bypass' ? level : 'Ask';
        } catch {
            return 'Ask';
        }
    }

    /**
     * 系统配置：改读 Kotlin 本地持久化（systemConfig channel，与配置页同源），
     * 抽取聊天页需要的三个开关（抽取逻辑对齐 VSCode chatWebview.sendSystemConfig）。
     */
    private async sendSystemConfig(): Promise<void> {
        try {
            const res = await this.t.callEditor('systemConfig', { op: 'get' });
            const config = res?.config ?? {};
            this.postToApp({
                type: 'systemConfigUpdate',
                skipFileEditPermission: config.skipFileEditPermission || false,
                thinking: config.thinking !== false,
                showThinkingText: config.showThinkingText !== false,
            });
        } catch {
            this.postToApp({ type: 'systemConfigUpdate', skipFileEditPermission: false, thinking: true, showThinkingText: false });
        }
    }

    /** 斜杠命令 / 技能 / Agent 列表：转发 core（sema-core 透明镜像，对齐 VSCode getCommandsInfo/getSkillsInfo/getAgentsInfo）。 */
    private async sendCommands(): Promise<void> {
        try { this.postToApp({ type: 'customCommandsLoaded', commands: await this.core.getCommandsInfo() }); }
        catch { this.postToApp({ type: 'customCommandsLoaded', commands: [] }); }
    }
    private async sendSkills(): Promise<void> {
        // 禁用的 skill 不进聊天斜杠列表（对齐 VSCode chatWebview.sendSkills）
        try { this.postToApp({ type: 'skillsLoaded', skills: (await this.core.getSkillsInfo()).filter((s: any) => s.status !== false) }); }
        catch { this.postToApp({ type: 'skillsLoaded', skills: [] }); }
    }
    private async sendAgents(): Promise<void> {
        try { this.postToApp({ type: 'agentsLoaded', agents: await this.core.getAgentsInfo() }); }
        catch { this.postToApp({ type: 'agentsLoaded', agents: [] }); }
    }

    private async checkConfiguration(): Promise<void> {
        try {
            const d = await this.core.getModelData();
            if (!d?.modelName) this.postToApp({ type: 'showModelConfigReminder' });
        } catch {
            this.postToApp({ type: 'showModelConfigReminder' });
        }
    }

    /** 读文件时打快照（对齐 VSCode addFileToSnapshotIfNew）：传路径给 Kotlin 回读磁盘存原版，按会话隔离、幂等。 */
    private addFileToSnapshotIfNew(sessionId: string, filePath: any): void {
        if (sessionId && typeof filePath === 'string' && filePath) this.t.editor('addFileToSnapshotIfNew', { sessionId, filePath });
    }

    /** 新建文件时钉一条空基线（对齐 VSCode pinEmptySnapshotIfNew）：避免 fork 后重读把已改内容误当基线。 */
    private pinEmptySnapshotIfNew(sessionId: string, filePath: any): void {
        if (sessionId && typeof filePath === 'string' && filePath) this.t.editor('pinEmptySnapshotIfNew', { sessionId, filePath });
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
