import { SemaSessionWrapper, SessionWrapperCallbacks, PermissionLevel } from '../../../core/semaSessionWrapper';
import { transformCommandToPrompt } from '../../../utils/prompt';
import { TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE, TOOL_NAME_EDIT_NOTEBOOK, TOOL_NAME_GENERATE_IMAGE } from '../../../utils/tool';
import { isAttachmentPath } from '../../common/viz';
import { DEFAULT_CUSTOM_RULES, isBuiltinCustomRules, normalizePermissionLevel } from '../../config/default/defaultConfig';
import { Transport } from './transport';
import { RemoteCore, RemoteSession } from './remote';
import { normalizeLang, t } from '../../common/i18n/core';
import { buildPasteInput, type PasteAttachment } from '../../common/paste';

/** 同时打开的会话上限（对齐 semaProcessWrapper.MAX_SESSIONS = 5，本地常量避免拽入 node 依赖）。 */
const MAX_SESSIONS = 5;

/** 会写项目文件的工具：写完后刷新文件变更面板（对齐 semaSidebarProvider.FILE_EDIT_TOOL_NAMES） */
const FILE_EDIT_TOOL_NAMES = new Set<string>([
    TOOL_NAME_WRITE_FILE,
    TOOL_NAME_PATCH_FILE,
    TOOL_NAME_EDIT_NOTEBOOK,
    TOOL_NAME_GENERATE_IMAGE,
]);
/** 浏览器控制的用户级 chrome MCP 名（对齐 config-controller / Kotlin BuiltinResourcesSync）。 */
const BROWSER_MCP_NAME = 'chrome';

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
    /** 正在从历史加载中的会话 id：历史面板双击会连发两次 loadHistorySession，第二次直接忽略 */
    private loadingSessionIds = new Set<string>();
    private activeSessionId: string | null = null;
    private initialized = false;
    /** createSession ack 返回前到达的会话事件，先按 sessionId 缓冲，wrapper 就绪后回放。 */
    private eventBuffer = new Map<string, Array<{ event: string; data: any }>>();
    /** 会话历史存档防抖定时器（对齐 semaSidebarProvider.saveSessionTimers，300ms）。 */
    private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** 文件变更整表刷新定时器（连续写盘合并成一次查询，对齐 semaSidebarProvider.fileChangeTimers）。 */
    private fileChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** 打开时的内容指纹（对齐 semaSidebarProvider）：条数 + 末条消息 id + 标题。 */
    private sessionBaselines = new Map<string, string>();
    /** 输入框有草稿的会话（对齐 semaSidebarProvider.draftSessionIds）。 */
    private draftSessionIds = new Set<string>();
    /** 打开后有过任务活动的会话（对齐 semaSidebarProvider.touchedSessionIds）。 */
    private touchedSessionIds = new Set<string>();
    /**
     * 最近一次看到的全局模型数据（主模型指针 + 列表）。桥广播的 model:update 不带来源，
     * 靠它判断"全局主模型指针是否变化、是否由删模型引起"，对齐 VSCode handleModelUpdate 的 origin 分支。
     */
    private lastGlobalModel: { main: string; list: string[] } | null = null;

    constructor(private t: Transport, private postToApp: (msg: any) => void) {
        this.core = new RemoteCore(t);
        t.setEventHandler((event, data, sessionId) => this.onGrpcEvent(event, data, sessionId));
        // Kotlin 编辑器侧回推的 UI 消息（如 filePathVerified）直接灌回 app
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
            case 'model:update': this.handleGlobalModelUpdate(data); break;
            default: break;
        }
    }

    /**
     * 全局模型数据变化（对齐 VSCode semaSidebarProvider.handleModelUpdate）。
     * 前端 modelUpdate 只更新列表；各会话显示的模型名由会话级事件/拉取决定：
     * 1. 全局主模型指针变化只同步到活跃会话，其他已打开会话保持各自钉住的模型。
     *    广播不带来源，用前后对比判断：旧 main 已不在新列表说明是删模型引起的指针漂移，不同步，
     *    避免把钉在其他模型上的活跃会话切走（core 已对受影响会话发会话级 model:update）。
     * 2. 之后对所有打开会话重新拉取生效模型，覆盖 core 不发会话级事件的场景（未钉住会话跟随全局等）。
     */
    private handleGlobalModelUpdate(data: any): void {
        this.postToApp({ type: 'modelUpdate', data });

        const prev = this.lastGlobalModel;
        const next = { main: data?.modelName || '', list: Array.isArray(data?.modelList) ? data.modelList as string[] : [] };
        this.lastGlobalModel = next;
        const mainChanged = !!prev && prev.main !== next.main;
        const causedByDelete = !!prev && !!prev.main && !next.list.includes(prev.main);

        const active = this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
        const syncActive = mainChanged && !causedByDelete && active && next.main
            ? active.wrapper.switchModel(next.main).catch(() => {})
            : Promise.resolve();
        void syncActive.then(() => {
            for (const { wrapper } of this.sessions.values()) void wrapper.refreshModelInfo();
        });
    }

    /** 所有会话共用一份回调（对齐 semaSidebarProvider.sessionCallbacks）。 */
    private get callbacks(): SessionWrapperCallbacks {
        return {
            onMessage: (m) => this.postToApp(m),
            onSessionReady: (_sid, _data: any) => {
                // core 建会话会重扫插件并级联刷新 skills/agents/commands/MCP/hooks，配置页长开时列表会过期。
                // 配置页那条 gRPC 连接收不到本会话的 session:ready，只能经宿主总线转一手
                // （对齐 VSCode handleSessionReady → configWebviewProvider.notifySessionCreated）。
                // 会话基线在 core 侧，恢复会话后前端挂载时会主动拉一次整表，这里不再补读文件基线
                this.t.editor('notifySessionCreated', {});
            },
            // 存档触发点（对齐 semaSidebarProvider）：状态回 idle、话题更新时防抖存历史。
            onStateChange: (sid, state) => { if (state === 'idle') this.debouncedSaveSession(sid); },
            onTopicUpdate: (sid) => this.debouncedSaveSession(sid),
            // 文件写完：core 已在写盘前捕获基线，这里只触发面板整表刷新（连续写完合并到一次）
            onToolExecutionComplete: (sid, data: any) => {
                if (FILE_EDIT_TOOL_NAMES.has(data?.toolName)) this.scheduleFileChangesRefresh(sid);
            },
            onTaskStart: (sessionId, data) => { this.touchedSessionIds.add(sessionId); this.postToApp({ type: 'taskStart', sessionId, data }); },
            onTaskEnd: (sessionId, data) => { this.touchedSessionIds.add(sessionId); this.postToApp({ type: 'taskEnd', sessionId, data }); },
            onSessionCleared: (sessionId) => { this.clearPanels(sessionId); },
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
                void this.syncBuiltinResources();
                await this.postEnvInfo();
                await this.createSession({ agentMode: msg.mode, permissionLevel: msg.permissionLevel });
                break;
            case 'createSession': await this.createSession({ agentMode: msg.mode, permissionLevel: msg.permissionLevel }); break;
            // 从历史面板加载会话（跨 JCEF：Kotlin bus → host 通路下发）
            case 'loadHistorySession': await this.loadHistorySession(msg.session); break;
            case 'switchSession': if (sid) { this.activeSessionId = sid; this.core.setActiveSession(sid); this.reportState(); } break;
            case 'closeSession': this.closeSession(sid); break;
            // 输入框有草稿：该会话不参与「打开后无变化」的自动回收
            case 'sessionDraftActivity': if (sid && this.sessions.has(sid)) this.draftSessionIds.add(sid); break;
            case 'webviewSessionReady':
                this.sessions.get(sid ?? '')?.wrapper.sendInitialState();
                // 文件变更面板以 core 的会话基线为准：挂载即拉一次整表
                void this.pushFileChanges(sid);
                break;

            case 'sendInput': this.handleUserInput(sid, msg.text, msg.files, msg.attachments, msg.pastes); break;
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
            // 拒绝 / Stop 时把挂起的权限请求回插历史（对齐 VSCode insertPermissionRequestMessage）
            case 'insertPermissionRequest': this.sessions.get(sid ?? '')?.wrapper.insertPermissionRequestMessage(msg.permissionData); break;
            case 'updateAgentMode': this.sessions.get(sid ?? '')?.wrapper.updateAgentMode(msg.mode); break;
            case 'updatePermissionLevel': this.sessions.get(sid ?? '')?.wrapper.updatePermissionLevel(msg.level); break;
            // 长期目标：暂停 / 恢复 / 清除 与 更新文字（对齐 chatWebview）
            case 'goalAction': this.sessions.get(sid ?? '')?.wrapper.goalAction(msg.action); break;
            case 'updateGoal': this.sessions.get(sid ?? '')?.wrapper.updateGoal(msg.text); break;

            // 模型显示是会话级的（对齐 chatWebview）；切换 = 本会话 + 全局默认，其他已打开会话不动
            case 'requestModelInfo': await this.sessions.get(sid ?? '')?.wrapper.refreshModelInfo(true); break;
            case 'requestSystemConfig': void this.sendSystemConfig(); break;
            case 'dismissWelcomeTip': void this.t.callEditor('systemConfig', { op: 'dismissWelcomeTip', id: msg.id }).catch(() => {}); break;
            case 'updateLanguage': await this.updateLanguage(msg.lang); break;
            case 'switchModel': await this.switchSessionModel(sid, msg.modelName); break;
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
            case 'showFileDiff': await this.handleShowFileDiff(sid, msg.filePath, msg.minLine); break;
            case 'showPermissionDiff': this.t.editor('showPermissionDiff', { filePath: msg.filePath, diffContent: msg.diffContent, sessionId: sid }); break;
            case 'requestFileChanges': await this.pushFileChanges(sid); break;

            // 放弃修改：由 core 按会话基线恢复 / 删除文件，Kotlin 只负责刷新 VFS
            case 'restoreFromSnapshots':
                await this.handleRevertFiles(sid, msg.filePaths);
                break;
            case 'restoreFromSnapshot':
                await this.handleRevertFiles(sid, msg.filePath ? [msg.filePath] : []);
                break;

            // 工作区文件 / 内容搜索 / 剪贴板：Kotlin 原生处理后经 editor 通路回推（对齐 VSCode，fire-and-forget；reqId 原样回带）
            case 'requestWorkspaceFiles': this.t.editor('requestWorkspaceFiles', { reqId: msg.reqId }); break;
            case 'searchWorkspaceFiles': this.t.editor('searchWorkspaceFiles', { query: msg.query || '', reqId: msg.reqId }); break;
            case 'searchContentInFiles': this.t.editor('searchContentInFiles', { content: msg.content }); break;
            case 'requestClipboardFiles': this.t.editor('requestClipboardFiles'); break;
            // 输入历史：读/写走 Kotlin 项目级持久化
            case 'saveInputHistory': this.t.editor('saveInputHistory', { item: msg.item }); break;
            // 超长粘贴转附件：落盘 / 删除 / 读回，Kotlin 侧写 <semaRoot>/attachments/<uuid>/pasted-text.txt 并回推结果
            case 'savePastedText': this.t.editor('savePastedText', { text: msg.text, reqId: msg.reqId }); break;
            case 'removePastedText': this.t.editor('removePastedText', { path: msg.path }); break;
            case 'readPastedText': this.t.editor('readPastedText', { path: msg.path, reqId: msg.reqId }); break;
            // 可视化产物内联嵌入：Kotlin 侧复制到临时目录并注入 viz-runtime，回推 vizEmbedReady{reqId,url}
            case 'prepareVizEmbed': this.t.editor('prepareVizEmbed', { path: msg.path, reqId: msg.reqId }); break;

            default: break;
        }
    }

    /**
     * 路径展示环境（对齐 VSCode onFrontendReady 的 envInfo）：home / 分隔符由 Kotlin fileOps roots 给出，
     * 前端据此把绝对路径的 home 缩写为 ~。失败不影响启动，前端退化为原样显示。
     */
    private async postEnvInfo(): Promise<void> {
        try {
            const r = await this.t.callEditor('fileOps', { op: 'roots' });
            this.postToApp({
                type: 'envInfo',
                homeDir: String(r?.home || ''),
                platform: r?.sep === '\\' ? 'win32' : 'posix',
            });
        } catch { /* ignore */ }
    }

    /**
     * 升级后首次打开的浏览器控制同步（对齐 VSCode extension.syncBuiltinResources 的浏览器控制部分）：
     * 默认 skill 的覆盖在 Kotlin 侧工具窗口创建时已做；chrome MCP 要经 core 重新 add（添加即更新）才能更新，所以放在 core 就绪后：
     * Kotlin 判定需要同步并重拷 chrome-use 目录 → 这里刷新 skills、用户级有 chrome MCP 就按模板重写 → 回报 markSynced 落版本号。
     * 失败只打日志，下次打开重试；多窗口各自调用也幂等。
     */
    private async syncBuiltinResources(): Promise<void> {
        try {
            const r = await this.t.callEditor('browserControl', { op: 'syncUpgrade' });
            if (!r?.sync) return;
            await this.core.getSkillsInfo(true);
            const servers: any[] = await this.core.getMCPServerInfo();
            if ((servers ?? []).some(s => s?.config?.name === BROWSER_MCP_NAME && (s?.scope ?? s?.config?.scope) === 'user')) {
                await this.core.addMCPServer({ ...r.mcp, name: BROWSER_MCP_NAME, scope: 'user' });
            }
            await this.t.callEditor('browserControl', { op: 'markSynced' });
        } catch (e) {
            console.warn('[sema] builtin resources upgrade sync failed:', e);
        }
    }

    private async ensureInit(): Promise<void> {
        if (this.initialized) return;
        await this.core.init({});
        this.initialized = true;
        // 记一份全局模型基线，供 handleGlobalModelUpdate 判断主模型指针是否变化；失败不影响初始化
        try {
            const d = await this.core.getModelData();
            this.lastGlobalModel = { main: d?.modelName || '', list: Array.isArray(d?.modelList) ? d.modelList : [] };
        } catch { /* ignore */ }
    }

    /**
     * 建会话。复刻 VSCode createNewSession 的历史重放：传 sessionId → sema-core 按 id 重新
     * 水合 LLM 上下文（可续聊）；传 historyContent → 纯客户端把历史 UI 消息灌回 React。
     */
    private async createSession(opts: { agentMode?: any; permissionLevel?: any; sessionId?: string; historyContent?: any[]; title?: string } = {}): Promise<{ ok: boolean; error?: string }> {
        // 会话数上限（对齐 VSCode createNewSession）：先回收一个打开后没有变化的会话腾位置。
        if (!(await this.ensureSessionSlot(opts.sessionId))) {
            const error = t('host.maxSessions', { max: MAX_SESSIONS });
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
        // 兜底：并发建同 id 会话时 core 会复用已有 session，这里也复用已有 wrapper
        if (this.sessions.has(res.sessionId)) {
            this.activeSessionId = res.sessionId;
            this.core.setActiveSession(res.sessionId);
            this.postToApp({ type: 'switchToSession', sessionId: res.sessionId });
            this.reportState();
            return { ok: true };
        }
        const remote = new RemoteSession(res.sessionId, this.t);
        const wrapper = new SemaSessionWrapper(remote as any, this.callbacks, opts.agentMode ?? 'Agent', permissionLevel);
        this.sessions.set(res.sessionId, { wrapper, remote });
        this.activeSessionId = res.sessionId;
        this.core.setActiveSession(res.sessionId); // 对齐 VSCode：建会话即标记 core 活跃会话（cron 通知定位用）

        // 回放缓冲事件（如 session:ready）
        const buf = this.eventBuffer.get(res.sessionId);
        if (buf) {
            this.eventBuffer.delete(res.sessionId);
            for (const e of buf) remote.emit(e.event, e.data);
        }

        // 先建 tab（sessionOpened），再重放历史消息，保证 React 按 sessionId 能收到内容更新。
        this.postToApp({ type: 'sessionOpened', sessionId: res.sessionId, title: opts.title || t('common.newSession') });
        if (opts.historyContent && opts.historyContent.length > 0) {
            if (opts.title) wrapper.updateTitle(opts.title);
            wrapper.updateMessageHistory(opts.historyContent);
        }
        // 历史重放完再记基线：此后内容指纹一旦变化就视为「打开后有变化」
        this.sessionBaselines.set(res.sessionId, this.sessionFingerprint(wrapper));
        this.draftSessionIds.delete(res.sessionId);
        this.touchedSessionIds.delete(res.sessionId);
        this.reportState();
        return { ok: true };
    }

    /**
     * 会话数达到上限时，回收一个「打开后没有变化」的会话腾位置（对齐 semaSidebarProvider）。
     * 返回能否继续创建；excludeId 用于排除调用方自己正在用的会话（如分支的源会话）。
     */
    private async ensureSessionSlot(excludeId?: string): Promise<boolean> {
        if (this.sessions.size < MAX_SESSIONS) return true;
        const candidate = this.findUntouchedSession(excludeId);
        if (!candidate) return false;
        this.closeSession(candidate);
        return true;
    }

    /** 内容指纹仍等于打开时、空闲、无待落盘、无草稿、非活跃 tab 的会话中，取最早打开的。 */
    private findUntouchedSession(excludeId?: string): string | null {
        for (const [sid, entry] of this.sessions) {
            if (sid === excludeId || sid === this.activeSessionId || this.draftSessionIds.has(sid)) continue;
            const baseline = this.sessionBaselines.get(sid);
            if (baseline === undefined || this.touchedSessionIds.has(sid)) continue;
            if (this.saveTimers.has(sid) || entry.wrapper.getCurrentState() !== 'idle') continue;
            if (this.sessionFingerprint(entry.wrapper) === baseline) return sid;
        }
        return null;
    }

    /** 会话当前内容的轻量指纹：消息条数 + 末条消息 id + 标题（对齐 semaSidebarProvider） */
    private sessionFingerprint(wrapper: SemaSessionWrapper): string {
        const messages = wrapper.getMessageHistory();
        const last = messages[messages.length - 1];
        return `${messages.length}:${last?.uuid ?? last?.id ?? ''}:${wrapper.title}`;
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
        // 建会话是异步往返，期间再次点击同一条目会重复建 wrapper（对齐 semaSidebarProvider）
        if (this.loadingSessionIds.has(session.id)) return;
        this.loadingSessionIds.add(session.id);
        try {
            await this.createSession({
                sessionId: session.id,
                historyContent: session.content,
                title: session.title,
                agentMode: session.agentMode,
            });
        } finally {
            this.loadingSessionIds.delete(session.id);
        }
    }

    private handleUserInput(sid: string | undefined, text: string, files?: Array<any>, attachments?: any, pastes?: PasteAttachment[]): void {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        const body = text;
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
        // 有粘贴附件（对齐 chatWebview）：input 按模板以 @路径 引用粘贴文件，originalInput 为用户实际打的正文（可为空串）
        if (pastes && pastes.length > 0) {
            const expanded = transformed && transformed !== content ? transformed : content;
            entry.wrapper.processUserInput(buildPasteInput(pastes, expanded), body, attachments);
        } else if (transformed && transformed !== content) {
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
            this.postToApp({ type: 'forkPreviewResult', sessionId: sid, reqId, error: t('host.sessionUnavailable') });
            return;
        }
        try {
            const preview = await entry.remote.getForkPreview(uuid);
            this.postToApp({ type: 'forkPreviewResult', sessionId: sid, reqId, preview });
        } catch (e: any) {
            this.postToApp({ type: 'forkPreviewResult', sessionId: sid, reqId, error: e?.message || t('host.forkPreviewFailed') });
        }
    }

    /** 执行 fork/回退（D1，对齐 chatWebview.handleForkSession）：async 往返，按 reqId 回发结果。 */
    private async handleForkSession(sid: string | undefined, uuid: string, restoreFiles: any, reqId: any): Promise<void> {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry || !uuid) {
            this.postToApp({ type: 'forkResult', sessionId: sid, reqId, uuid, result: { ok: false, error: t('host.sessionUnavailable') } });
            return;
        }
        try {
            // 走 wrapper.fork：core 截断后同步截断宿主 messageHistory，存档才不会带上作废消息
            const result = await entry.wrapper.fork(uuid, { restoreFiles: !!restoreFiles });
            // core（sidecar 进程）直接写盘回滚，IDE 的 VFS/已打开编辑器不感知外部改动，
            // 按实际回滚的文件列表（绝对路径）让 Kotlin 主动刷新 VFS 重读磁盘。
            const restored = Array.isArray(result?.restoredFiles) ? result.restoredFiles : [];
            if (restored.length > 0) this.t.editor('refreshFiles', { filePaths: restored });
            this.postToApp({ type: 'forkResult', sessionId: sid, reqId, uuid, result });
            // 回退会截断基线与文件，面板按 core 的最新清单整表刷新（restoreFiles=false 时也刷新）
            if (result?.ok !== false) void this.pushFileChanges(sid);
        } catch (e: any) {
            this.postToApp({ type: 'forkResult', sessionId: sid, reqId, uuid, result: { ok: false, error: e?.message || t('host.forkFailed', { error: t('common.unknownError') }) } });
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
        if (!entry) { fail(t('host.sessionUnavailable')); return; }
        // 会话数上限（对齐 VSCode branchToNewChat）：先回收一个打开后没有变化的会话腾位置。
        if (!(await this.ensureSessionSlot(sid))) {
            fail(t('host.maxSessions', { max: MAX_SESSIONS }));
            return;
        }
        if (entry.wrapper.getCurrentState() !== 'idle') { fail(t('host.sessionBusy')); return; }

        try {
            const result = await entry.remote.branch(beforeMessageUuid);
            if (!result || result.ok === false || !result.sessionId) {
                fail(t('host.forkFailed', { error: result?.error || t('common.unknownError') }));
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

            const title = entry.wrapper.title ? t('host.forkTitle', { title: entry.wrapper.title }) : t('host.forkSession');
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
            fail(t('host.forkFailed', { error: e?.message || t('common.unknownError') }));
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
        // 关闭前存档只为兜住还没落盘的改动（对齐 VSCode closeSession）：空闲且没有待触发的
        // debounce 说明内容已存过，再存一次只会刷新 updatedAt、打乱历史列表排序
        const entry = this.sessions.get(sid);
        const timer = this.saveTimers.get(sid);
        if (timer || (entry && entry.wrapper.getCurrentState() !== 'idle')) {
            this.saveSession(sid);
        }
        if (timer) { clearTimeout(timer); this.saveTimers.delete(sid); }
        const changeTimer = this.fileChangeTimers.get(sid);
        if (changeTimer) { clearTimeout(changeTimer); this.fileChangeTimers.delete(sid); }
        this.core.closeSession(sid);
        this.sessions.delete(sid);
        this.sessionBaselines.delete(sid);
        this.draftSessionIds.delete(sid);
        this.touchedSessionIds.delete(sid);
        if (this.activeSessionId === sid) {
            this.activeSessionId = this.sessions.keys().next().value ?? null;
            if (this.activeSessionId) this.core.setActiveSession(this.activeSessionId); // 对齐 VSCode：关闭后活跃权交给下一个会话
        }
        this.postToApp({ type: 'sessionClosed', sessionId: sid, nextActiveId: this.activeSessionId });
        this.reportState();
    }

    /**
     * 输入框切换主模型（对齐 chatWebview.switchModel）= 改本会话 + 写全局默认，其他已打开会话各自钉住不受影响。
     * 先会话级（显示由 core 会话级 model:update 驱动），再全局（落盘并由桥广播进程级 model:update，
     * 配置页据此刷新；handleGlobalModelUpdate 同步活跃会话到同一模型，core 去重不重发）。
     */
    private async switchSessionModel(sid: string | undefined, modelName: string): Promise<void> {
        const entry = sid ? this.sessions.get(sid) : undefined;
        if (!entry) return;
        try {
            await entry.wrapper.switchModel(modelName);
            await this.core.switchModel(modelName);
        } catch (e: any) {
            this.postToApp({ type: 'error', sessionId: sid, message: t('host.switchModelFailed', { error: e?.message || '' }) });
        }
    }

    /** 读系统配置里的默认权限档位（Kotlin 本地持久化，对齐 semaSidebarProvider.getDefaultPermissionLevel），缺失或非法回落到 defaultConfig 默认值 */
    private async getDefaultPermissionLevel(): Promise<PermissionLevel> {
        try {
            const res = await this.t.callEditor('systemConfig', { op: 'get' });
            return normalizePermissionLevel(res?.config?.defaultPermissionLevel);
        } catch {
            return normalizePermissionLevel(undefined);
        }
    }

    /**
     * 系统配置：改读 Kotlin 本地持久化（systemConfig channel，与配置页同源），
     * 抽取聊天页需要的三个开关 + 界面语言 lang（抽取逻辑对齐 VSCode chatWebview.sendSystemConfig）。
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
                welcomeTipDismissedId: typeof res?.welcomeTipDismissedId === 'string' ? res.welcomeTipDismissedId : '',
                lang: config.lang,
            });
        } catch {
            this.postToApp({ type: 'systemConfigUpdate', skipFileEditPermission: false, thinking: true, showThinkingText: false });
        }
    }

    /** 首次配置提醒中的语言切换；持久化与默认规则联动逻辑对齐配置页。 */
    private async updateLanguage(value: unknown): Promise<void> {
        const lang = normalizeLang(value);
        try {
            await this.ensureInit();
            const res = await this.t.callEditor('systemConfig', { op: 'get' });
            const config = res?.config ?? {};
            const isDefaultRules = isBuiltinCustomRules(config.customRules);

            await this.t.callEditor('systemConfig', { op: 'saveByKey', key: 'lang', value: lang });
            await this.core.updateCoreConfByKey('lang', lang);
            if (isDefaultRules) {
                await this.t.callEditor('systemConfig', {
                    op: 'saveByKey',
                    key: 'customRules',
                    value: DEFAULT_CUSTOM_RULES[lang],
                });
                await this.core.updateCoreConfByKey('customRules', DEFAULT_CUSTOM_RULES[lang]);
            }
        } catch (e: any) {
            // React 端先乐观切换；失败时重新读取宿主持久化值回填。
            await this.sendSystemConfig();
            this.postToApp({ type: 'error', message: e?.message || 'Failed to save language setting' });
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

    /**
     * 把 core 的会话基线清单整表推给前端。attachments/<uuid>/ 下的文件是宿主自己的落盘目录，
     * 不算「编辑了项目文件」，在宿主侧过滤掉（对齐 VSCode chatWebview.pushFileChanges）。
     */
    private async pushFileChanges(sessionId: string | undefined): Promise<void> {
        const entry = sessionId ? this.sessions.get(sessionId) : undefined;
        if (!entry) return;
        try {
            const changes = (await entry.remote.getFileChanges() as any[])
                .filter(item => !isAttachmentPath(item.filePath));
            this.postToApp({ type: 'fileChanges', sessionId, changes });
        } catch (e: any) {
            console.error('Failed to load file changes:', e);
        }
    }

    /** 文件变更整表刷新：短时间内的连续写盘合并成一次查询 */
    private scheduleFileChangesRefresh(sessionId: string | undefined): void {
        if (!sessionId) return;
        const existing = this.fileChangeTimers.get(sessionId);
        if (existing) clearTimeout(existing);
        this.fileChangeTimers.set(sessionId, setTimeout(() => {
            this.fileChangeTimers.delete(sessionId);
            void this.pushFileChanges(sessionId);
        }, 150));
    }

    /**
     * 打开单文件 diff：用 core 给的会话基线 + 查询时磁盘内容，让 Kotlin 用左右文本开原生 diff。
     * minLine 由工具编辑块给（这次编辑的锚点行）；面板点击不给，改用 core 返回的首个变更行，
     * 保证复用已打开的 diff 标签时也能定位到变更处。
     * 二进制 / 超出文本上限 / 基线不可用等不可比较的情况退回打开文件，不伪造空基线。
     */
    private async handleShowFileDiff(sessionId: string | undefined, filePath: string, minLine?: number): Promise<void> {
        const entry = sessionId ? this.sessions.get(sessionId) : undefined;
        if (!entry || !filePath) return;
        // notebook 按 cell 定位，行号对 notebook 没有意义：只打开文件、不跳行
        if (filePath.toLowerCase().endsWith('.ipynb')) {
            this.t.editor('openFile', { filePath });
            return;
        }
        try {
            const diff = await entry.remote.getFileDiff(filePath);
            if (diff?.status !== 'ok') {
                this.t.editor('openFile', { filePath: diff?.filePath || filePath, line: minLine ?? diff?.line ?? 1 });
                return;
            }
            this.t.editor('showFileDiffText', {
                filePath: diff.filePath,
                leftText: diff.baselineText ?? '',
                rightText: diff.currentText ?? '',
                minLine: minLine ?? diff.line,
                fileName: diff.displayPath ? String(diff.displayPath).split(/[\\/]/).pop() : undefined,
            });
        } catch (e: any) {
            console.error('显示diff失败:', e);
            this.t.editor('openFile', { filePath, line: minLine ?? 1 });
        }
    }

    /** 放弃修改：core 写盘 / 删文件，成功的文件让 Kotlin 刷新 VFS，最后整表刷新面板 */
    private async handleRevertFiles(sessionId: string | undefined, filePaths?: string[]): Promise<void> {
        const entry = sessionId ? this.sessions.get(sessionId) : undefined;
        if (!entry) return;
        try {
            const results = await entry.remote.revertFileChanges(filePaths) as any[];
            const touched = results
                .filter(r => r.action === 'restored' || r.action === 'deleted')
                .map(r => r.filePath);
            if (touched.length > 0) this.t.editor('refreshFiles', { filePaths: touched });
            const failed = results.filter(r => r.action === 'failed');
            if (failed.length > 0) {
                this.postToApp({
                    type: 'error',
                    message: t('host.revertFilesFailed', {
                        files: failed.map(f => f.displayPath).join(', '),
                        error: failed[0].error || t('common.unknownError'),
                    }),
                });
            }
            await this.pushFileChanges(sessionId);
        } catch (e: any) {
            this.postToApp({
                type: 'error',
                message: t('host.revertFilesFailed', {
                    files: String(filePaths?.length ?? ''),
                    error: e?.message || t('common.unknownError'),
                }),
            });
        }
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
