import { SemaCore } from 'sema-core';
import {
    MessageCompleteData,
    StateUpdateData,
    ThinkingChunkData,
    TextChunkData,
    SessionReadyData,
    SessionErrorData,
    SessionInterruptedData,
    ToolPermissionRequestData,
    ToolPermissionResponse,
    ToolExecutionCompleteData,
    ToolExecutionErrorData,
    TodosUpdateData,
    TopicUpdateData,
    ConversationUsageData,
    CompactExecData,
    TaskAgentStartData,
    TaskAgentEndData,
    AskQuestionRequestData,
    AskQuestionResponseData,
    PlanExitRequestData,
    PlanExitResponseData,
    PlanImplementData,
    FileReferenceData,
    MCPServerStatusData,
    ToolExecutionChunkData,
    InputReceivedData,
    InputProcessingData
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
    MemoryConfig
} from 'sema-core/types';

import { SystemConfigManager } from '../managers/SystemConfigManager';


export interface SemaWrapperCallbacks {
    onSessionReady?: (data: SessionReadyData) => void;
    onModelUpdate?: (data: ModelUpdateData) => void;
    onStateChange?: (state: 'idle' | 'processing') => void;

    onMessage?: (message: any) => void;
    onMessageComplete?: () => void;
    onToolPermissionRequest?: (data: ToolPermissionRequestData) => void;
    onAskQuestionRequest?: (data: AskQuestionRequestData) => void;
    onPlanExitRequest?: (data: PlanExitRequestData) => void;
    onPlanImplement?: (data: PlanImplementData) => void;
    onUsageUpdate?: (data: ConversationUsageData) => void;
    onTodosUpdate?: (todos: TodosUpdateData) => void;
    onTopicUpdate?: (topic: TopicUpdateData) => void;
    onMCPServerStatus?: (data: MCPServerStatusData) => void;
    onInputReceived?: (data: InputReceivedData) => void;
    onInputProcessing?: (data: InputProcessingData) => void;
}

export interface Message {
    id: string;
    type: 'user' | 'assistant' | 'tool' | 'system' | 'permission_request';
    content: any;
    timestamp: number;
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
}

export class SemaCoreWrapper {
    private semaCore: SemaCore;
    private currentState: 'idle' | 'processing' = 'idle';
    private sessionReady: boolean = false;
    public currentSessionId: string | null = null;
    public title: string = '';
    private systemConfigManager: SystemConfigManager;

    public messageHistory: Array<Message> = [];
    private currentStreamingMessage: Message | null = null;
    private taskAgentMap: Map<string, Message> = new Map();
    private streamingToolMap: Map<string, Message> = new Map();

    constructor(workingDir: string, private callbacks: SemaWrapperCallbacks, systemConfigManager: SystemConfigManager) {
        this.systemConfigManager = systemConfigManager;

        const systemConfig = this.systemConfigManager.getSystemConfig();
        const useTools = this.systemConfigManager.getUseTools();

        const config: SemaCoreConfig = {
            workingDir,
            logLevel: 'warn',
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
        console.log('interruptSession()')
        if (this.currentState === 'processing') {
            this.semaCore.interruptSession();
        }
    }

    public async interruptAndWait(timeout: number = 2000): Promise<boolean> {
        if (this.currentState !== 'processing') {
            return true;
        }

        this.semaCore.interruptSession();

        const isIdle = await this.waitForIdle(timeout);
        if (!isIdle) {
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 300));
        return true;
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
    }

    private setupSessionListeners(): void {
        this.semaCore.on<SessionReadyData>('session:ready', (data) => {
            // console.log('session:ready', data)
            this.currentSessionId = data.sessionId;
            this.sessionReady = true;
            this.callbacks.onSessionReady?.(data);
        });

        this.semaCore.on<FileReferenceData>('file:reference', (data) => {
            if (data.references && data.references.length > 0) {
                this.messageHistory.push({
                    id: this.generateId(),
                    type: 'system',
                    content: {
                        type: 'file_reference',
                        content: data.references.map(ref => ref.content)
                    },
                    timestamp: Date.now()
                });
                this.sendContentUpdate();
            }
        });

        this.semaCore.on<SessionInterruptedData & { agentId?: string }>('session:interrupted', (data) => {
            console.log('session:interrupted', data)
            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, {
                    id: this.generateId(),
                    type: 'system',
                    content: { type: 'interrupted', content: data.content },
                    timestamp: Date.now()
                });
                return;
            }

            this.currentStreamingMessage = null;
            this.streamingToolMap.clear();

            if (this.messageHistory.length === 0) {
                return;
            }

            this.messageHistory.push({
                id: this.generateId(),
                type: 'system',
                content: { type: 'interrupted', content: data.content },
                timestamp: Date.now()
            });
            this.sendContentUpdate();
        });

        this.semaCore.on<SessionErrorData>('session:error', (data) => {
            console.error('Session error:', data);
            const errorMessage = data.error?.message || 'Unknown error';
            this.messageHistory.push({
                id: this.generateId(),
                type: 'system',
                content: {
                    type: 'session_error',
                    content: `Error: [${data.type}]${errorMessage}`,
                    errorType: data.type
                },
                timestamp: Date.now()
            });
            this.sendContentUpdate();
        });

        this.semaCore.on<{ sessionId: string | null }>('session:cleared', (_data) => {
            this.clearMessageHistory();
            this.title = '新会话';
            this.messageHistory.push({
                id: this.generateId(),
                type: 'user',
                content: '/clear',
                timestamp: Date.now()
            });
            this.messageHistory.push({
                id: this.generateId(),
                type: 'system',
                content: { type: 'clear', content: '(no content)' },
                timestamp: Date.now()
            });
            this.sendContentUpdate();
            this.callbacks.onMessageComplete?.();
        });
    }

    private setupInputListeners(): void {
        this.semaCore.on<InputReceivedData>('input:received', (data) => {
            console.log('input:received', data)
            this.callbacks.onInputReceived?.(data);
        });

        this.semaCore.on<InputProcessingData>('input:processing', (data) => {
            console.log('input:processing', data)
            const content = data.originalInput || data.input;

            const hasUserMessages = this.messageHistory.some(m => m.type === 'user');
            if (!hasUserMessages) {
                let title = content.trim();
                if (title.length > 50) {
                    title = title.substring(0, 50) + '...';
                }
                this.title = title || '新对话';
            }

            this.messageHistory.push({
                id: this.generateId(),
                type: 'user',
                content: content,
                timestamp: Date.now()
            });
            this.sendContentUpdate();
            this.callbacks.onInputProcessing?.(data);
        });
    }

    private setupMessageListeners(): void {
        this.semaCore.on<StateUpdateData>('state:update', (data) => {
            console.log('state:update', data)
            this.currentState = data.state;
            this.callbacks.onStateChange?.(data.state);
        });

        this.semaCore.on<ThinkingChunkData>('message:thinking:chunk', (data) => {
            if (this.currentStreamingMessage && this.currentStreamingMessage.type === 'assistant') {
                this.currentStreamingMessage.reasoning = data.content;
                return;
            }

            const newMessage: Message = {
                id: this.generateId(),
                type: 'assistant',
                content: { messageType: 'text', content: '', completed: false },
                reasoning: data.content,
                timestamp: Date.now()
            };
            this.currentStreamingMessage = newMessage;
            this.messageHistory.push(newMessage);
            this.sendContentUpdate();
        });

        this.semaCore.on<TextChunkData>('message:text:chunk', (data) => {
            if (this.currentStreamingMessage && this.currentStreamingMessage.type === 'assistant') {
                this.currentStreamingMessage.content = {
                    messageType: 'text',
                    content: data.content,
                    completed: false
                };
                this.sendContentUpdate();
                return;
            }

            const newMessage: Message = {
                id: this.generateId(),
                type: 'assistant',
                content: { messageType: 'text', content: data.content, completed: false },
                timestamp: Date.now()
            };
            this.currentStreamingMessage = newMessage;
            this.messageHistory.push(newMessage);
            this.sendContentUpdate();
        });

        this.semaCore.on<MessageCompleteData & { agentId?: string }>('message:complete', (data) => {
            if (!data.content && !data.reasoning && !data.hasToolCalls) {
                this.currentStreamingMessage = null;
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
                    timestamp: Date.now()
                });
                return;
            }

            let messageUpdated = false;

            if (this.currentStreamingMessage && this.currentStreamingMessage.type === 'assistant') {
                const message = this.currentStreamingMessage;
                if (data.content) {
                    message.content = {
                        messageType: message.content.messageType || 'text',
                        content: data.content,
                        completed: true,
                        hasToolCalls: data.hasToolCalls,
                    };
                } else {
                    message.content.completed = true;
                    message.content.hasToolCalls = data.hasToolCalls;
                }
                if (data.reasoning) {
                    message.reasoning = data.reasoning;
                }
                messageUpdated = true;
            }

            if (!messageUpdated) {
                console.warn('No streaming message found, creating new complete message');
                const newMessage: Message = {
                    id: this.generateId(),
                    type: 'assistant',
                    content: {
                        messageType: 'text',
                        content: data.content,
                        completed: true,
                        hasToolCalls: data.hasToolCalls,
                    },
                    timestamp: Date.now()
                };
                if (data.reasoning) {
                    newMessage.reasoning = data.reasoning;
                }
                this.messageHistory.push(newMessage);
                messageUpdated = true;
            }

            this.currentStreamingMessage = null;

            if (messageUpdated) {
                this.sendContentUpdate();
                this.callbacks.onMessageComplete?.();
            }
        });
    }

    private setupToolListeners(): void {
        this.semaCore.on<ToolPermissionRequestData>('tool:permission:request', (data) => {
            this.callbacks.onToolPermissionRequest?.(data);
        });

        this.semaCore.on<ToolExecutionChunkData & { agentId?: string }>('tool:execution:chunk', (data) => {
            if (this.isSubAgent(data.agentId)) {
                return;
            }

            const toolId = data.toolId;
            if (toolId && this.streamingToolMap.has(toolId)) {
                const existingMessage = this.streamingToolMap.get(toolId)!;
                existingMessage.content = { ...data, completed: false };
            } else {
                const newMessage: Message = {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: false },
                    toolName: data.toolName,
                    timestamp: Date.now()
                };
                this.messageHistory.push(newMessage);
                if (toolId) {
                    this.streamingToolMap.set(toolId, newMessage);
                }
            }
            this.sendContentUpdate();
        });

        this.semaCore.on<ToolExecutionCompleteData & { agentId?: string }>('tool:execution:complete', (data) => {
            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, {
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: true },
                    toolName: data.toolName,
                    timestamp: Date.now()
                });
                return;
            }

            if (data.toolName === 'Task') {
                return;
            }

            const toolId = data.toolId;
            if (toolId && this.streamingToolMap.has(toolId)) {
                const existingMessage = this.streamingToolMap.get(toolId)!;
                existingMessage.content = { ...data, completed: true };
                this.streamingToolMap.delete(toolId);
            } else {
                this.messageHistory.push({
                    id: this.generateId(),
                    type: 'tool',
                    content: { ...data, completed: true },
                    toolName: data.toolName,
                    timestamp: Date.now()
                });
            }
            this.sendContentUpdate();
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
                timestamp: Date.now()
            };

            if (this.isSubAgent(data.agentId)) {
                this.addMessageToTaskAgent(data.agentId!, errorMessage);
                return;
            }

            this.messageHistory.push(errorMessage);
            this.sendContentUpdate();
        });
    }

    private setupMetaListeners(): void {
        this.semaCore.on<TodosUpdateData>('todos:update', (data) => {
            this.callbacks.onTodosUpdate?.(data);
        });

        this.semaCore.on<TopicUpdateData>('topic:update', (data) => {
            if (data.title && data.title.trim() && this.title !== data.title) {
                this.title = data.title;
                this.callbacks.onTopicUpdate?.(data);
            }
        });

        this.semaCore.on<ConversationUsageData>('conversation:usage', (data) => {
            this.callbacks.onUsageUpdate?.(data);
        });

        this.semaCore.on<CompactExecData>('compact:exec', (data) => {
            const finalContent = (data.errMsg && data.errMsg.trim() !== '')
                ? `Compacted: ${data.errMsg}`
                : `Compacted`;

            this.messageHistory.push({
                id: this.generateId(),
                type: 'system',
                content: { type: 'compact', content: finalContent },
                timestamp: Date.now()
            });
            this.sendContentUpdate();
        });

        this.semaCore.on<AskQuestionRequestData>('ask:question:request', (data) => {
            this.callbacks.onAskQuestionRequest?.(data);
        });

        this.semaCore.on<PlanExitRequestData>('plan:exit:request', (data) => {
            this.callbacks.onPlanExitRequest?.(data);
        });

        this.semaCore.on<PlanImplementData>('plan:implement', (data) => {
            this.messageHistory.push({
                id: this.generateId(),
                type: 'system',
                content: {
                    type: 'plan_implement',
                    planFilePath: data.planFilePath,
                    planContent: data.planContent
                },
                timestamp: Date.now()
            });
            this.sendContentUpdate();
        });

        this.semaCore.on<MCPServerStatusData>('mcp:server:status', (data) => {
            this.callbacks.onMCPServerStatus?.(data);
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

    private handleTaskAgentStart(data: TaskAgentStartData): void {
        const userMessage: Message = {
            id: this.generateId(),
            type: 'user',
            content: data.prompt,
            timestamp: Date.now()
        };

        const taskMessage: Message = {
            id: this.generateId(),
            type: 'tool',
            toolName: 'Task',
            content: {
                taskId: data.taskId,
                subagent_type: data.subagent_type,
                description: data.description,
                prompt: data.prompt,
                status: 'running',
                summary: data.prompt,
                taskMessages: [userMessage]
            } as TaskMessageContent,
            timestamp: Date.now()
        };

        this.messageHistory.push(taskMessage);
        this.taskAgentMap.set(data.taskId, taskMessage);
        this.sendContentUpdate();
    }

    private handleTaskAgentEnd(data: TaskAgentEndData): void {
        const taskMessage = this.taskAgentMap.get(data.taskId);
        if (!taskMessage || taskMessage.toolName !== 'Task') {
            console.warn(`Task agent end: taskId ${data.taskId} not found`);
            return;
        }

        const taskContent = taskMessage.content as TaskMessageContent;
        taskContent.status = data.status;
        taskContent.summary = data.content;

        this.sendContentUpdate();
    }

    private addMessageToTaskAgent(taskId: string, message: Message): void {
        const taskMessage = this.taskAgentMap.get(taskId);
        if (!taskMessage || taskMessage.toolName !== 'Task') {
            console.warn(`addMessageToTaskAgent: taskId ${taskId} not found`);
            return;
        }

        const taskContent = taskMessage.content as TaskMessageContent;
        taskContent.taskMessages.push(message);
        taskContent.summary = this.generateTaskSummary(taskContent);

        this.sendContentUpdate();
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
        this.currentStreamingMessage = null;
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

    public waitForIdle(timeout: number = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            if (this.currentState === 'idle') {
                resolve(true);
                return;
            }

            let timeoutId: NodeJS.Timeout;

            const stateHandler = (data: { state: 'idle' | 'processing' }) => {
                if (data.state === 'idle') {
                    clearTimeout(timeoutId);
                    this.semaCore.off('state:update', stateHandler);
                    resolve(true);
                }
            };

            this.semaCore.on('state:update', stateHandler);

            timeoutId = setTimeout(() => {
                this.semaCore.off('state:update', stateHandler);
                resolve(false);
            }, timeout);
        });
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

    // ===== 事件管理方法 =====

    public on<T>(event: string, listener: (data: T) => void): this {
        this.semaCore.on(event, listener);
        return this;
    }

    public once<T>(event: string, listener: (data: T) => void): this {
        this.semaCore.once(event, listener);
        return this;
    }

    public off<T>(event: string, listener: (data: T) => void): this {
        this.semaCore.off(event, listener);
        return this;
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
            timestamp: Date.now()
        };

        if (this.isSubAgent(permissionData.agentId)) {
            this.addMessageToTaskAgent(permissionData.agentId, message);
            return;
        }

        this.messageHistory.push(message);
        this.sendContentUpdate();
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

    // ===== Mem 管理相关方法 =====

    public getMemoryInfo(): Promise<MemoryConfig | null> {
        return this.semaCore.getMemoryInfo();
    }

    public refreshMemoryInfo(): Promise<MemoryConfig | null> {
        return this.semaCore.refreshMemoryInfo();
    }


    public dispose(): void {
        try {
            this.semaCore.dispose();

            this.messageHistory = [];
            this.currentState = 'idle';
            this.sessionReady = false;
            this.currentSessionId = null;
            this.currentStreamingMessage = null;
            this.title = '';
            this.taskAgentMap.clear();
            this.streamingToolMap.clear();
            this.callbacks = {};
        } catch (error) {
            console.error('Error disposing SemaCoreWrapper:', error);
        }
    }
}
