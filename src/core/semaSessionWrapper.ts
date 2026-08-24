import { SemaSession } from 'sema-core';
import type { ForkOptions, ForkPreview, ForkResult, BranchResult } from 'sema-core';
import {
    MessageCompleteData,
    StateUpdateData,
    ThinkingChunkData,
    TextChunkData,
    SessionReadyData,
    SessionErrorData,
    SessionInterruptedData,
    ToolPermissionAutoData,
    ToolPermissionResponse,
    ToolExecutionCompleteData,
    ToolExecutionErrorData,
    TopicUpdateData,
    CompactExecData,
    TaskAgentStartData,
    TaskAgentEndData,
    PickOptionResponseData,
    PlanExitResponseData,
    PlanImplementData,
    FileReferenceData,
    ToolExecutionChunkData,
    InputProcessingData,
    TaskStartData,
    TaskEndData,
    TaskTransferData,
    ConversationUsageData,
    PermissionLevelUpdateData,
    HookNoticeData,
    Usage
} from 'sema-core/event';
import { MAIN_AGENT_ID } from 'sema-core/types';
import type { TaskListItem, AgentMode, PermissionLevel } from 'sema-core/types';
import type { InputImageAttachment } from 'sema-core';

// core 未顶层导出 InputSource，从事件数据类型推导
type InputSource = NonNullable<InputProcessingData['source']>;

import { TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_SUB_AGENT } from '../utils/tool';

export type { AgentMode, PermissionLevel };

const SKIP_COMPLETE_TOOLS = new Set<string>([TOOL_NAME_SUB_AGENT]);

export interface Message {
    id: string;
    /** fork 句柄（== input:processing 的 inputId）；仅本会话内由用户输入创建的消息才有，旧历史/恢复的消息无此字段 */
    uuid?: string;
    type: 'user' | 'assistant' | 'tool' | 'system' | 'permission_request' | 'askForm';
    content: any;
    attachments?: InputImageAttachment[];  // 用户消息携带的图片（core input:processing 回吐）
    source?: InputSource;                  // 输入来源；非 user（如 cron）时气泡上方渲染来源标签，随历史持久化
    toolName?: string;
    toolArgs?: any;
    reasoning?: string;
}

// Task 工具消息内容类型
export interface TaskMessageContent {
    taskId: string;
    agent_type: string;
    title: string;
    instructions: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    summary: string;
    taskMessages: Message[];
    background?: boolean;
}

/**
 * 会话级 wrapper 回调。
 * 除 onMessage（携带 sessionId 的 webview 消息）外，其余回调首参均为 sessionId，便于上层路由。
 */
export interface SessionWrapperCallbacks {
    onSessionReady?: (sessionId: string, data: SessionReadyData) => void;
    onStateChange?: (sessionId: string, state: 'idle' | 'processing') => void;
    /** webview 消息（已注入 sessionId） */
    onMessage?: (message: any) => void;
    onTopicUpdate?: (sessionId: string, topic: TopicUpdateData) => void;
    onToolExecutionComplete?: (sessionId: string, data: ToolExecutionCompleteData & { agentId?: string }) => void;
    onFileReference?: (sessionId: string, data: FileReferenceData) => void;
    onTaskStart?: (sessionId: string, data: TaskStartData) => void;
    onTaskEnd?: (sessionId: string, data: TaskEndData) => void;
    onSessionCleared?: (sessionId: string) => void;
    onOpenAgentDetail?: (sessionId: string, taskId: string) => void;
    /** 用户在前端响应了某个交互；权限响应时第二参为所选 option key（同意/拒绝）。 */
    onUserResponded?: (sessionId: string, permissionSelected?: string) => void;
    /** 标题变化（用于 tab 栏 / 历史保存） */
    onTitleUpdate?: (sessionId: string, title: string) => void;
}

/**
 * SemaSessionWrapper —— 会话级 wrapper
 * 每个会话一个实例，包裹一个 SemaSession，承载该会话的消息历史、流式状态与事件订阅。
 */
export class SemaSessionWrapper {
    public readonly sessionId: string;
    private session: SemaSession;

    private currentState: 'idle' | 'processing' = 'idle';
    private sessionReady: boolean = false;
    public title: string = '';

    public messageHistory: Array<Message> = [];
    private streamingAssistantMap: Map<string, Message> = new Map();
    private taskAgentMap: Map<string, { idx: number; msg: Message }> = new Map();
    private streamingToolMap: Map<string, Message> = new Map();
    private taskAgentThrottleTimer: NodeJS.Timeout | null = null;
    private pendingTaskUpdates: Set<string> = new Set();
    private pendingAutoPermissions: Map<string, string> = new Map(); // toolId → content
    private _agentMode: AgentMode;
    private _permissionLevel: PermissionLevel = 'Ask';
    private lastUsage: Usage | null = null;
    private lastTodos: any[] = [];

    constructor(
        session: SemaSession,
        private callbacks: SessionWrapperCallbacks,
        agentMode: AgentMode = 'Agent'
    ) {
        this.session = session;
        this.sessionId = session.sessionId;
        this._agentMode = agentMode;
        this.setupEventListeners();
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    private isSubAgent(agentId?: string): boolean {
        return !!agentId && agentId !== MAIN_AGENT_ID;
    }

    // ─── 会话交互 ─────────────────────────────────────────────────────────────

    public processUserInput(content: string, orgContent?: string, attachments?: InputImageAttachment[]): void {
        this.session.processUserInput(content, orgContent, attachments);
    }

    /** 预览：在该用户消息处恢复文件会改动哪些文件、各自增删行数（只读、同步，无副作用） */
    public getForkPreview(messageUuid: string): ForkPreview {
        const preview = this.session.getForkPreview(messageUuid);
        // console.log('[fork] getForkPreview', messageUuid, '=>', JSON.stringify(preview));
        return preview;
    }

    /** 原地回退（Fork / 撤销）到该用户消息之前；restoreFiles=true 时同时回滚文件。会话 id 不变 */
    public async fork(messageUuid: string, options?: ForkOptions): Promise<ForkResult> {
        const result = await this.session.fork(messageUuid, options);
        // console.log('[fork] fork', messageUuid, JSON.stringify(options), '=>', JSON.stringify(result));
        return result;
    }

    /**
     * 分支到新聊天：core 新建 sessionId 并全量复制当前历史（截断后的 editlog 副本一并复制），
     * 当前会话与工作区文件不动。调用方拿到新 id 后用 createSession({ sessionId }) 打开。
     */
    public async branch(beforeMessageUuid?: string): Promise<BranchResult> {
        return this.session.branch(beforeMessageUuid);
    }

    public interruptSession(): void {
        this.session.interrupt();
    }

    public respondToToolPermission(response: ToolPermissionResponse): void {
        this.callbacks.onUserResponded?.(this.sessionId, response.selected);
        this.session.respondToToolPermission(response);
    }

    public respondToPickOption(response: PickOptionResponseData): void {
        this.callbacks.onUserResponded?.(this.sessionId);
        this.session.respondToPickOption(response);
    }

    public respondToPlanExit(response: PlanExitResponseData): void {
        this.callbacks.onUserResponded?.(this.sessionId);
        this.session.respondToPlanExit(response);
    }

    public updateAgentMode(mode: AgentMode): void {
        this._agentMode = mode;
        this.session.updateAgentMode(mode);
    }

    public getAgentMode(): AgentMode {
        return this._agentMode;
    }

    public updatePermissionLevel(level: PermissionLevel): void {
        this._permissionLevel = level;
        this.session.updatePermissionLevel(level);
    }

    public watchTask(taskId: string, onDelta: (delta: string) => void): () => void {
        return this.session.watchTask(taskId, onDelta);
    }

    public transferAgentToBackground(taskId: string): boolean {
        const result = this.session.transferAgentToBackground(taskId);
        if (result) {
            const entry = this.taskAgentMap.get(taskId);
            if (entry) {
                const taskContent = entry.msg.content as TaskMessageContent;
                taskContent.background = true;
                this.sendUpdateMessage(entry.msg.id, taskContent);
            }
        }
        return result;
    }

    public stopTask(taskId: string): void {
        this.session.stopTask(taskId);
    }

    public stopAllTasks(): number {
        return this.session.stopAllTasks();
    }

    public getTaskList(): TaskListItem[] {
        return this.session.getTaskList();
    }

    // ─── 状态访问 ─────────────────────────────────────────────────────────────

    public getCurrentState(): 'idle' | 'processing' {
        return this.currentState;
    }

    public isReady(): boolean {
        return this.sessionReady;
    }

    /**
     * webview 侧 ChatSession 挂载后，回放当前会话完整状态，避免错过早于挂载的事件。
     */
    public sendInitialState(): void {
        this.sendContentUpdate();
        this.post(this.sessionReady
            ? { type: 'enableInput' }
            : { type: 'disableInput', message: '正在初始化 CLI，请稍候...' });
        this.post({ type: 'agentModeUpdate', mode: this._agentMode });
        this.post({ type: 'permissionLevelUpdate', level: this._permissionLevel });
        this.post({ type: 'stateUpdate', state: this.currentState });
        if (this.lastUsage) {
            this.post({ type: 'updateTokenInfo', tokenInfo: this.lastUsage });
        }
        if (this.lastTodos.length > 0) {
            this.post({ type: 'todosUpdate', todos: this.lastTodos });
        }
    }

    // ─── 消息历史 ─────────────────────────────────────────────────────────────

    public updateMessageHistory(message: Message[]): void {
        this.messageHistory = message;
        this.sendContentUpdate();
    }

    public updateTitle(title: string): void {
        this.setTitle(title);
    }

    public clearMessageHistory(): void {
        this.messageHistory = [];
        this.setTitle('');
        this.taskAgentMap.clear();
        this.streamingToolMap.clear();
        this.streamingAssistantMap.clear();
        this.pendingTaskUpdates.clear();
        this.pendingAutoPermissions.clear();
        if (this.taskAgentThrottleTimer) {
            clearTimeout(this.taskAgentThrottleTimer);
            this.taskAgentThrottleTimer = null;
        }
        this.sendContentUpdate();
    }

    public getMessageHistory(): Message[] {
        return [...this.messageHistory];
    }

    private setTitle(title: string): void {
        if (this.title === title) return;
        this.title = title;
        this.callbacks.onTitleUpdate?.(this.sessionId, title);
    }

    public insertPermissionRequestMessage(permissionData: any): void {
        const message: Message = {
            id: this.generateId(),
            type: 'permission_request',
            content: {
                toolName: permissionData.toolName,
                title: permissionData.title,
                content: permissionData.content,
                action: permissionData.action,
                refuseMessage: permissionData.refuseMessage
            },
        };

        if (this.isSubAgent(permissionData.agentId)) {
            this.addMessageToTaskAgent(permissionData.agentId, message);
            return;
        }

        this.messageHistory.push(message);
        this.sendAppendMessages([message]);
    }

    public insertAskFormRequestMessage(askFormData: any): void {
        const message: Message = {
            id: this.generateId(),
            type: 'askForm',
            content: {
                data: askFormData.data,
                status: askFormData.status,
                values: askFormData.values,
            },
        };

        if (this.isSubAgent(askFormData.agentId)) {
            this.addMessageToTaskAgent(askFormData.agentId, message);
            return;
        }

        this.messageHistory.push(message);
        this.sendAppendMessages([message]);
    }

    // ─── 事件订阅 ─────────────────────────────────────────────────────────────

    private setupEventListeners(): void {
        this.setupSessionListeners();
        this.setupInputListeners();
        this.setupMessageListeners();
        this.setupToolListeners();
        this.setupMetaListeners();
        this.setupTaskAgentListeners();
        this.setupTaskListeners();
        this.setupInteractionListeners();
    }

    private setupSessionListeners(): void {
        this.session.on<SessionReadyData>('session:ready', (data) => {
            this.sessionReady = true;
            this.post({ type: 'enableInput' });
            if (data.usage) {
                this.lastUsage = data.usage;
                this.post({ type: 'updateTokenInfo', tokenInfo: data.usage });
            }
            if (Array.isArray(data.todos) && data.todos.length > 0) {
                this.lastTodos = data.todos;
                this.post({ type: 'todosUpdate', todos: data.todos });
            }
            this.callbacks.onSessionReady?.(this.sessionId, data);
        });

        this.session.on<FileReferenceData>('file:reference', (data) => {
            if (data.references && data.references.length > 0) {
                const msg: Message = {
                    id: this.generateId(),
                    type: 'system',
                    content: {
                        type: 'file_reference',
                        content: data.references.map(ref => ref.content)
                    },
                };
                this.messageHistory.push(msg);
                this.sendAppendMessages([msg]);
                this.callbacks.onFileReference?.(this.sessionId, data);
            }
        });

        this.session.on<SessionInterruptedData & { agentId?: string }>('session:interrupted', (data) => {
            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, {
                    id: this.generateId(),
                    type: 'system',
                    content: { type: 'interrupted', content: data.content },
                });
                return;
            }

            // 中断时 finalize 流式消息，确保 webview 结束流式状态并保留已输出内容
            for (const [, msg] of this.streamingAssistantMap) {
                msg.content.completed = true;
                this.sendCompleteUpdate(msg.id, { content: msg.content, reasoning: msg.reasoning });
            }
            this.streamingAssistantMap.clear();
            this.streamingToolMap.clear();
            this.pendingTaskUpdates.clear();
            this.pendingAutoPermissions.clear();

            if (this.messageHistory.length === 0) {
                return;
            }

            const interruptedMsg: Message = {
                id: this.generateId(),
                type: 'system',
                content: { type: 'interrupted', content: data.content },
            };
            this.messageHistory.push(interruptedMsg);
            this.sendAppendMessages([interruptedMsg]);
        });

        this.session.on<ToolPermissionAutoData>('tool:permission:auto', (data) => {
            this.pendingAutoPermissions.set(data.toolId, data.content);
        });

        this.session.on<SessionErrorData>('session:error', (data) => {
            console.error('Session error:', data);
            const errorMessage = data.error?.message || 'Unknown error';
            const sessionErrorMsg: Message = {
                id: this.generateId(),
                type: 'system',
                content: {
                    type: 'session_error',
                    content: `Error: [${data.type}]${errorMessage}`,
                    errorType: data.type
                },
            };
            this.messageHistory.push(sessionErrorMsg);
            this.sendAppendMessages([sessionErrorMsg]);
        });

        // hook:notice 只在三种情况发出：脚本输出 systemMessage、hook 超时等告警、输入被 UserPromptSubmit 拦截
        this.session.on<HookNoticeData>('hook:notice', (data) => {
            if (!data?.message) return;
            const label = data.kind === 'warning' ? 'Hook 警告'
                : data.kind === 'blocked' ? 'Hook 拦截'
                : 'Hook';
            const event = data.hookEvent ? `[${data.hookEvent}]` : '';
            const noticeMsg: Message = {
                id: this.generateId(),
                type: 'system',
                content: { type: 'hook_notice', content: `${label}${event}: ${data.message}`, kind: data.kind },
            };
            this.messageHistory.push(noticeMsg);
            this.sendAppendMessages([noticeMsg]);
        });

        this.session.on<{ sessionId: string | null }>('session:cleared', (_data) => {
            this.clearMessageHistory();
            this.setTitle('新会话');
            this.messageHistory.push({
                id: this.generateId(),
                type: 'user',
                content: '/clear',
            });
            this.messageHistory.push({
                id: this.generateId(),
                type: 'system',
                content: { type: 'clear', content: '(no content)' },
            });
            this.lastTodos = [];
            this.lastUsage = null;
            this.sendContentUpdate();
            this.callbacks.onSessionCleared?.(this.sessionId);
        });
    }

    private setupInputListeners(): void {
        this.session.on<InputProcessingData>('input:processing', (data) => {
            const content = data.originalInput || data.input;

            const hasUserMessages = this.messageHistory.some(m => m.type === 'user');
            if (!hasUserMessages) {
                let title = content.trim();
                if (title.length > 50) {
                    title = title.substring(0, 50) + '...';
                }
                this.setTitle(title || '新对话');
            }

            const userMsg: Message = {
                id: this.generateId(),
                uuid: data.inputId,
                type: 'user',
                content: content,
                attachments: data.attachments,  // core 回吐的规范化图片，按 inputId 天然对应
                source: data.source,
            };
            this.messageHistory.push(userMsg);
            this.sendAppendMessages([userMsg]);

            // 通知前端清除 pending 状态
            this.post({ type: 'inputProcessing', data });
        });
    }

    private setupMessageListeners(): void {
        this.session.on<StateUpdateData>('state:update', (data) => {
            this.currentState = data.state;
            this.post({ type: 'stateUpdate', state: data.state });
            this.callbacks.onStateChange?.(this.sessionId, data.state);
        });

        this.session.on<ThinkingChunkData & { id?: string; delta?: string }>('message:thinking:chunk', (data) => {
            const msgId = data.id || 'default-stream';
            const delta = data.delta ?? '';
            const existing = this.streamingAssistantMap.get(msgId);
            if (existing) {
                existing.reasoning = (existing.reasoning || '') + delta;
                this.sendChunkUpdate(existing.id, { reasoningDelta: delta });
                return;
            }

            const newMessage: Message = {
                id: msgId,
                type: 'assistant',
                content: { messageType: 'text', content: '', completed: false },
                reasoning: delta,
            };
            this.streamingAssistantMap.set(msgId, newMessage);
            this.messageHistory.push(newMessage);
            this.sendAppendMessages([newMessage]);
        });

        this.session.on<TextChunkData>('message:text:chunk', (data) => {
            const msgId = data.id || 'default-stream';
            const existing = this.streamingAssistantMap.get(msgId);
            if (existing) {
                existing.content.content = (existing.content.content || '') + data.delta;
                this.sendChunkUpdate(existing.id, { contentDelta: data.delta });
                return;
            }

            const newMessage: Message = {
                id: msgId,
                type: 'assistant',
                content: { messageType: 'text', content: data.delta, completed: false },
            };
            this.streamingAssistantMap.set(msgId, newMessage);
            this.messageHistory.push(newMessage);
            this.sendAppendMessages([newMessage]);
            this.sendChunkUpdate(msgId, { contentDelta: data.delta });
        });

        this.session.on<MessageCompleteData & { agentId?: string; id?: string }>('message:complete', (data) => {
            if (!data.content && !data.reasoning && !data.hasToolCalls) {
                if (data.id) this.streamingAssistantMap.delete(data.id);
                return;
            }

            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, {
                    id: this.generateId(),
                    type: 'assistant',
                    content: {
                        messageType: 'text',
                        content: data.content,
                        completed: true,
                        hasToolCalls: data.hasToolCalls,
                    },
                    reasoning: data.reasoning,
                });
                return;
            }

            const streamingMessage = data.id
                ? this.streamingAssistantMap.get(data.id)
                : this.streamingAssistantMap.values().next().value;

            let messageUpdated = false;

            if (streamingMessage) {
                if (data.content) {
                    streamingMessage.content = {
                        messageType: streamingMessage.content.messageType || 'text',
                        content: data.content,
                        completed: true,
                        hasToolCalls: data.hasToolCalls,
                    };
                } else {
                    streamingMessage.content.completed = true;
                    streamingMessage.content.hasToolCalls = data.hasToolCalls;
                }
                if (data.reasoning) {
                    streamingMessage.reasoning = data.reasoning;
                }
                if (data.id) this.streamingAssistantMap.delete(data.id);
                messageUpdated = true;
            }

            let newCompleteMessage: Message | undefined;
            if (!messageUpdated) {
                // console.warn('No streaming message found, creating new complete message');
                newCompleteMessage = {
                    id: this.generateId(),
                    type: 'assistant',
                    content: {
                        messageType: 'text',
                        content: data.content,
                        completed: true,
                        hasToolCalls: data.hasToolCalls,
                    },
                };
                if (data.reasoning) {
                    newCompleteMessage.reasoning = data.reasoning;
                }
                this.messageHistory.push(newCompleteMessage);
                messageUpdated = true;
            }

            if (messageUpdated) {
                if (streamingMessage) {
                    this.sendCompleteUpdate(streamingMessage.id, {
                        content: streamingMessage.content,
                        reasoning: streamingMessage.reasoning
                    });
                } else if (newCompleteMessage) {
                    this.sendAppendMessages([newCompleteMessage]);
                }
            }
        });
    }

    private setupToolListeners(): void {
        this.session.on<ToolExecutionChunkData & { agentId?: string }>('tool:execution:chunk', (data) => {
            if (this.isSubAgent(data.agentId)) {
                return;
            }

            const toolId = data.toolId;
            if (toolId && this.streamingToolMap.has(toolId)) {
                const existingMessage = this.streamingToolMap.get(toolId)!;
                // content 字段为增量，需累加到已有内容上
                const delta = typeof data.content === 'string' ? data.content : '';
                const accumulatedContent = (existingMessage.content.content || '') + delta;
                existingMessage.content = { ...data, content: accumulatedContent, completed: false };
                this.sendToolChunkUpdate(existingMessage.id, delta);
            } else {
                const newMessage: Message = {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: false },
                    toolName: data.toolName,
                };
                this.messageHistory.push(newMessage);
                if (toolId) {
                    this.streamingToolMap.set(toolId, newMessage);
                }
                this.sendAppendMessages([newMessage]);
            }
        });

        this.session.on<ToolExecutionCompleteData & { agentId?: string }>('tool:execution:complete', (data) => {
            this.callbacks.onToolExecutionComplete?.(this.sessionId, data);

            const autoAllowedContent = data.toolId ? this.pendingAutoPermissions.get(data.toolId) : undefined;
            if (data.toolId) {
                this.pendingAutoPermissions.delete(data.toolId);
            }

            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: true, ...(autoAllowedContent ? { autoAllowedContent } : {}) },
                    toolName: data.toolName,
                });
                return;
            }

            if (SKIP_COMPLETE_TOOLS.has(data.toolName)) {
                return;
            }

            const toolId = data.toolId;
            if (toolId && this.streamingToolMap.has(toolId)) {
                const existingMessage = this.streamingToolMap.get(toolId)!;
                const updatedContent = { ...data, completed: true, ...(autoAllowedContent ? { autoAllowedContent } : {}) };
                const updatedMessage = { ...existingMessage, content: updatedContent };
                const idx = this.messageHistory.indexOf(existingMessage);
                if (idx >= 0) this.messageHistory[idx] = updatedMessage;
                this.streamingToolMap.delete(toolId);
                this.sendUpdateMessage(existingMessage.id, updatedContent);
            } else {
                const newToolMsg: Message = {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: true, ...(autoAllowedContent ? { autoAllowedContent } : {}) },
                    toolName: data.toolName,
                };
                this.messageHistory.push(newToolMsg);
                this.sendAppendMessages([newToolMsg]);
            }
        });

        this.session.on<ToolExecutionErrorData & { agentId?: string }>('tool:execution:error', (data) => {
            console.error('Tool execution error:', data);

            const errorMessage: Message = {
                id: this.generateId(),
                type: 'system',
                content: {
                    type: 'tool_error',
                    content: data.content,
                    toolName: data.toolName,
                    title: data.title
                },
                toolName: data.toolName,
            };

            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, errorMessage);
                return;
            }

            this.messageHistory.push(errorMessage);
            this.sendAppendMessages([errorMessage]);
        });
    }

    private setupMetaListeners(): void {
        this.session.on<TopicUpdateData>('topic:update', (data) => {
            if (data.title && data.title.trim() && this.title !== data.title) {
                this.setTitle(data.title);
                this.callbacks.onTopicUpdate?.(this.sessionId, data);
            }
        });

        this.session.on<CompactExecData>('compact:exec', (data) => {
            const finalContent = (data.errMsg && data.errMsg.trim() !== '')
                ? `Compacted: ${data.errMsg}`
                : `Compacted`;

            // 从末尾找最后一条用户消息，截断其之前的内容
            const lastUserIdx = this.messageHistory.reduceRight(
                (found, m, i) => (found === -1 && m.type === 'user' ? i : found), -1
            );
            if (lastUserIdx > 0) {
                this.messageHistory = this.messageHistory.slice(lastUserIdx);
                // 更新 taskAgentMap 中的索引
                for (const [taskId, entry] of this.taskAgentMap.entries()) {
                    const newIdx = this.messageHistory.indexOf(entry.msg);
                    if (newIdx === -1) {
                        this.taskAgentMap.delete(taskId);
                    } else {
                        entry.idx = newIdx;
                    }
                }
            }

            const compactMsg: Message = {
                id: this.generateId(),
                type: 'system',
                content: { type: 'compact', content: finalContent },
            };
            this.messageHistory.push(compactMsg);
            this.sendContentUpdate();
            this.callbacks.onSessionCleared?.(this.sessionId);
        });

        this.session.on<PlanImplementData>('plan:implement', (data) => {
            const planMsg: Message = {
                id: this.generateId(),
                type: 'system',
                content: {
                    type: 'plan_implement',
                    planFilePath: data.planFilePath,
                    planContent: data.planContent
                },
            };
            this.messageHistory.push(planMsg);
            this.sendAppendMessages([planMsg]);
        });
    }

    private setupTaskListeners(): void {
        this.session.on<TaskStartData>('task:start', (data) => {
            this.callbacks.onTaskStart?.(this.sessionId, data);
        });

        this.session.on<TaskTransferData>('task:transfer', (data) => {
            this.callbacks.onTaskStart?.(this.sessionId, data);
        });

        this.session.on<TaskEndData>('task:end', (data) => {
            this.callbacks.onTaskEnd?.(this.sessionId, data);

            if (data.summary) {
                const taskEndMessage: Message = {
                    id: this.generateId(),
                    type: 'system',
                    content: {
                        type: 'task_end',
                        status: data.status,
                        summary: data.summary,
                    },
                };
                this.messageHistory.push(taskEndMessage);
                this.sendAppendMessages([taskEndMessage]);
            }
        });
    }

    private setupTaskAgentListeners(): void {
        this.session.on<TaskAgentStartData>('task:agent:start', (data) => {
            this.handleTaskAgentStart(data);
        });

        this.session.on<TaskAgentEndData>('task:agent:end', (data) => {
            this.handleTaskAgentEnd(data);
        });
    }

    private setupInteractionListeners(): void {
        this.session.on('tool:permission:request', (data: any) => {
            this.post({ type: 'toolPermissionRequest', data });
        });
        this.session.on('pick:option:request', (data: any) => {
            this.post({ type: 'askFormRequest', data });
        });
        this.session.on('plan:exit:request', (data: any) => {
            this.post({ type: 'planExitRequest', data });
        });
        this.session.on<ConversationUsageData>('conversation:usage', (data) => {
            this.lastUsage = data.usage;
            this.post({ type: 'updateTokenInfo', tokenInfo: data.usage });
        });
        this.session.on('todos:update', (data: any) => {
            this.lastTodos = Array.isArray(data) ? data : [];
            this.post({ type: 'todosUpdate', todos: data });
        });
        this.session.on('input:received', (data: any) => {
            this.post({ type: 'inputReceived', data });
        });
        this.session.on('quickchat:response', (data: any) => {
            this.post({ type: 'quickchatResponse', data });
        });
        this.session.on<PermissionLevelUpdateData>('permissionLevel:update', (data) => {
            this._permissionLevel = data.level;
            this.post({ type: 'permissionLevelUpdate', level: data.level });
        });
    }

    // ─── webview 消息发送（统一注入 sessionId）─────────────────────────────────

    private post(message: any): void {
        this.callbacks.onMessage?.({ ...message, sessionId: this.sessionId });
    }

    private sendContentUpdate(): void {
        this.post({ type: 'updateContent', messages: [...this.messageHistory] });
    }

    private sendChunkUpdate(messageId: string, update: { contentDelta?: string; reasoningDelta?: string }): void {
        this.post({ type: 'chunkUpdate', id: messageId, ...update });
    }

    private sendCompleteUpdate(messageId: string, update: { content?: any; reasoning?: string }): void {
        this.post({ type: 'completeUpdate', id: messageId, ...update });
    }

    private sendToolChunkUpdate(messageId: string, contentDelta: string): void {
        this.post({ type: 'toolChunkUpdate', id: messageId, contentDelta });
    }

    private sendAppendMessages(messages: Message[]): void {
        this.post({ type: 'appendMessages', messages });
    }

    private sendUpdateMessage(id: string, content: any): void {
        this.post({ type: 'updateMessage', id, content });
    }

    // ─── Task Agent ───────────────────────────────────────────────────────────

    private handleTaskAgentStart(data: TaskAgentStartData): void {
        const userMessage: Message = {
            id: this.generateId(),
            type: 'user',
            content: data.instructions,
        };

        const taskMessage: Message = {
            id: this.generateId(),
            type: 'tool',
            toolName: 'Agent',
            content: {
                taskId: data.taskId,
                agent_type: data.agent_type,
                title: data.title,
                instructions: data.instructions,
                status: 'running',
                summary: data.instructions,
                taskMessages: [userMessage],
                background: data.background
            } as TaskMessageContent,
        };

        this.messageHistory.push(taskMessage);
        this.taskAgentMap.set(data.taskId, { idx: this.messageHistory.length - 1, msg: taskMessage });
        this.sendAppendMessages([taskMessage]);
    }

    private handleTaskAgentEnd(data: TaskAgentEndData): void {
        const entry = this.taskAgentMap.get(data.taskId);
        if (!entry) {
            console.warn(`Task agent end: taskId ${data.taskId} not found`);
            return;
        }

        const taskContent = entry.msg.content as TaskMessageContent;
        taskContent.status = data.status;
        taskContent.summary = data.content;
        this.sendUpdateMessage(entry.msg.id, taskContent);
    }

    private addMessageToTaskAgent(taskId: string, message: Message): void {
        const entry = this.taskAgentMap.get(taskId);
        if (!entry) {
            console.warn(`addMessageToTaskAgent: taskId ${taskId} not found`);
            return;
        }

        const taskContent = entry.msg.content as TaskMessageContent;
        taskContent.taskMessages.push(message);
        taskContent.summary = this.generateTaskSummary(taskContent);

        // 节流：3s 内多次更新只发一次
        this.pendingTaskUpdates.add(taskId);
        if (!this.taskAgentThrottleTimer) {
            this.taskAgentThrottleTimer = setTimeout(() => {
                this.taskAgentThrottleTimer = null;
                const taskIds = [...this.pendingTaskUpdates];
                this.pendingTaskUpdates.clear();
                this.pendingAutoPermissions.clear();
                for (const tid of taskIds) {
                    const e = this.taskAgentMap.get(tid);
                    if (e) {
                        this.sendUpdateMessage(e.msg.id, e.msg.content);
                    }
                }
            }, 3000);
        }
    }

    /**
     * 生成任务摘要
     * 规则：最近的2个工具调用标题 + '\nUsed N tools'
     * 若工具不足2个，显示 prompt 内容 + 工具调用标题
     */
    private generateTaskSummary(taskContent: TaskMessageContent): string {
        const toolMessages = taskContent.taskMessages.filter(m => m.type === 'tool');
        const toolCount = toolMessages.length;

        const formatToolDisplay = (m: Message): string => {
            const toolName = m.toolName || 'Unknown Tool';
            // 标题可能是多行终端命令等，折叠为单行，保证每个工具只占一行
            const title = (m.content?.title || '').replace(/\\?\s*\n\s*/g, ' ').trim();

            if (toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT) {
                return `Search(${title})`;
            }
            return title ? `${toolName}(${title})` : toolName;
        };

        const recentTools = toolMessages.slice(-2);
        const toolTitles = recentTools.map(formatToolDisplay).join('\n');

        if (toolCount < 2) {
            return `${taskContent.instructions}\n${toolTitles}`;
        }
        return `${toolTitles}\nUsed ${toolCount} tools`;
    }

    public openAgentDetail(taskId: string): void {
        this.callbacks.onOpenAgentDetail?.(this.sessionId, taskId);
    }

    // ─── 资源释放 ─────────────────────────────────────────────────────────────

    /**
     * 释放 wrapper 本地状态。SemaSession 的销毁由 SessionPool.closeSession 统一处理，
     * 这里不再调用 session.dispose()，避免重复释放。
     */
    public dispose(): void {
        try {
            if (this.taskAgentThrottleTimer) {
                clearTimeout(this.taskAgentThrottleTimer);
                this.taskAgentThrottleTimer = null;
            }
            this.messageHistory = [];
            this.streamingAssistantMap.clear();
            this.streamingToolMap.clear();
            this.taskAgentMap.clear();
            this.pendingTaskUpdates.clear();
            this.pendingAutoPermissions.clear();
            this.callbacks = {};
        } catch (error) {
            console.error('Error disposing SemaSessionWrapper:', error);
        }
    }
}
