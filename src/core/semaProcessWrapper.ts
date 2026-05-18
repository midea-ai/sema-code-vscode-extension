import { SemaCore, SemaSession } from 'sema-core';
import {
    CreateSessionOptions,
    CreateSessionResult,
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
    MarketplacePluginsInfo,
    PluginScopeKind,
    AgentConfig,
    SkillConfig,
    CommandConfig,
    MCPServerConfig,
    MCPServerInfo,
    MemoryConfig,
    RuleConfig,
    TaskListItem,
    CronTask
} from 'sema-core/types';

import { SystemConfigManager } from '../managers/SystemConfigManager';

/** 进程级事件类型（与 sema-core 的 ProcessEvent 对齐） */
export type ProcessEventName = 'cron:update' | 'mcp:server:status';

/** UI 层支持同时打开的会话数量上限 */
export const MAX_SESSIONS = 5;

export interface ProcessWrapperCallbacks {
    /** 模型配置变化（addModel / switchModel 等触发） */
    onModelUpdate?: (data: ModelUpdateData) => void;
    /** 配置页任务面板请求查看子代理详情 */
    onOpenAgentDetail?: (taskId: string) => void;
}

/**
 * SemaProcessWrapper —— 进程级 wrapper
 * 持有唯一的 SemaCore 实例，负责会话池管理与全局配置（模型 / MCP / 插件 / agents / cron 等）。
 * 单个会话的交互见 SemaSessionWrapper。
 */
export class SemaProcessWrapper {
    private semaCore: SemaCore;
    private systemConfigManager: SystemConfigManager;

    constructor(
        workingDir: string,
        systemConfigManager: SystemConfigManager,
        private callbacks: ProcessWrapperCallbacks = {}
    ) {
        this.systemConfigManager = systemConfigManager;

        const systemConfig = this.systemConfigManager.getSystemConfig();
        const disabledTools = this.systemConfigManager.getDisabledTools();

        const config: SemaCoreConfig = {
            workingDir,
            logLevel: 'error',
            ...systemConfig,
            disabledTools: disabledTools,
            maxSessions: MAX_SESSIONS,
        };

        this.semaCore = new SemaCore(config);
    }

    // ===== 会话池 =====

    public createSession(opts: CreateSessionOptions = {}): Promise<CreateSessionResult> {
        return this.semaCore.createSession(opts);
    }

    public getSession(sessionId: string): SemaSession | undefined {
        return this.semaCore.getSession(sessionId);
    }

    public listSessions(): string[] {
        return this.semaCore.listSessions();
    }

    public setActiveSession(sessionId: string): boolean {
        return this.semaCore.setActiveSession(sessionId);
    }

    public closeSession(sessionId: string): boolean {
        return this.semaCore.closeSession(sessionId);
    }

    // ===== 进程级事件（MCP / Cron）=====

    public onProcessEvent<T>(event: ProcessEventName, listener: (data: T) => void): void {
        this.semaCore.on<T>(event, listener);
    }

    public offProcessEvent<T>(event: ProcessEventName, listener: (data: T) => void): void {
        this.semaCore.off<T>(event, listener);
    }

    public getSemaCore(): SemaCore {
        return this.semaCore;
    }

    /** 进程级初始化兜底（配置加载是异步的，这里只做占位等待） */
    public async waitForReady(_timeout: number = 5000): Promise<boolean> {
        return true;
    }

    // ===== 模型管理 =====

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

    public getModelData(): Promise<ModelUpdateData> {
        return this.semaCore.getModelData();
    }

    public fetchAvailableModels(params: FetchModelsParams): Promise<FetchModelsResult> {
        return this.semaCore.fetchAvailableModels(params);
    }

    public testApiConnection(params: ApiTestParams): Promise<ApiTestResult> {
        return this.semaCore.testApiConnection(params);
    }

    public getModelAdapter(provider: string, modelName: string, baseURL: string): string | undefined {
        return this.semaCore.getModelAdapter(provider, modelName, baseURL);
    }

    // ===== 工具管理 =====

    public getToolInfos(): ToolInfo[] {
        return this.semaCore.getToolInfos();
    }

    public async updateDisabledTools(disabledTools: string[] | null): Promise<void> {
        await this.systemConfigManager.saveDisabledTools(disabledTools);
        this.semaCore.updateDisabledTools(disabledTools);
    }

    // ===== 系统配置 =====

    public async updateSystemConfig(config: UpdatableCoreConfig): Promise<void> {
        await this.systemConfigManager.saveSystemConfig(config);
        this.semaCore.updateCoreConfig(config);
    }

    public async updateSystemConfigByKey<K extends keyof UpdatableCoreConfig>(
        key: K,
        value: UpdatableCoreConfig[K]
    ): Promise<void> {
        await this.systemConfigManager.saveSystemConfigByKey(key, value);
        this.semaCore.updateCoreConfByKey(key, value);
    }

    /** 保存扩展端本地副作用字段（如 enablePet），仅落 globalState，不推 sema-core */
    public async saveLocalSystemConfigByKey(key: string, value: any): Promise<void> {
        await this.systemConfigManager.saveSystemConfigByKeyRaw(key, value);
    }

    public getSystemConfig(): UpdatableCoreConfig {
        return this.systemConfigManager.getSystemConfig();
    }

    // ===== 插件市场管理 =====

    public addMarketplaceFromGit(repo: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.addMarketplaceFromGit(repo);
    }

    public addMarketplaceFromDirectory(dirPath: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.addMarketplaceFromDirectory(dirPath);
    }

    public updateMarketplace(marketplaceName: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.updateMarketplace(marketplaceName);
    }

    public removeMarketplace(marketplaceName: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.removeMarketplace(marketplaceName);
    }

    public installPlugin(pluginName: string, marketplaceName: string, scope: PluginScopeKind, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.installPlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public uninstallPlugin(pluginName: string, marketplaceName: string, scope: PluginScopeKind, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.uninstallPlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public enablePlugin(pluginName: string, marketplaceName: string, scope: PluginScopeKind, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.enablePlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public disablePlugin(pluginName: string, marketplaceName: string, scope: PluginScopeKind, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.disablePlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public updatePlugin(pluginName: string, marketplaceName: string, scope: PluginScopeKind, projectPath?: string): Promise<MarketplacePluginsInfo> {
        return this.semaCore.updatePlugin(pluginName, marketplaceName, scope, projectPath);
    }

    public refreshMarketplacePluginsInfo(): Promise<MarketplacePluginsInfo> {
        return this.semaCore.refreshMarketplacePluginsInfo();
    }

    public getMarketplacePluginsInfo(): Promise<MarketplacePluginsInfo> {
        return this.semaCore.getMarketplacePluginsInfo();
    }

    // ===== Agent 管理 =====

    public getAgentsInfo(refresh?: boolean): Promise<AgentConfig[]> {
        return this.semaCore.getAgentsInfo(true, refresh);
    }

    public addAgentConf(agentConf: AgentConfig): Promise<AgentConfig[]> {
        return this.semaCore.addAgentConf(agentConf);
    }

    public removeAgentConf(name: string): Promise<AgentConfig[]> {
        return this.semaCore.removeAgentConf(name);
    }

    // ===== Skill 管理 =====

    public getSkillsInfo(refresh?: boolean): Promise<SkillConfig[]> {
        return this.semaCore.getSkillsInfo(true, refresh);
    }

    public removeSkillConf(name: string): Promise<SkillConfig[]> {
        return this.semaCore.removeSkillConf(name);
    }

    // ===== Design 资源 =====

    public getDesignSkillsInfo(refresh?: boolean) {
        return this.semaCore.getDesignSkillsInfo(refresh);
    }

    public getDesignSystemsInfo(refresh?: boolean) {
        return this.semaCore.getDesignSystemsInfo(refresh);
    }

    // ===== Command 管理 =====

    public getCommandsInfo(refresh?: boolean): Promise<CommandConfig[]> {
        return this.semaCore.getCommandsInfo(true, refresh);
    }

    public addCommandConf(commandConf: CommandConfig): Promise<CommandConfig[]> {
        return this.semaCore.addCommandConf(commandConf);
    }

    public removeCommandConf(name: string): Promise<CommandConfig[]> {
        return this.semaCore.removeCommandConf(name);
    }

    // ===== MCP 管理 =====

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

    // ===== Memory / Rule =====

    public getMemoryInfo(refresh?: boolean): Promise<MemoryConfig | null> {
        return this.semaCore.getMemoryInfo(refresh);
    }

    public getRuleInfo(refresh?: boolean): Promise<RuleConfig | null> {
        return this.semaCore.getRuleInfo(refresh);
    }

    // ===== Cron 定时任务（全局）=====

    public getCronTasks(): Promise<CronTask[]> {
        return this.semaCore.getCronTasks();
    }

    public deleteCronTask(id: string): boolean {
        return this.semaCore.deleteCronTask(id);
    }

    public enableCronTask(id: string): boolean {
        return this.semaCore.enableCronTask(id);
    }

    public disableCronTask(id: string): boolean {
        return this.semaCore.disableCronTask(id);
    }

    // ===== 后台任务（跨会话聚合，供配置页任务面板使用）=====

    /** 聚合所有会话的后台任务列表 */
    public getTaskList(): TaskListItem[] {
        const all: TaskListItem[] = [];
        for (const sessionId of this.semaCore.listSessions()) {
            const session = this.semaCore.getSession(sessionId);
            if (session) all.push(...session.getTaskList());
        }
        return all;
    }

    /** watchTask / stopTask 基于 taskId 全局生效，借任意会话转发即可 */
    private anySession(): SemaSession | undefined {
        const ids = this.semaCore.listSessions();
        return ids.length > 0 ? this.semaCore.getSession(ids[0]) : undefined;
    }

    public watchTask(taskId: string, onDelta: (delta: string) => void): () => void {
        const session = this.anySession();
        return session ? session.watchTask(taskId, onDelta) : () => { };
    }

    public stopTask(taskId: string): void {
        this.anySession()?.stopTask(taskId);
    }

    /** 配置页任务面板：查看子代理详情 */
    public openAgentDetail(taskId: string): void {
        this.callbacks.onOpenAgentDetail?.(taskId);
    }

    // ===== 资源释放 =====

    public async dispose(): Promise<void> {
        try {
            await this.semaCore.dispose();
        } catch (error) {
            console.error('Error disposing SemaProcessWrapper:', error);
        }
    }
}
