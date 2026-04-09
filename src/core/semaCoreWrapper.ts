import { SemaCore } from 'sema-core';
import {
    MessageCompleteData,
    StateUpdateData,
    ThinkingChunkData,
    TextChunkData,
    SessionReadyData,
    SessionErrorData,
    SessionInterruptedData,
    ToolPermissionResponse,
    ToolExecutionCompleteData,
    ToolExecutionErrorData,
    TopicUpdateData,
    CompactExecData,
    TaskAgentStartData,
    TaskAgentEndData,
    AskQuestionResponseData,
    PlanExitResponseData,
    PlanImplementData,
    FileReferenceData,
    ToolExecutionChunkData,
    InputProcessingData,
    TaskStartData,
    TaskEndData,
    TaskTransferData
} from 'sema-core/event';
import {
    SemaCoreConfig,
    ModelConfig,
    TaskConfig,
    FetchModelsParams,
    FetchModelsResult,
    ApiTestParams,
    ApiTestResult,
    ModelUpdateData,
    UpdatableCoreConfig,
    ToolInfo,
    MAIN_AGENT_ID,
    MarketplacePluginsInfo,
    PluginScope,
    AgentConfig,
    SkillConfig,
    CommandConfig,
    MCPServerConfig,
    MCPServerInfo,
    MemoryConfig,
    RuleConfig,
    TaskListItem
} from 'sema-core/types';

import { SystemConfigManager } from '../managers/SystemConfigManager';


export interface SemaWrapperCallbacks {
    onSessionReady?: (data: SessionReadyData) => void;
    onModelUpdate?: (data: ModelUpdateData) => void;
    onStateChange?: (state: 'idle' | 'processing') => void;

    onMessage?: (message: any) => void;
    onTopicUpdate?: (topic: TopicUpdateData) => void;
    onToolExecutionComplete?: (data: ToolExecutionCompleteData & { agentId?: string }) => void;
    onTaskStart?: (data: TaskStartData) => void;
    onTaskEnd?: (data: TaskEndData) => void;
    onSessionCleared?: () => void;
    onOpenAgentDetail?: (taskId: string) => void;
}

export interface Message {
    id: string;
    type: 'user' | 'assistant' | 'tool' | 'system' | 'permission_request';
    content: any;
    toolName?: string;
    toolArgs?: any;
    reasoning?: string;
}

// Task 工具消息内容类型
export interface TaskMessageContent {
    taskId: string;
    subagent_type: string;
    description: string;
    prompt: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    summary: string;
    taskMessages: Message[];
    run_in_background?: boolean;
}

export class SemaCoreWrapper {
    private semaCore: SemaCore;
    private currentState: 'idle' | 'processing' = 'idle';
    private sessionReady: boolean = false;
    public currentSessionId: string | null = null;
    public title: string = '';
    private systemConfigManager: SystemConfigManager;

    public messageHistory: Array<Message> = [];
    private streamingAssistantMap: Map<string, Message> = new Map();
    private taskAgentMap: Map<string, { idx: number; msg: Message }> = new Map();
    private streamingToolMap: Map<string, Message> = new Map();
    private taskAgentThrottleTimer: NodeJS.Timeout | null = null;
    private pendingTaskUpdates: Set<string> = new Set();

    constructor(workingDir: string, private callbacks: SemaWrapperCallbacks, systemConfigManager: SystemConfigManager) {
        this.systemConfigManager = systemConfigManager;

        const systemConfig = this.systemConfigManager.getSystemConfig();
        const useTools = this.systemConfigManager.getUseTools();

        const config: SemaCoreConfig = {
            workingDir,
            logLevel: 'error',
            ...systemConfig,
            useTools: useTools
        };

        this.semaCore = new SemaCore(config);
        this.setupEventListeners();
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    public async createSession(sessionId?: string): Promise<void> {
        await this.semaCore.createSession(sessionId);
    }

    public processUserInput(content: string, orgContent?: string): void {
        this.semaCore.processUserInput(content, orgContent);
    }

    public interruptSession(): void {
        this.semaCore.interruptSession();
    }

    private isSubAgent(agentId?: string): boolean {
        return !!agentId && agentId !== MAIN_AGENT_ID;
    }

    private setupEventListeners(): void {
        this.setupSessionListeners();
        this.setupInputListeners();
        this.setupMessageListeners();
        this.setupToolListeners();
        this.setupMetaListeners();
        this.setupTaskAgentListeners();
        this.setupTaskListeners();
    }

    private setupSessionListeners(): void {
        this.semaCore.on<SessionReadyData>('session:ready', (data) => {
            this.currentSessionId = data.sessionId;
            this.sessionReady = true;
            this.callbacks.onSessionReady?.(data);
        });

        this.semaCore.on<FileReferenceData>('file:reference', (data) => {
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
            }
        });

        this.semaCore.on<SessionInterruptedData & { agentId?: string }>('session:interrupted', (data) => {
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

        this.semaCore.on<SessionErrorData>('session:error', (data) => {
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

        this.semaCore.on<{ sessionId: string | null }>('session:cleared', (_data) => {
            this.clearMessageHistory();
            this.title = '新会话';
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
            this.sendContentUpdate();
            this.callbacks.onSessionCleared?.();
        });
    }

    private setupInputListeners(): void {
        this.semaCore.on<InputProcessingData>('input:processing', (data) => {
            const content = data.originalInput || data.input;

            const hasUserMessages = this.messageHistory.some(m => m.type === 'user');
            if (!hasUserMessages) {
                let title = content.trim();
                if (title.length > 50) {
                    title = title.substring(0, 50) + '...';
                }
                this.title = title || '新对话';
            }

            const userMsg: Message = {
                id: this.generateId(),
                type: 'user',
                content: content,
            };
            this.messageHistory.push(userMsg);
            this.sendAppendMessages([userMsg]);

            // 通知前端清除 pending 状态
            this.callbacks.onMessage?.({ type: 'inputProcessing', data });
        });
    }

    private setupMessageListeners(): void {
        this.semaCore.on<StateUpdateData>('state:update', (data) => {
            this.currentState = data.state;
            this.callbacks.onStateChange?.(data.state);
        });

        this.semaCore.on<ThinkingChunkData & { id?: string; delta?: string }>('message:thinking:chunk', (data) => {
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

        this.semaCore.on<TextChunkData>('message:text:chunk', (data) => {
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
        });

        this.semaCore.on<MessageCompleteData & { agentId?: string; id?: string }>('message:complete', (data) => {
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
                console.warn('No streaming message found, creating new complete message');
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
        this.semaCore.on<ToolExecutionChunkData & { agentId?: string }>('tool:execution:chunk', (data) => {
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

        this.semaCore.on<ToolExecutionCompleteData & { agentId?: string }>('tool:execution:complete', (data) => {
            this.callbacks.onToolExecutionComplete?.(data);

            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: true },
                    toolName: data.toolName,
                });
                return;
            }

            if (data.toolName === 'Agent') {
                return;
            }

            const toolId = data.toolId;
            if (toolId && this.streamingToolMap.has(toolId)) {
                const existingMessage = this.streamingToolMap.get(toolId)!;
                const updatedContent = { ...data, completed: true };
                const updatedMessage = { ...existingMessage, content: updatedContent };
                const idx = this.messageHistory.indexOf(existingMessage);
                if (idx >= 0) this.messageHistory[idx] = updatedMessage;
                this.streamingToolMap.delete(toolId);
                this.sendUpdateMessage(existingMessage.id, updatedContent);
            } else {
                const newToolMsg: Message = {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: true },
                    toolName: data.toolName,
                };
                this.messageHistory.push(newToolMsg);
                this.sendAppendMessages([newToolMsg]);
            }
        });

        this.semaCore.on<ToolExecutionErrorData & { agentId?: string }>('tool:execution:error', (data) => {
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
        this.semaCore.on<TopicUpdateData>('topic:update', (data) => {
            if (data.title && data.title.trim() && this.title !== data.title) {
                this.title = data.title;
                this.callbacks.onTopicUpdate?.(data);
            }
        });

        this.semaCore.on<CompactExecData>('compact:exec', (data) => {
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
            this.callbacks.onSessionCleared?.();
        });

        this.semaCore.on<PlanImplementData>('plan:implement', (data) => {
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
        this.semaCore.on<TaskStartData>('task:start', (data) => {
            this.callbacks.onTaskStart?.(data);
        });

        this.semaCore.on<TaskTransferData>('task:transfer', (data) => {
            if (data.to === 'background') {
                this.callbacks.onTaskStart?.({ taskId: data.taskId, filepath: '', type: 'Agent' } as TaskStartData);
            }
        });

        this.semaCore.on<TaskEndData>('task:end', (data) => {
            this.callbacks.onTaskEnd?.(data);

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
        this.semaCore.on<TaskAgentStartData>('task:agent:start', (data) => {
            this.handleTaskAgentStart(data);
        });

        this.semaCore.on<TaskAgentEndData>('task:agent:end', (data) => {
            this.handleTaskAgentEnd(data);
        });
    }

    private sendContentUpdate(): void {
        this.callbacks.onMessage?.({
            type: 'updateContent',
            messages: [...this.messageHistory]
        });
    }

    private sendChunkUpdate(messageId: string, update: { contentDelta?: string; reasoningDelta?: string }): void {
        this.callbacks.onMessage?.({
            type: 'chunkUpdate',
            id: messageId,
            ...update
        });
    }

    private sendCompleteUpdate(messageId: string, update: { content?: any; reasoning?: string }): void {
        this.callbacks.onMessage?.({
            type: 'completeUpdate',
            id: messageId,
            ...update
        });
    }

    private sendToolChunkUpdate(messageId: string, contentDelta: string): void {
        this.callbacks.onMessage?.({
            type: 'toolChunkUpdate',
            id: messageId,
            contentDelta
        });
    }

    private sendAppendMessages(messages: Message[]): void {
        this.callbacks.onMessage?.({
            type: 'appendMessages',
            messages
        });
    }

    private sendUpdateMessage(id: string, content: any): void {
        this.callbacks.onMessage?.({
            type: 'updateMessage',
            id,
            content
        });
    }

    private handleTaskAgentStart(data: TaskAgentStartData): void {
        const userMessage: Message = {
            id: this.generateId(),
            type: 'user',
            content: data.prompt,
        };

        const taskMessage: Message = {
            id: this.generateId(),
            type: 'tool',
            toolName: 'Agent',
            content: {
                taskId: data.taskId,
                subagent_type: data.subagent_type,
                description: data.description,
                prompt: data.prompt,
                status: 'running',
                summary: data.prompt,
                taskMessages: [userMessage],
                run_in_background: data.run_in_background
            } as TaskMessageContent,
        };

        this.messageHistory.push(taskMessage);
        this.taskAgentMap.set(data.taskId, { idx: this.messageHistory.length - 1, msg: taskMessage });
        this.sendAppendMessages([taskMessage]);
    }

    private handleTaskAgentEnd(data: TaskAgentEndData): void {
        const entry = this.taskAgentMap.get(data.taskId);
        if (!entry || entry.msg.toolName !== 'Agent') {
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
        if (!entry || entry.msg.toolName !== 'Agent') {
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
     *
     * 工具显示格式：
     * - Glob、Grep → Search(${title})
     * - 其他 → ${toolName}(${title})
     */
    private generateTaskSummary(taskContent: TaskMessageContent): string {
        const toolMessages = taskContent.taskMessages.filter(m => m.type === 'tool');
        const toolCount = toolMessages.length;

        const formatToolDisplay = (m: Message): string => {
            const toolName = m.toolName || 'Unknown Tool';
            const title = m.content?.title || '';

            if (toolName === 'Glob' || toolName === 'Grep') {
                return `Search(${title})`;
            }
            return title ? `${toolName}(${title})` : toolName;
        };

        const recentTools = toolMessages.slice(-2);
        const toolTitles = recentTools.map(formatToolDisplay).join('\n');

        if (toolCount < 2) {
            return `${taskContent.prompt}\n${toolTitles}`;
        }
        return `${toolTitles}\nUsed ${toolCount} tools`;
    }

    public respondToToolPermission(response: ToolPermissionResponse): void {
        this.semaCore.respondToToolPermission(response);
    }

    public respondToAskQuestion(response: AskQuestionResponseData): void {
        this.semaCore.respondToAskQuestion(response);
    }

    public respondToPlanExit(response: PlanExitResponseData): void {
        this.semaCore.respondToPlanExit(response);
    }

    public updateMessageHistory(message: Message[]): void {
        this.messageHistory = message;
        this.sendContentUpdate();
    }

    public updateTitle(title: string): void {
        this.title = title;
    }

    public clearMessageHistory(): void {
        this.messageHistory = [];
        this.title = '';
        this.taskAgentMap.clear();
        this.streamingToolMap.clear();
        this.streamingAssistantMap.clear();
        this.pendingTaskUpdates.clear();
        if (this.taskAgentThrottleTimer) {
            clearTimeout(this.taskAgentThrottleTimer);
            this.taskAgentThrottleTimer = null;
        }
        this.sendContentUpdate();
    }

    public getMessageHistory(): any[] {
        return [...this.messageHistory];
    }

    // ===== 模型管理相关方法 =====

    public async addModel(config: ModelConfig, skipValidation?: boolean): Promise<ModelUpdateData> {
        const result = await this.semaCore.addModel(config, skipValidation);
        this.callbacks.onModelUpdate?.(result);
        return result;
    }

    public async deleteModel(modelName: string): Promise<ModelUpdateData> {
        const result = await this.semaCore.delModel(modelName);
        this.callbacks.onModelUpdate?.(result);
        return result;
    }

    public async switchModel(modelName: string): Promise<ModelUpdateData> {
        const result = await this.semaCore.switchModel(modelName);
        this.callbacks.onModelUpdate?.(result);
        return result;
    }

    public async applyTaskModel(config: TaskConfig): Promise<ModelUpdateData> {
        const result = await this.semaCore.applyTaskModel(config);
        this.callbacks.onModelUpdate?.(result);
        return result;
    }

    public async getModelData(): Promise<ModelUpdateData> {
        return await this.semaCore.getModelData();
    }

    // ===== 独立工具函数 =====

    public async fetchAvailableModels(params: FetchModelsParams): Promise<FetchModelsResult> {
        return await this.semaCore.fetchAvailableModels(params);
    }

    public async testApiConnection(params: ApiTestParams): Promise<ApiTestResult> {
        return await this.semaCore.testApiConnection(params);
    }

    public getModelAdapter(provider: string, modelName: string): string | undefined {
        return this.semaCore.getModelAdapter(provider, modelName);
    }

    // ===== 工具管理相关方法 =====

    public getToolInfos(): ToolInfo[] {
        const toolInfos = this.semaCore.getToolInfos();
        return toolInfos;
    }

    public async updateUseTools(toolNames: string[] | null): Promise<void> {
        await this.systemConfigManager.saveUseTools(toolNames);
        this.semaCore.updateUseTools(toolNames);
    }

    public getCurrentState(): 'idle' | 'processing' {
        return this.currentState;
    }

    public isReady(): boolean {
        return this.sessionReady;
    }

    public async waitForReady(timeout: number = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            if (this.isReady()) {
                resolve(true);
                return;
            }

            let timeoutId: NodeJS.Timeout;
            const readyHandler = () => {
                clearTimeout(timeoutId);
                this.semaCore.off('session:ready', readyHandler);
                resolve(true);
            };

            this.semaCore.on('session:ready', readyHandler);

            timeoutId = setTimeout(() => {
                this.semaCore.off('session:ready', readyHandler);
                resolve(false);
            }, timeout);
        });
    }

    public getSemaCore(): SemaCore {
        return this.semaCore;
    }

    public async updateSystemConfig(config: UpdatableCoreConfig): Promise<void> {
        await this.systemConfigManager.saveSystemConfig(config);
        this.semaCore.updateCoreConfig(config);
    }

    public async updateAgentMode(mode: 'Agent' | 'Plan'): Promise<void> {
        this.semaCore.updateAgentMode(mode);
    }

    public async updateSystemConfigByKey<K extends keyof UpdatableCoreConfig>(
        key: K,
        value: UpdatableCoreConfig[K]
    ): Promise<void> {
        await this.systemConfigManager.saveSystemConfigByKey(key, value);
        this.semaCore.updateCoreConfByKey(key, value);
    }

    public getSystemConfig(): UpdatableCoreConfig {
        return this.systemConfigManager.getSystemConfig();
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

    // ===== 插件市场管理相关方法 =====

    public async addMarketplaceFromGit(repo: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.addMarketplaceFromGit(repo);
    }

    public async addMarketplaceFromDirectory(dirPath: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.addMarketplaceFromDirectory(dirPath);
    }

    public async updateMarketplace(marketplaceName: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.updateMarketplace(marketplaceName);
    }

    public async removeMarketplace(marketplaceName: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.removeMarketplace(marketplaceName);
    }

    public async installPlugin(pluginName: string, marketplaceName: string, scope: PluginScope, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.installPlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public async uninstallPlugin(pluginName: string, marketplaceName: string, scope: PluginScope, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.uninstallPlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public async enablePlugin(pluginName: string, marketplaceName: string, scope: PluginScope, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.enablePlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public async disablePlugin(pluginName: string, marketplaceName: string, scope: PluginScope, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.disablePlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public async updatePlugin(pluginName: string, marketplaceName: string, scope: PluginScope, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.updatePlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public async refreshMarketplacePluginsInfo(): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.refreshMarketplacePluginsInfo();
    }

    public async getMarketplacePluginsInfo(): Promise<MarketplacePluginsInfo> {
        return await this.semaCore.getMarketplacePluginsInfo();
    }

    // ===== agent管理相关方法 =====

    public getAgentsInfo(): Promise<AgentConfig[]> {
        return this.semaCore.getAgentsInfo();
    }

    public refreshAgentsInfo(): Promise<AgentConfig[]> {
        return this.semaCore.refreshAgentsInfo();
    }

    public addAgentConf(agentConf: AgentConfig): Promise<AgentConfig[]> {
        return this.semaCore.addAgentConf(agentConf);
    }

    public removeAgentConf(name: string): Promise<AgentConfig[]> {
        return this.semaCore.removeAgentConf(name);
    }

    // ===== skill管理相关方法 =====

    public getSkillsInfo(): Promise<SkillConfig[]> {
        return this.semaCore.getSkillsInfo();
    }

    public refreshSkillsInfo(): Promise<SkillConfig[]> {
        return this.semaCore.refreshSkillsInfo();
    }

    public removeSkillConf(name: string): Promise<SkillConfig[]> {
        return this.semaCore.removeSkillConf(name);
    }

    // ===== command管理相关方法 =====

    public getCommandsInfo(): Promise<CommandConfig[]> {
        return this.semaCore.getCommandsInfo();
    }

    public refreshCommandsInfo(): Promise<CommandConfig[]> {
        return this.semaCore.refreshCommandsInfo();
    }

    public addCommandConf(commandConf: CommandConfig): Promise<CommandConfig[]> {
        return this.semaCore.addCommandConf(commandConf);
    }

    public removeCommandConf(name: string): Promise<CommandConfig[]> {
        return this.semaCore.removeCommandConf(name);
    }

    // ===== MCP 管理相关方法 =====

    public getMCPServerInfo(): Promise<MCPServerInfo[]> {
        return this.semaCore.getMCPServerInfo();
    }

    public refreshMCPServerInfo(): Promise<MCPServerInfo[]> {
        return this.semaCore.refreshMCPServerInfo();
    }

    public addMCPServer(mcpConfig: MCPServerConfig): Promise<MCPServerInfo[]> {
        return this.semaCore.addMCPServer(mcpConfig);
    }

    public removeMCPServer(name: string): Promise<MCPServerInfo[]> {
        return this.semaCore.removeMCPServer(name);
    }

    public reconnectMCPServer(name: string): Promise<MCPServerInfo[]> {
        return this.semaCore.reconnectMCPServer(name);
    }

    public disableMCPServer(name: string): Promise<MCPServerInfo[]> {
        return this.semaCore.disableMCPServer(name);
    }

    public enableMCPServer(name: string): Promise<MCPServerInfo[]> {
        return this.semaCore.enableMCPServer(name);
    }

    public updateMCPUseTools(name: string, toolNames: string[]): Promise<MCPServerInfo[]> {
        return this.semaCore.updateMCPUseTools(name, toolNames);
    }

    // ===== Task 管理相关方法 =====

    public watchTask(taskId: string, onDelta: (delta: string) => void): () => void {
        return this.semaCore.watchTask(taskId, onDelta);
    }

    public transferAgentToBackground(taskId: string): boolean {
        const result = this.semaCore.transferAgentToBackground(taskId);
        if (result) {
            const entry = this.taskAgentMap.get(taskId);
            if (entry) {
                const taskContent = entry.msg.content as TaskMessageContent;
                taskContent.run_in_background = true;
                this.sendUpdateMessage(entry.msg.id, taskContent);
            }
        }
        return result;
    }

    public stopTask(taskId: string): void {
        this.semaCore.stopTask(taskId);
    }

    public stopAllTasks(): number {
        return this.semaCore.stopAllTasks();
    }

    public openAgentDetail(taskId: string): void {
        this.callbacks.onOpenAgentDetail?.(taskId);
    }

    public getTaskList(): TaskListItem[] {
        return this.semaCore.getTaskList();
    }

    // ===== Mem 管理相关方法 =====

    public getMemoryInfo(): Promise<MemoryConfig | null> {
        return this.semaCore.getMemoryInfo();
    }

    public refreshMemoryInfo(): Promise<MemoryConfig | null> {
        return this.semaCore.refreshMemoryInfo();
    }

    // ===== Rule 管理相关方法 =====

    public getRuleInfo(): Promise<RuleConfig | null> {
        return this.semaCore.getRuleInfo();
    }

    public refreshRuleInfo(): Promise<RuleConfig | null> {
        return this.semaCore.refreshRuleInfo();
    }


    public dispose(): void {
        try {
            this.semaCore.dispose();
            this.clearMessageHistory();
            this.currentState = 'idle';
            this.sessionReady = false;
            this.currentSessionId = null;
            this.callbacks = {};
        } catch (error) {
            console.error('Error disposing SemaCoreWrapper:', error);
        }
    }
}
