import type { Transport } from '../../chat/jb/transport';
import { RemoteCore } from '../../chat/jb/remote';
import { defaultConfig } from '../default/defaultConfig';

/**
 * 配置页控制器（JB 版）—— 1:1 复刻 VSCode 端 ConfigWebviewProvider 的 handler → 出站 command 映射，
 * 只是数据源从进程内 coreManager 换成走 gRPC 的 RemoteCore（透明桥）与 Kotlin 本地存储（systemConfig channel）。
 *
 * 分层：
 * - A 类（纯 sema-core 方法）→ RemoteCore（gRPC），返回原始值后翻译成 UI 出站 command。
 * - System Config / disabledTools 的本地持久化 → Kotlin（t.callEditor('systemConfig'...)），core 推送仍在此走 RemoteCore。
 * - openFile / openExternal → 复用聊天已通的编辑器 channel。
 * - Claw / Skill Hub 在线安装 / 后台任务面板 → 后置，优雅降级避免 UI 卡住。
 */

// 仅落宿主本地、不推 sema-core 的系统配置键（对齐 semaProcessWrapper.LOCAL_SYSTEM_CONFIG_KEYS）
const LOCAL_SYSTEM_CONFIG_KEYS = ['enablePet', 'showThinkingText'];

export class ConfigController {
    private core: RemoteCore;
    private initialized = false;

    constructor(private t: Transport, private postToApp: (msg: any) => void) {
        this.core = new RemoteCore(t);
        // 进程级事件（session_id 空）：cron:update / mcp:server:status → 翻成配置页出站 command
        t.setEventHandler((event, data, sessionId) => {
            if (sessionId) return; // 会话级事件与配置页无关
            if (event === 'mcp:server:status') this.postToApp({ command: 'mcpServerStatusUpdate', data });
            else if (event === 'cron:update') this.postToApp({ command: 'cronUpdate' });
        });
        t.setAppMessageHandler((m) => this.postToApp(m));
    }

    private async ensureInit(): Promise<void> {
        if (this.initialized) return;
        await this.core.init({});
        this.initialized = true;
    }

    private toCoreSystemConfig(config: Record<string, any>): Record<string, any> {
        const c = { ...config };
        for (const k of LOCAL_SYSTEM_CONFIG_KEYS) delete c[k];
        return c;
    }

    /** 统一：ensureInit → 调 core → 成功/失败都按给定 command 回灌（data 缺省值可配）。 */
    private async respond(command: string, fn: () => Promise<any>, shape: (data: any) => any, failData: any = []): Promise<void> {
        try {
            await this.ensureInit();
            const data = await fn();
            this.postToApp({ command, success: true, ...shape(data) });
        } catch (e: any) {
            this.postToApp({ command, success: false, data: failData, message: e?.message || '操作失败' });
        }
    }

    async handleWebMessage(msg: any): Promise<void> {
        const m = msg;
        switch (m.command) {
            // ─── Models ───────────────────────────────────────────────
            case 'loadConfig': await this.loadConfig(); break;
            case 'saveConfig':
                await this.respond('saveResult',
                    () => this.core.addModel({ provider: m.data.provider, modelName: m.data.modelName, baseURL: m.data.baseURL, apiKey: m.data.apiKey, maxTokens: m.data.maxTokens, contextLength: m.data.contextLength, ...(m.data.adapt && { adapt: m.data.adapt }) }, true),
                    () => ({ message: '模型配置已添加！' }), undefined);
                await this.loadConfig();
                break;
            case 'toggleModelActive':
                try { await this.ensureInit(); await this.core.switchModel(m.modelName); } catch { /* ignore */ }
                await this.loadConfig();
                break;
            case 'updateModelPointer':
                this.postToApp({ command: 'taskConfigChanged', pointer: m.pointer, modelName: m.modelName });
                break;
            case 'confirmTaskConfig':
                try { await this.ensureInit(); await this.core.applyTaskModel(m.data); this.postToApp({ command: 'taskConfigConfirmed' }); } catch { /* ignore */ }
                await this.loadConfig();
                break;
            case 'deleteModel':
                await this.respond('deleteResult', () => this.core.delModel(m.modelName), () => ({ message: '模型已删除' }), undefined);
                await this.loadConfig();
                break;
            case 'fetchModels':
                try {
                    await this.ensureInit();
                    const r = await this.core.fetchAvailableModels(m.data);
                    this.postToApp({ command: 'modelsResult', success: r.success, models: r.models || [], message: r.success ? (r.message || '获取模型列表成功') : `${r.message || '获取模型列表失败'}${r.curlCommand ? '\n调试命令: ' + r.curlCommand : ''}` });
                } catch (e: any) {
                    this.postToApp({ command: 'modelsResult', success: false, models: [], message: `获取模型列表失败: ${e?.message || ''}` });
                }
                break;
            case 'getModelAdapter':
                try { await this.ensureInit(); const adapter = await this.core.getModelAdapter(m.provider, m.modelName, m.baseURL); this.postToApp({ command: 'modelAdapterResult', adapter: adapter ?? null }); } catch { /* 静默 */ }
                break;
            case 'testConnection':
                try {
                    await this.ensureInit();
                    const r = await this.core.testApiConnection(m.data);
                    this.postToApp({ command: 'testResult', success: r.success, message: r.success ? '✓ 连接测试成功！API 配置正确。' : `${r.message}\n调试命令: ${r.curlCommand}` || '连接测试失败' });
                } catch (e: any) {
                    this.postToApp({ command: 'testResult', success: false, message: `✗ 测试失败: ${e?.message || ''}` });
                }
                break;

            // ─── System config（本地存 Kotlin + 推 core）─────────────────
            case 'loadSystemConfig': await this.loadSystemConfig(); break;
            case 'saveSystemConfig':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'save', config: m.data });
                    await this.core.updateCoreConfig(this.toCoreSystemConfig(m.data));
                    this.postToApp({ command: 'saveSystemConfigResult', success: true, message: '系统配置已保存' });
                } catch (e: any) {
                    this.postToApp({ command: 'saveSystemConfigResult', success: false, message: e?.message || '保存失败' });
                }
                break;
            case 'saveSystemConfigByKey':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'saveByKey', key: m.key, value: m.value });
                    if (!LOCAL_SYSTEM_CONFIG_KEYS.includes(m.key)) await this.core.updateCoreConfByKey(m.key, m.value);
                    this.postToApp({ command: 'saveSystemConfigByKeyResult', success: true, key: m.key, value: m.value, message: '配置已保存' });
                } catch (e: any) {
                    this.postToApp({ command: 'saveSystemConfigByKeyResult', success: false, key: m.key, value: m.value, message: e?.message || '保存失败' });
                }
                break;
            case 'resetSystemConfig':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'save', config: defaultConfig });
                    await this.core.updateCoreConfig(this.toCoreSystemConfig(defaultConfig));
                    this.postToApp({ command: 'resetSystemConfigResult', success: true, message: '系统配置已重置' });
                } catch (e: any) {
                    this.postToApp({ command: 'resetSystemConfigResult', success: false, message: e?.message || '重置失败' });
                }
                break;

            // ─── Tools ─────────────────────────────────────────────────
            case 'loadSystemTools':
                await this.respond('loadSystemToolsResult', () => this.core.getToolInfos(), (data) => ({ data }));
                break;
            case 'updateDisabledTools':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'saveDisabledTools', disabledTools: m.disabledTools });
                    await this.core.updateDisabledTools(m.disabledTools);
                    this.postToApp({ command: 'updateDisabledToolsResult', success: true, message: '工具配置已更新' });
                } catch (e: any) {
                    this.postToApp({ command: 'updateDisabledToolsResult', success: false, message: e?.message || '更新失败' });
                }
                break;

            // ─── Plugins / Marketplace ─────────────────────────────────
            case 'loadPluginConfig':
                await this.respond('loadPluginConfigResult', () => this.core.getMarketplacePluginsInfo(), (data) => ({ data }), { marketplaces: [], plugins: [] });
                break;
            case 'refreshPluginConfig':
                await this.respond('refreshPluginConfigResult', () => this.core.refreshMarketplacePluginsInfo(), (data) => ({ data }), { marketplaces: [], plugins: [] });
                break;
            case 'installPlugin':
                await this.respond('installPluginResult', () => this.core.installPlugin(m.pluginName, m.marketplaceName, m.scope), (data) => ({ key: m.key, data }), undefined);
                break;
            case 'uninstallPlugin':
                await this.respond('uninstallPluginResult', () => this.core.uninstallPlugin(m.pluginName, m.marketplaceName, m.scope), (data) => ({ key: m.key, data }), undefined);
                break;
            case 'enablePlugin':
                await this.respond('enablePluginResult', () => this.core.enablePlugin(m.pluginName, m.marketplaceName, m.scope), (data) => ({ data }), undefined);
                break;
            case 'disablePlugin':
                await this.respond('disablePluginResult', () => this.core.disablePlugin(m.pluginName, m.marketplaceName, m.scope), (data) => ({ data }), undefined);
                break;
            case 'updateMarketplace':
                await this.respond('updateMarketplaceResult', () => this.core.updateMarketplace(m.marketplaceName), (data) => ({ name: m.marketplaceName, data }), undefined);
                break;
            case 'removeMarketplace':
                await this.respond('removeMarketplaceResult', () => this.core.removeMarketplace(m.marketplaceName), (data) => ({ name: m.marketplaceName, data }), undefined);
                break;
            case 'addMarketplaceFromGit':
                await this.respond('addMarketplaceResult', () => this.core.addMarketplaceFromGit(m.repo), (data) => ({ data }), undefined);
                break;
            case 'addMarketplaceFromDirectory':
                await this.respond('addMarketplaceResult', () => this.core.addMarketplaceFromDirectory(m.dirPath), (data) => ({ data }), undefined);
                break;

            // ─── Agents ────────────────────────────────────────────────
            case 'loadAgentsInfo':
                await this.respond('loadAgentsInfoResult', () => this.core.getAgentsInfo(), (data) => ({ data }));
                break;
            case 'refreshAgents':
                await this.respond('refreshAgentsInfoResult', () => this.core.getAgentsInfo(true), (data) => ({ data }));
                break;
            case 'addAgent':
                await this.respond('addAgentResult', () => this.core.addAgentConf(m.data), (data) => ({ message: 'Agent 创建成功', data }));
                break;
            case 'removeAgent':
                await this.respond('removeAgentResult', () => this.core.removeAgentConf(m.name), (data) => ({ message: 'Agent 已删除', data }));
                break;

            // ─── Skills（读/删走 core；Hub 后置）──────────────────────────
            case 'loadSkillsInfo':
                await this.respond('loadSkillsInfoResult', () => this.core.getSkillsInfo(), (data) => ({ data }));
                break;
            case 'refreshSkills':
                await this.respond('refreshSkillsInfoResult', () => this.core.getSkillsInfo(true), (data) => ({ data }));
                break;
            case 'removeSkill':
                await this.respond('removeSkillResult', () => this.core.removeSkillConf(m.name), (data) => ({ message: 'Skill 已删除', data }));
                break;
            case 'searchSkillHub':
                this.postToApp({ command: 'searchSkillHubResult', success: false, data: [], message: 'JetBrains 版暂不支持 Skill Hub 在线搜索' });
                break;
            case 'installSkillFromHub':
                this.postToApp({ command: 'installSkillFromHubResult', success: false, slug: m.slug, message: 'JetBrains 版暂不支持 Skill Hub 在线安装' });
                break;

            // ─── Commands ──────────────────────────────────────────────
            case 'loadCommandsInfo':
                await this.respond('loadCommandsInfoResult', () => this.core.getCommandsInfo(), (data) => ({ data }));
                break;
            case 'refreshCommandsInfo':
                await this.respond('refreshCommandsInfoResult', () => this.core.getCommandsInfo(true), (data) => ({ data }));
                break;
            case 'addCommand':
                await this.respond('addCommandResult', () => this.core.addCommandConf(m.data), (data) => ({ message: 'Command 创建成功', data }));
                break;
            case 'removeCommand':
                await this.respond('removeCommandResult', () => this.core.removeCommandConf(m.name), (data) => ({ message: 'Command 已删除', data }));
                break;

            // ─── MCP ───────────────────────────────────────────────────
            case 'loadMCPConfig':
                await this.respond('loadMCPServerInfoResult', () => this.core.getMCPServerInfo(), (data) => ({ data }));
                break;
            case 'refreshMCPConfig':
                await this.respond('refreshMCPServerInfoResult', () => this.core.refreshMCPServerInfo(), (data) => ({ data }));
                break;
            case 'addMCPServer':
                await this.respond('addMCPServerResult', () => this.core.addMCPServer(m.data), (data) => ({ message: 'MCP Server 添加成功', data }));
                break;
            case 'removeMCPServer':
                await this.respond('removeMCPServerResult', () => this.core.removeMCPServer(m.name), (data) => ({ message: 'MCP Server 已删除', data }));
                break;
            case 'reconnectMCPServer':
                await this.respond('reconnectMCPServerResult', () => this.core.reconnectMCPServer(m.name), (data) => ({ message: 'MCP Server 重连成功', data }));
                break;
            case 'disableMCPServer':
                await this.respond('disableMCPServerResult', () => this.core.disableMCPServer(m.name), (data) => ({ data }));
                break;
            case 'enableMCPServer':
                await this.respond('enableMCPServerResult', () => this.core.enableMCPServer(m.name), (data) => ({ data }));
                break;
            case 'updateMCPUseTools':
                await this.respond('updateMCPUseToolsResult', () => this.core.updateMCPUseTools(m.name, m.toolNames), (data) => ({ message: '工具配置已更新', data }));
                break;

            // ─── Memory / Rule ─────────────────────────────────────────
            case 'loadMemoryInfo':
                await this.respond('loadMemoryInfoResult', () => this.core.getMemoryInfo(), (data) => ({ data }), null);
                break;
            case 'refreshMemoryInfo':
                await this.respond('refreshMemoryInfoResult', () => this.core.getMemoryInfo(true), (data) => ({ data }), null);
                break;
            case 'loadRuleInfo':
                await this.respond('loadRuleInfoResult', () => this.core.getRuleInfo(), (data) => ({ data }), null);
                break;
            case 'refreshRuleInfo':
                await this.respond('refreshRuleInfoResult', () => this.core.getRuleInfo(true), (data) => ({ data }), null);
                break;

            // ─── Cron ──────────────────────────────────────────────────
            case 'loadCronTasks':
                await this.respond('loadCronTasksResult', () => this.core.getCronTasks(), (data) => ({ data }));
                break;
            case 'deleteCronTask':
                try { await this.ensureInit(); const success = await this.core.deleteCronTask(m.id); this.postToApp({ command: 'deleteCronTaskResult', success, id: m.id }); } catch { this.postToApp({ command: 'deleteCronTaskResult', success: false, id: m.id }); }
                break;
            case 'enableCronTask':
                try { await this.ensureInit(); const success = await this.core.enableCronTask(m.id); this.postToApp({ command: 'enableCronTaskResult', success, id: m.id }); } catch { this.postToApp({ command: 'enableCronTaskResult', success: false, id: m.id }); }
                break;
            case 'disableCronTask':
                try { await this.ensureInit(); const success = await this.core.disableCronTask(m.id); this.postToApp({ command: 'disableCronTaskResult', success, id: m.id }); } catch { this.postToApp({ command: 'disableCronTaskResult', success: false, id: m.id }); }
                break;

            // ─── Design ────────────────────────────────────────────────
            case 'loadDesignSkills':
                await this.respond('loadDesignSkillsResult', () => this.core.getDesignSkillsInfo(false), (data) => ({ data }));
                break;
            case 'refreshDesignSkills':
                await this.respond('refreshDesignSkillsResult', () => this.core.getDesignSkillsInfo(true), (data) => ({ data }));
                break;
            case 'loadDesignSystems':
                await this.respond('loadDesignSystemsResult', () => this.core.getDesignSystemsInfo(false), (data) => ({ data }));
                break;
            case 'refreshDesignSystems':
                await this.respond('refreshDesignSystemsResult', () => this.core.getDesignSystemsInfo(true), (data) => ({ data }));
                break;

            // ─── 编辑器操作（复用聊天已通的 channel）────────────────────
            case 'openFile': this.t.editor('openFile', { filePath: m.filePath, line: m.line, endLine: m.endLine }); break;
            case 'openExternal': this.t.editor('openExternal', { url: m.url }); break;
            case 'openBashOutput': this.t.editor('openBashOutput', { content: m.content, title: m.title, toolId: m.toolId }); break;
            case 'openAgentDetail': this.t.editor('openAgentDetail', { taskId: m.taskId }); break;

            // ─── 后台任务面板（后置：先回空避免 UI 卡住）─────────────────
            case 'loadTaskList': this.postToApp({ command: 'loadTaskListResult', success: true, data: [] }); break;
            case 'watchTask': case 'unwatchTask': case 'stopTask': break;

            // ─── Claw（后置：入口应隐藏，命令到达则忽略）──────────────────
            case 'clawLoadStatus': case 'clawEnable': case 'clawDisable': case 'clawStartBind':
            case 'clawBindFeishu': case 'clawSubmitVerifyCode': case 'clawUnbind': case 'clawSaveVerbosity':
                break;

            default: break;
        }
    }

    private async loadConfig(): Promise<void> {
        try {
            await this.ensureInit();
            const modelData = await this.core.getModelData();
            this.postToApp({ command: 'loadConfig', data: modelData, showAddPage: !modelData?.modelList?.length });
        } catch {
            this.postToApp({ command: 'loadConfig', data: null, showAddPage: true });
        }
    }

    private async loadSystemConfig(): Promise<void> {
        try {
            const res = await this.t.callEditor('systemConfig', { op: 'get' });
            this.postToApp({ command: 'loadSystemConfigResult', success: true, data: res?.config ?? defaultConfig, platform: res?.platform ?? 'darwin' });
        } catch (e: any) {
            this.postToApp({ command: 'loadSystemConfigResult', success: false, data: defaultConfig, message: e?.message || '加载失败' });
        }
    }
}
