import type { Transport } from './transport';

type Handler = (data: any) => void;

/**
 * 远程 SemaSession 代理：实现 SemaSessionWrapper 所需的接口。
 * 方法调用 → gRPC 命令；事件由 Transport 按 sessionId 灌入（emit）。
 * 与「VSCode 里 wrapper 拿进程内 SemaSession」等价，只是这里隔着 gRPC。
 */
export class RemoteSession {
    private handlers = new Map<string, Set<Handler>>();

    constructor(public readonly sessionId: string, private t: Transport) {}

    on<T = any>(event: string, cb: (data: T) => void): void {
        let set = this.handlers.get(event);
        if (!set) { set = new Set(); this.handlers.set(event, set); }
        set.add(cb as Handler);
    }

    off<T = any>(event: string, cb: (data: T) => void): void {
        this.handlers.get(event)?.delete(cb as Handler);
    }

    /** Transport 派发原始 sema-core 事件到此会话。 */
    emit(event: string, data: any): void {
        const set = this.handlers.get(event);
        if (set) for (const cb of Array.from(set)) cb(data);
    }

    // ── 会话方法（走 gRPC，action 名 = sema-core 方法名）──
    processUserInput(content: string, orgContent?: string, attachments?: any): void {
        void this.t.call('processUserInput', { content, orgContent, attachments }, this.sessionId);
    }
    interrupt(): void { void this.t.call('interrupt', undefined, this.sessionId); }
    respondToToolPermission(r: any): void { void this.t.call('respondToToolPermission', r, this.sessionId); }
    respondToPickOption(r: any): void { void this.t.call('respondToPickOption', r, this.sessionId); }
    respondToPlanExit(r: any): void { void this.t.call('respondToPlanExit', r, this.sessionId); }
    updateAgentMode(mode: any): void { void this.t.call('updateAgentMode', { mode }, this.sessionId); }
    updatePermissionLevel(level: any): void { void this.t.call('updatePermissionLevel', { level }, this.sessionId); }

    // ── 会话级任务/fork 能力（走 gRPC；异步返回，调用方需 await）──
    // fork/撤销回退（D1）：同步语义在过界后变异步往返（A1），调用方 await。
    getForkPreview(messageUuid: string): Promise<any> { return this.t.call('getForkPreview', { messageUuid }, this.sessionId); }
    fork(messageUuid: string, options?: any): Promise<any> { return this.t.call('fork', { messageUuid, options }, this.sessionId); }
    // Stop 时停后台子 agent（D3）；fire-and-forget（对齐 VSCode 丢弃返回值）。
    stopAllTasks(): Promise<number> { return this.t.call('stopAllTasks', undefined, this.sessionId); }
    // 子 agent 转后台（D4，会话级）。
    transferAgentToBackground(taskId: string): Promise<{ ok: boolean }> { return this.t.call('transferAgentToBackground', { taskId }, this.sessionId); }
}

/** 远程 SemaCore 代理。 */
export class RemoteCore {
    constructor(private t: Transport) {}

    init(config: any = {}): Promise<any> { return this.t.call('init', config, ''); }
    getModelData(): Promise<any> { return this.t.call('getModelData', undefined, ''); }
    switchModel(modelName: string): Promise<any> { return this.t.call('switchModel', { modelName }, ''); }
    closeSession(sessionId: string): void { void this.t.call('closeSession', undefined, sessionId); }

    async createSession(opts: { sessionId?: string; permissionLevel?: any; mode?: any } = {}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
        try {
            // 建会话即透传 per-session 档位/模式（D7）；仅在有值时带上。
            const payload: Record<string, any> = { sessionId: opts.sessionId };
            if (opts.permissionLevel) payload.permissionLevel = opts.permissionLevel;
            if (opts.mode) payload.mode = opts.mode;
            const data = await this.t.call('createSession', payload, '');
            return { ok: true, sessionId: data?.sessionId };
        } catch (e: any) {
            return { ok: false, error: e?.message || '创建会话失败' };
        }
    }

    // ── 配置页 Core 能力（走 gRPC，action 名 = sema-core 方法名；payload 契约对齐 server.ts）──
    // 返回值即 sema-core 原始返回，翻译成 UI 出站 command 由 config-controller 负责。

    // Model
    addModel(config: any, skipValidation?: boolean): Promise<any> { return this.t.call('addModel', { config, skipValidation }, ''); }
    delModel(modelName: string): Promise<any> { return this.t.call('delModel', { modelName }, ''); }
    applyTaskModel(config: any): Promise<any> { return this.t.call('applyTaskModel', config, ''); }
    fetchAvailableModels(params: any): Promise<any> { return this.t.call('fetchAvailableModels', params, ''); }
    testApiConnection(params: any): Promise<any> { return this.t.call('testApiConnection', params, ''); }
    getModelAdapter(provider: string, modelName: string, baseURL: string): Promise<any> { return this.t.call('getModelAdapter', { provider, modelName, baseURL }, ''); }

    // 工具 / 系统配置推 core
    getToolInfos(): Promise<any> { return this.t.call('getToolInfos', undefined, ''); }
    updateDisabledTools(disabledTools: string[] | null): Promise<any> { return this.t.call('updateDisabledTools', { disabledTools }, ''); }
    updateCoreConfig(config: any): Promise<any> { return this.t.call('updateCoreConfig', config, ''); }
    updateCoreConfByKey(key: string, value: any): Promise<any> { return this.t.call('updateCoreConfByKey', { key, value }, ''); }

    // 插件市场 / Plugins
    getMarketplacePluginsInfo(): Promise<any> { return this.t.call('getMarketplacePluginsInfo', undefined, ''); }
    refreshMarketplacePluginsInfo(): Promise<any> { return this.t.call('refreshMarketplacePluginsInfo', undefined, ''); }
    addMarketplaceFromGit(repo: string): Promise<any> { return this.t.call('addMarketplaceFromGit', { repo }, ''); }
    addMarketplaceFromDirectory(dirPath: string): Promise<any> { return this.t.call('addMarketplaceFromDirectory', { dirPath }, ''); }
    updateMarketplace(marketplaceName: string): Promise<any> { return this.t.call('updateMarketplace', { marketplaceName }, ''); }
    removeMarketplace(marketplaceName: string): Promise<any> { return this.t.call('removeMarketplace', { marketplaceName }, ''); }
    installPlugin(pluginName: string, marketplaceName: string, scope: string, projectPath?: string): Promise<any> { return this.t.call('installPlugin', { pluginName, marketplaceName, scope, projectPath }, ''); }
    uninstallPlugin(pluginName: string, marketplaceName: string, scope: string, projectPath?: string): Promise<any> { return this.t.call('uninstallPlugin', { pluginName, marketplaceName, scope, projectPath }, ''); }
    enablePlugin(pluginName: string, marketplaceName: string, scope: string, projectPath?: string): Promise<any> { return this.t.call('enablePlugin', { pluginName, marketplaceName, scope, projectPath }, ''); }
    disablePlugin(pluginName: string, marketplaceName: string, scope: string, projectPath?: string): Promise<any> { return this.t.call('disablePlugin', { pluginName, marketplaceName, scope, projectPath }, ''); }
    updatePlugin(pluginName: string, marketplaceName: string, scope: string, projectPath?: string): Promise<any> { return this.t.call('updatePlugin', { pluginName, marketplaceName, scope, projectPath }, ''); }

    // Agents
    getAgentsInfo(refresh?: boolean): Promise<any> { return this.t.call('getAgentsInfo', { refresh }, ''); }
    addAgentConf(agentConf: any): Promise<any> { return this.t.call('addAgentConf', agentConf, ''); }
    removeAgentConf(name: string): Promise<any> { return this.t.call('removeAgentConf', { name }, ''); }

    // Skills
    getSkillsInfo(refresh?: boolean): Promise<any> { return this.t.call('getSkillsInfo', { refresh }, ''); }
    removeSkillConf(name: string): Promise<any> { return this.t.call('removeSkillConf', { name }, ''); }

    // Commands
    getCommandsInfo(refresh?: boolean): Promise<any> { return this.t.call('getCommandsInfo', { refresh }, ''); }
    addCommandConf(commandConf: any): Promise<any> { return this.t.call('addCommandConf', commandConf, ''); }
    removeCommandConf(name: string): Promise<any> { return this.t.call('removeCommandConf', { name }, ''); }

    // MCP
    getMCPServerInfo(): Promise<any> { return this.t.call('getMCPServerInfo', undefined, ''); }
    refreshMCPServerInfo(): Promise<any> { return this.t.call('refreshMCPServerInfo', undefined, ''); }
    addMCPServer(mcpConfig: any): Promise<any> { return this.t.call('addMCPServer', mcpConfig, ''); }
    removeMCPServer(name: string): Promise<any> { return this.t.call('removeMCPServer', { name }, ''); }
    reconnectMCPServer(name: string): Promise<any> { return this.t.call('reconnectMCPServer', { name }, ''); }
    disableMCPServer(name: string): Promise<any> { return this.t.call('disableMCPServer', { name }, ''); }
    enableMCPServer(name: string): Promise<any> { return this.t.call('enableMCPServer', { name }, ''); }
    updateMCPUseTools(name: string, toolNames: string[]): Promise<any> { return this.t.call('updateMCPUseTools', { name, toolNames }, ''); }

    // Cron
    getCronTasks(): Promise<any> { return this.t.call('getCronTasks', undefined, ''); }
    deleteCronTask(id: string): Promise<any> { return this.t.call('deleteCronTask', { id }, ''); }
    enableCronTask(id: string): Promise<any> { return this.t.call('enableCronTask', { id }, ''); }
    disableCronTask(id: string): Promise<any> { return this.t.call('disableCronTask', { id }, ''); }

    // 后台任务面板（进程级，跨会话聚合；D4）。watchTask 流式：不再传回调，
    // 起停由 watch/unwatch 控制，实际 delta 走进程级事件 task:watch:delta 上行。
    getTaskList(): Promise<any[]> { return this.t.call('getTaskList', undefined, ''); }
    stopTask(taskId: string): Promise<any> { return this.t.call('stopTask', { taskId }, ''); }
    watchTask(taskId: string): Promise<any> { return this.t.call('watchTask', { taskId }, ''); }
    unwatchTask(taskId: string): Promise<any> { return this.t.call('unwatchTask', { taskId }, ''); }

    // Memory / Rule / Design
    getMemoryInfo(refresh?: boolean): Promise<any> { return this.t.call('getMemoryInfo', { refresh }, ''); }
    getRuleInfo(refresh?: boolean): Promise<any> { return this.t.call('getRuleInfo', { refresh }, ''); }
    getDesignSkillsInfo(refresh?: boolean): Promise<any> { return this.t.call('getDesignSkillsInfo', { refresh }, ''); }
    getDesignSystemsInfo(refresh?: boolean): Promise<any> { return this.t.call('getDesignSystemsInfo', { refresh }, ''); }
}
