import type { Transport } from '../../chat/jb/transport';
import { RemoteCore } from '../../chat/jb/remote';
import { defaultConfig, DEFAULT_CUSTOM_RULES } from '../default/defaultConfig';
import { t, normalizeLang } from '../../common/i18n/core';
import { detectSources, previewImport, executeImport } from '../import/importer';
import type { ImportFs, ImportRoots, ImportSource, ImportItem } from '../import/types';

/**
 * 配置页控制器（JB 版）—— 1:1 复刻 VSCode 端 ConfigWebviewProvider 的 handler → 出站 command 映射，
 * 只是数据源从进程内 coreManager 换成走 gRPC 的 RemoteCore（透明桥）与 Kotlin 本地存储（systemConfig channel）。
 *
 * 分层：
 * - A 类（纯 sema-core 方法）→ RemoteCore（gRPC），返回原始值后翻译成 UI 出站 command。
 * - System Config / disabledTools 的本地持久化 → Kotlin（t.callEditor('systemConfig'...)），core 推送仍在此走 RemoteCore。
 * - openFile / openExternal → 复用聊天已通的编辑器 channel。
 * - Skill Hub 目录扫描 / 安装落盘 → Kotlin（t.callEditor('skillCatalog'...)），确认与 core 刷新在此编排。
 * - Claw / 后台任务面板 → 后置，优雅降级避免 UI 卡住。
 */

// 仅落宿主本地、不推 sema-core 的系统配置键（对齐 semaProcessWrapper.LOCAL_SYSTEM_CONFIG_KEYS）
const LOCAL_SYSTEM_CONFIG_KEYS = ['enablePet', 'showThinkingText', 'defaultPermissionLevel', 'enableBrowserControl'];

// 浏览器控制：用户级 chrome-use skill + 用户级 chrome MCP（对齐 VSCode BrowserControlManager 的常量）
const BROWSER_SKILL_NAME = 'chrome-use';
const BROWSER_MCP_NAME = 'chrome';

// 使用统计的产品标识：读取时按它过滤本产品的数据；采集开关由 Kotlin 在 init 合并 usageProduct 时传给 core
// （MessageBridge.mergeInitConfig，两处须一致；对齐 VSCode semaProcessWrapper.USAGE_PRODUCT）
const USAGE_PRODUCT = 'sema-code-jetbrains';

export class ConfigController {
    private core: RemoteCore;
    private initialized = false;
    // 浏览器控制开/关动作串行链：core 的两个 remove 都先查内存缓存，add / 拷目录后的 refresh 是异步的，
    // 快速点两下若不串行，remove 会因缓存里还没有该项而空转，文件里的项就残留了（对齐 VSCode BrowserControlManager.chain）。
    private browserControlChain: Promise<unknown> = Promise.resolve();

    constructor(private t: Transport, private postToApp: (msg: any) => void) {
        this.core = new RemoteCore(t);
        // 进程级事件（session_id 空）：cron:update / mcp:server:status / task:watch:delta → 翻成配置页出站 command
        t.setEventHandler((event, data, sessionId) => {
            // watchTask 实时增量（D4b）：任务 action 会话级化后 delta 帧带 session_id，
            // 但归属按 taskId 判定、与会话无关，先于进程级过滤处理（对齐 VSCode watchTask onDelta）。
            if (event === 'task:watch:delta') { this.postToApp({ command: 'taskWatchUpdate', taskId: data?.taskId, data: data?.delta }); return; }
            if (sessionId) return; // 会话级事件与配置页无关
            if (event === 'mcp:server:status') this.postToApp({ command: 'mcpServerStatusUpdate', data });
            else if (event === 'cron:update') this.postToApp({ command: 'cronUpdate' });
            // 模型变更跨面板同步：聊天页改模型后桥广播 model:update，配置页据此刷新模型列表
            // （对齐 VSCode handleModelUpdate → configWebviewProvider.refreshConfigPage）。
            else if (event === 'model:update') void this.loadConfig();
            // 注：新会话后重拉扩展子页（sessionCreated）不走这里——session:ready 是会话级事件，
            // 只推给建会话的那条连接（聊天页），配置页收不到；由聊天页经宿主总线转发到本页的 UI 入站帧。
            // 后台任务生命周期跨面板同步：会话开启/结束任务时桥广播 task:start/transfer/end，
            // 配置页任务面板据此实时增删（对齐 VSCode handleTaskStart/End → pushTaskStart/pushTaskEnd）。
            else if (event === 'task:start' || event === 'task:transfer') this.postToApp({ command: 'taskStart', data });
            else if (event === 'task:end') this.postToApp({ command: 'taskEnd', data });
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

    /** 破坏性操作二次确认：走 Kotlin 模态弹窗（对齐 VSCode configWebview 的 showWarningMessage modal）。取消/失败均视为不确认。 */
    private async confirm(message: string, confirmLabel = t('common.ok')): Promise<boolean> {
        try { const r = await this.t.callEditor('confirm', { message, confirmLabel }); return !!r?.confirmed; }
        catch { return false; }
    }

    /** 统一：ensureInit → 调 core → 成功/失败都按给定 command 回灌（data 缺省值可配）。 */
    private async respond(command: string, fn: () => Promise<any>, shape: (data: any) => any, failData: any = []): Promise<void> {
        try {
            await this.ensureInit();
            const data = await fn();
            this.postToApp({ command, success: true, ...shape(data) });
        } catch (e: any) {
            this.postToApp({ command, success: false, data: failData, message: e?.message || t('host.cfg.failed') });
        }
    }

    async handleWebMessage(msg: any): Promise<void> {
        const m = msg;
        switch (m.command) {
            // ─── Models ───────────────────────────────────────────────
            case 'loadConfig': await this.loadConfig(); break;
            case 'saveConfig':
                await this.respond('saveResult',
                    () => this.core.addModel({ provider: m.data.provider, modelName: m.data.modelName, baseURL: m.data.baseURL, apiKey: m.data.apiKey, maxTokens: m.data.maxTokens, contextLength: m.data.contextLength, ...(m.data.adapt && { adapt: m.data.adapt }), ...(m.data.thinkingHistoryPolicy && { thinkingHistoryPolicy: m.data.thinkingHistoryPolicy }) }, true),
                    () => ({ message: m.data.isEdit ? t('host.cfg.modelSaved') : t('host.cfg.modelAdded') }), undefined);
                await this.loadConfig();
                break;
            case 'toggleModelActive':
                try { await this.ensureInit(); await this.core.switchModel(m.modelName); } catch { /* ignore */ }
                await this.loadConfig();
                break;
            case 'confirmTaskConfig':
                try { await this.ensureInit(); await this.core.applyTaskModel(m.data); } catch { /* ignore */ }
                await this.loadConfig();
                break;
            case 'deleteModel':
                if (!await this.confirm(t('host.cfg.deleteModelConfirm', { name: m.modelName }), t('common.delete'))) break;
                await this.respond('deleteResult', () => this.core.delModel(m.modelName), () => ({ message: t('host.cfg.modelDeleted') }), undefined);
                await this.loadConfig();
                break;
            case 'fetchModels':
                try {
                    await this.ensureInit();
                    const r = await this.core.fetchAvailableModels(m.data);
                    this.postToApp({ command: 'modelsResult', success: r.success, models: r.models || [], message: r.success ? (r.message || t('host.cfg.fetchModelsOk')) : `${r.message || t('host.cfg.fetchModelsFailed')}${r.curlCommand ? '\n' + t('host.cfg.debugCommand') + r.curlCommand : ''}` });
                } catch (e: any) {
                    this.postToApp({ command: 'modelsResult', success: false, models: [], message: `${t('host.cfg.fetchModelsFailed')}: ${e?.message || ''}` });
                }
                break;
            case 'getModelAdapter':
                try { await this.ensureInit(); const adapter = await this.core.getModelAdapter(m.provider, m.modelName, m.baseURL); this.postToApp({ command: 'modelAdapterResult', adapter: adapter ?? null }); } catch { /* 静默 */ }
                break;
            case 'getModelProfile':
                // 编辑模型：拿完整落盘配置回灌，App 据此切到新增页回填；失败只弹错，不进入编辑态
                try {
                    await this.ensureInit();
                    const profile = await this.core.getModelProfile(m.provider, m.modelName);
                    if (!profile) throw new Error(t('host.cfg.modelNotExist', { name: `${m.modelName}[${m.provider}]` }));
                    this.postToApp({ command: 'modelProfileResult', profile });
                } catch (e: any) {
                    console.warn('[config] getModelProfile failed:', e?.message || e);
                    this.postToApp({ command: 'modelProfileResult', success: false, profile: null, message: t('host.cfg.readModelFailed', { error: e?.message || '' }) });
                }
                break;
            case 'testConnection':
                try {
                    await this.ensureInit();
                    const r = await this.core.testApiConnection(m.data);
                    this.postToApp({ command: 'testResult', success: r.success, message: r.success ? t('host.cfg.testOk') : `${r.message}\n${t('host.cfg.debugCommand')}${r.curlCommand}` || t('host.cfg.testFailed') });
                } catch (e: any) {
                    this.postToApp({ command: 'testResult', success: false, message: t('host.cfg.testError', { error: e?.message || '' }) });
                }
                break;

            // ─── System config（本地存 Kotlin + 推 core）─────────────────
            case 'loadSystemConfig': await this.loadSystemConfig(); break;
            case 'saveSystemConfig':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'save', config: m.data });
                    await this.core.updateCoreConfig(this.toCoreSystemConfig(m.data));
                    this.postToApp({ command: 'saveSystemConfigResult', success: true, message: t('host.cfg.systemSaved') });
                } catch (e: any) {
                    this.postToApp({ command: 'saveSystemConfigResult', success: false, message: e?.message || t('host.cfg.saveFailed') });
                }
                break;
            case 'saveSystemConfigByKey':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'saveByKey', key: m.key, value: m.value });
                    if (!LOCAL_SYSTEM_CONFIG_KEYS.includes(m.key)) await this.core.updateCoreConfByKey(m.key, m.value);
                    this.postToApp({ command: 'saveSystemConfigByKeyResult', success: true, key: m.key, value: m.value, message: t('host.cfg.configSaved') });
                } catch (e: any) {
                    this.postToApp({ command: 'saveSystemConfigByKeyResult', success: false, key: m.key, value: m.value, message: e?.message || t('host.cfg.saveFailed') });
                }
                break;
            case 'resetSystemConfig':
                if (!await this.confirm(t('host.cfg.resetConfirm'), t('host.cfg.resetLabel'))) break;
                try {
                    await this.ensureInit();
                    // 重置不改界面语言（对齐 VSCode configWebview.resetSystemConfig）：
                    // lang 保留当前持久化值，customRules 取当前语言对应的默认规则，其余字段回默认。
                    // enableBrowserControl 只允许由 setBrowserControl 在动作成功后写入，重置时保留当前值，避免键与实际 skill/MCP 状态脱节
                    const current = await this.t.callEditor('systemConfig', { op: 'get' });
                    const lang = normalizeLang(current?.config?.lang);
                    const resetConfig = {
                        ...defaultConfig, lang, customRules: DEFAULT_CUSTOM_RULES[lang],
                        enableBrowserControl: !!current?.config?.enableBrowserControl
                    };
                    await this.t.callEditor('systemConfig', { op: 'save', config: resetConfig });
                    await this.core.updateCoreConfig(this.toCoreSystemConfig(resetConfig));
                    this.postToApp({ command: 'resetSystemConfigResult', success: true, data: resetConfig, message: t('host.cfg.systemReset') });
                } catch (e: any) {
                    this.postToApp({ command: 'resetSystemConfigResult', success: false, message: e?.message || t('host.cfg.resetFailed') });
                }
                break;
            case 'setBrowserControl': await this.setBrowserControl(!!m.enabled); break;

            // ─── Tools ─────────────────────────────────────────────────
            case 'loadSystemTools':
                await this.respond('loadSystemToolsResult', () => this.core.getToolInfos(), (data) => ({ data }));
                break;
            case 'updateDisabledTools':
                try {
                    await this.ensureInit();
                    await this.t.callEditor('systemConfig', { op: 'saveDisabledTools', disabledTools: m.disabledTools });
                    await this.core.updateDisabledTools(m.disabledTools);
                    this.postToApp({ command: 'updateDisabledToolsResult', success: true, message: t('host.cfg.toolsUpdated') });
                } catch (e: any) {
                    this.postToApp({ command: 'updateDisabledToolsResult', success: false, message: e?.message || t('host.cfg.updateFailed') });
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
                if (!await this.confirm(t('host.cfg.uninstallPluginConfirm', { name: m.pluginName }), t('host.cfg.uninstallLabel'))) break;
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
                if (!await this.confirm(t('host.cfg.removeMarketConfirm', { name: m.marketplaceName }), t('host.cfg.removeLabel'))) break;
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
                await this.respond('addAgentResult', () => this.core.addAgentConf(m.data), (data) => ({ message: t('host.cfg.agentCreated'), data }));
                break;
            case 'removeAgent':
                if (!await this.confirm(t('host.cfg.deleteAgentConfirm', { name: m.name }), t('common.delete'))) break;
                await this.respond('removeAgentResult', () => this.core.removeAgentConf(m.name), (data) => ({ message: t('host.cfg.agentDeleted'), data }));
                break;

            // ─── Skills（读/删走 core；Hub 落盘走 Kotlin）──────────────────
            case 'loadSkillsInfo':
                await this.respond('loadSkillsInfoResult', () => this.core.getSkillsInfo(), (data) => ({ data }));
                break;
            case 'refreshSkills':
                await this.respond('refreshSkillsInfoResult', () => this.core.getSkillsInfo(true), (data) => ({ data }));
                break;
            case 'removeSkill':
                if (!await this.confirm(t('host.cfg.deleteSkillConfirm', { name: m.name }), t('common.delete'))) break;
                await this.respond('removeSkillResult', () => this.core.removeSkillConf(m.name), (data) => ({ message: t('host.cfg.skillDeleted'), data }));
                break;
            case 'toggleSkill':
                // 写入哪层 settings 由 core 按技能所在层决定；失败时 UI 收到 success:false 会重拉恢复真实状态
                await this.respond('toggleSkillResult', () => (m.enabled ? this.core.enableSkill(m.name) : this.core.disableSkill(m.name)), (data) => ({ data }));
                break;
            // Skill 市场（内置资源目录）：扫描 / 落盘走 Kotlin（callEditor('skillCatalog')），确认与 core 刷新在此编排（对齐 VSCode configWebview）
            case 'loadSkillCatalog':
                // 目录列表是纯本地扫描，不依赖 core
                try {
                    const r = await this.skillCatalog({ op: 'list' });
                    this.postToApp({ command: 'loadSkillCatalogResult', success: true, data: r?.catalog ?? [] });
                } catch (e: any) {
                    this.postToApp({ command: 'loadSkillCatalogResult', success: false, data: [], message: e?.message || t('host.cfg.failed') });
                }
                break;
            case 'installCatalogSkill':
                await this.installCatalogSkill(m.id, m.scope);
                break;
            case 'uninstallCatalogSkill':
                await this.uninstallCatalogSkill(m.id);
                break;

            // ─── Commands ──────────────────────────────────────────────
            case 'loadCommandsInfo':
                await this.respond('loadCommandsInfoResult', () => this.core.getCommandsInfo(), (data) => ({ data }));
                break;
            case 'refreshCommandsInfo':
                await this.respond('refreshCommandsInfoResult', () => this.core.getCommandsInfo(true), (data) => ({ data }));
                break;
            case 'addCommand':
                await this.respond('addCommandResult', () => this.core.addCommandConf(m.data), (data) => ({ message: t('host.cfg.commandCreated'), data }));
                break;
            case 'removeCommand':
                if (!await this.confirm(t('host.cfg.deleteCommandConfirm', { name: m.name }), t('common.delete'))) break;
                await this.respond('removeCommandResult', () => this.core.removeCommandConf(m.name), (data) => ({ message: t('host.cfg.commandDeleted'), data }));
                break;

            // ─── MCP ───────────────────────────────────────────────────
            case 'loadMCPConfig':
                await this.respond('loadMCPServerInfoResult', () => this.core.getMCPServerInfo(), (data) => ({ data }));
                break;
            case 'refreshMCPConfig':
                await this.respond('refreshMCPServerInfoResult', () => this.core.refreshMCPServerInfo(), (data) => ({ data }));
                break;
            case 'addMCPServer':
                await this.respond('addMCPServerResult', () => this.core.addMCPServer(m.data), (data) => ({ message: t('host.cfg.mcpAdded'), data }));
                break;
            case 'removeMCPServer':
                if (!await this.confirm(t('host.cfg.deleteMcpConfirm', { name: m.name }), t('common.delete'))) break;
                await this.respond('removeMCPServerResult', () => this.core.removeMCPServer(m.name), (data) => ({ message: t('host.cfg.mcpDeleted'), data }));
                break;
            case 'reconnectMCPServer':
                await this.respond('reconnectMCPServerResult', () => this.core.reconnectMCPServer(m.name), (data) => ({ message: t('host.cfg.mcpReconnected'), data }));
                break;
            case 'disableMCPServer':
                await this.respond('disableMCPServerResult', () => this.core.disableMCPServer(m.name), (data) => ({ data }));
                break;
            case 'enableMCPServer':
                await this.respond('enableMCPServerResult', () => this.core.enableMCPServer(m.name), (data) => ({ data }));
                break;
            case 'updateMCPUseTools':
                await this.respond('updateMCPUseToolsResult', () => this.core.updateMCPUseTools(m.name, m.toolNames), (data) => ({ message: t('host.cfg.toolsUpdated'), data }));
                break;

            // ─── 导入（从 Claude Code / Codex / Cursor）────────────────
            // 与 VSCode 同名三个消息；文件读写经 callEditor('fileOps') 下沉到 Kotlin，写入仍走 RemoteCore 公开 API
            case 'importDetectSources':
                await this.respond('importDetectSourcesResult', async () => detectSources(this.importFs, await this.importRoots()), (data) => ({ data }));
                break;
            case 'importPreview':
                await this.respond('importPreviewResult', async () => previewImport(this.importFs, await this.importRoots(), this.core, m.source as ImportSource), (data) => ({ source: m.source, data }));
                break;
            case 'importExecute':
                await this.respond('importExecuteResult', async () => executeImport(this.importFs, await this.importRoots(), this.core, (m.items ?? []) as ImportItem[]), (data) => ({ source: m.source, data }));
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

            // ─── Hooks ─────────────────────────────────────────────────
            case 'loadHooksInfo':
                await this.respond('loadHooksInfoResult', () => this.core.getHooksInfo(), (data) => ({ data }), null);
                break;
            case 'refreshHooks':
                await this.respond('refreshHooksInfoResult', () => this.core.getHooksInfo(true), (data) => ({ data }), null);
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

            // ─── 使用统计（core 采集落盘，这里只读取与清除；对齐 VSCode configWebview.loadUsageStats / clearUsageStats）───
            case 'loadUsageStats':
                await this.respond('loadUsageStatsResult', () => this.core.getUsageStats(USAGE_PRODUCT), (data) => ({ data }), null);
                break;
            case 'clearUsageStats':
                if (!await this.confirm(t('config.usage.clearConfirm'), t('config.usage.clearOk'))) {
                    this.postToApp({ command: 'clearUsageStatsResult', success: false, cancelled: true });
                    break;
                }
                await this.respond('clearUsageStatsResult', () => this.core.clearUsageStats(USAGE_PRODUCT), () => ({}), null);
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
            // 带上归属会话（D8）：getTaskList 聚合项已含 sessionId，UI 回传时一并带上，供 Kotlin 定位子 agent 详情。
            case 'openAgentDetail': this.t.editor('openAgentDetail', { taskId: m.taskId, sessionId: m.sessionId }); break;

            // ─── 后台任务面板（D4：跨会话聚合，走 gRPC）─────────────────
            case 'loadTaskList':
                await this.respond('loadTaskListResult', () => this.core.getTaskList(), (data) => ({ data }));
                break;
            case 'watchTask': try { await this.ensureInit(); await this.core.watchTask(m.taskId); } catch { /* ignore */ } break;
            case 'unwatchTask': try { await this.ensureInit(); await this.core.unwatchTask(m.taskId); } catch { /* ignore */ } break;
            // 成功即回帧让 Kill 按钮立即置 killed（对齐 VSCode configWebview.stopTask）；task:end 广播随后兜底刷新
            case 'stopTask':
                try {
                    await this.ensureInit();
                    await this.core.stopTask(m.taskId);
                    this.postToApp({ command: 'stopTaskResult', success: true, taskId: m.taskId });
                } catch (e: any) {
                    this.postToApp({ command: 'stopTaskResult', success: false, taskId: m.taskId, message: e?.message || t('host.cfg.stopTaskFailed') });
                }
                break;

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
            this.postToApp({ command: 'loadSystemConfigResult', success: false, data: defaultConfig, message: e?.message || t('host.cfg.loadFailed') });
        }
    }

    // ─── Browser control（对齐 VSCode configWebview.setBrowserControl + BrowserControlManager）─────────

    /**
     * 浏览器控制开关：串行执行补齐/删除 skill 与 MCP，全部成功后才落 enableBrowserControl。
     * 回传 enabled：成功为目标值，失败为原值（页面据此回弹）。任一步失败不回滚（动作幂等，重试即补齐）。
     */
    private async setBrowserControl(enabled: boolean): Promise<void> {
        let previous = false;
        try {
            const cur = await this.t.callEditor('systemConfig', { op: 'get' });
            previous = !!cur?.config?.enableBrowserControl;
            await this.ensureInit();
            const run = () => (enabled ? this.enableBrowserControl() : this.disableBrowserControl());
            const task = this.browserControlChain.then(run, run);
            this.browserControlChain = task.catch(() => undefined);
            const result = await task;
            this.postToApp({ command: 'setBrowserControlResult', success: true, enabled: result });
        } catch (e: any) {
            const text = t('host.cfg.opFailed', { op: t('host.cfg.op.browserControl'), error: e?.message || t('common.unknownError') });
            this.postToApp({ command: 'setBrowserControlResult', success: false, enabled: previous, message: text });
        }
    }

    private async enableBrowserControl(): Promise<boolean> {
        // 1. 拷 skill 目录 + 读 MCP 模板：webview 无 fs，下沉到 Kotlin（从插件资源 assets/chrome 取，与 VSCode 同源）
        const prepared = await this.t.callEditor('browserControl', { op: 'prepare' });
        // 2. 让 core 重新扫描 skills，把新目录加载进缓存
        await this.core.getSkillsInfo(true);
        // 3. 用户级没有 chrome MCP 就按模板添加
        const servers: any[] = await this.core.getMCPServerInfo();
        if (!this.findUserBrowserMcp(servers)) {
            const entry = prepared?.mcp;
            if (!entry) throw new Error(`assets/chrome/mcp.json 缺少 mcpServers.${BROWSER_MCP_NAME}`);
            await this.core.addMCPServer({ ...entry, name: BROWSER_MCP_NAME, scope: 'user' });
        }
        // 4. 三步全部完成后才落配置键
        await this.t.callEditor('systemConfig', { op: 'saveByKey', key: 'enableBrowserControl', value: true });
        return true;
    }

    private async disableBrowserControl(): Promise<boolean> {
        // 1. 只删用户级 chrome MCP；项目级同名项不动
        const servers: any[] = await this.core.getMCPServerInfo();
        if (this.findUserBrowserMcp(servers)) {
            await this.core.removeMCPServer(BROWSER_MCP_NAME);
        }
        // 2. 只删用户级 chrome-use skill
        const skills: any[] = await this.core.getSkillsInfo();
        if ((skills ?? []).some(s => s?.name === BROWSER_SKILL_NAME && s?.locate === 'user')) {
            await this.core.removeSkillConf(BROWSER_SKILL_NAME);
        }
        await this.t.callEditor('systemConfig', { op: 'saveByKey', key: 'enableBrowserControl', value: false });
        return false;
    }

    private findUserBrowserMcp(servers: any[]): any | undefined {
        return (servers ?? []).find(s => s?.config?.name === BROWSER_MCP_NAME && (s?.scope ?? s?.config?.scope) === 'user');
    }

    // ─── Skill 市场（editor channel，type=skillCatalog）────────────────────────

    private skillCatalog(payload: Record<string, any>): Promise<any> { return this.t.callEditor('skillCatalog', payload); }

    private async catalogName(id: string): Promise<string> {
        const r = await this.skillCatalog({ op: 'list' });
        return (r?.catalog ?? []).find((s: any) => s?.id === id)?.name || id;
    }

    /** 安装后一并带回最新目录与已安装 skills，页面不用再发两次请求（对齐 VSCode installCatalogSkill） */
    private async installCatalogSkill(id: string, scope: string): Promise<void> {
        try {
            await this.ensureInit();
            const r = await this.skillCatalog({ op: 'install', id, scope, overwrite: false });
            if (r?.needConfirm) {
                if (!await this.confirm(t('host.cfg.confirmOverwriteSkill', { name: await this.catalogName(id) }), t('host.cfg.overwrite'))) {
                    this.postToApp({ command: 'installCatalogSkillResult', success: true, id, scope, cancelled: true });
                    return;
                }
                await this.skillCatalog({ op: 'install', id, scope, overwrite: true });
            }
            const skills = await this.core.getSkillsInfo(true);
            const catalog = (await this.skillCatalog({ op: 'list' }))?.catalog ?? [];
            this.postToApp({ command: 'installCatalogSkillResult', success: true, id, scope, skills, catalog });
        } catch (e: any) {
            const message = t('host.cfg.opFailed', { op: t('host.cfg.op.installSkill'), error: e?.message || t('common.unknownError') });
            this.postToApp({ command: 'installCatalogSkillResult', success: false, id, scope, message });
        }
    }

    private async uninstallCatalogSkill(id: string): Promise<void> {
        try {
            await this.ensureInit();
            if (!await this.confirm(t('host.cfg.confirmUninstallSkill', { name: await this.catalogName(id) }), t('config.skill.uninstall'))) {
                this.postToApp({ command: 'uninstallCatalogSkillResult', success: true, id, cancelled: true });
                return;
            }
            const r = await this.skillCatalog({ op: 'uninstall', id });
            // 清掉禁用残留，否则重装后开关显示开、实际仍禁用；失败不阻塞卸载
            try { if (r?.skillName) await this.core.enableSkill(r.skillName); } catch { /* ignore */ }
            const skills = await this.core.getSkillsInfo(true);
            const catalog = (await this.skillCatalog({ op: 'list' }))?.catalog ?? [];
            this.postToApp({ command: 'uninstallCatalogSkillResult', success: true, id, skills, catalog });
        } catch (e: any) {
            const message = t('host.cfg.opFailed', { op: t('host.cfg.op.uninstallSkill'), error: e?.message || t('common.unknownError') });
            this.postToApp({ command: 'uninstallCatalogSkillResult', success: false, id, message });
        }
    }

    // ─── 导入：ImportFs 的 Kotlin 实现（editor channel，type=fileOps）──────────

    private fileOps(payload: Record<string, any>): Promise<any> { return this.t.callEditor('fileOps', payload); }

    // 只建一次（字段初始化器里 t 会被构造参数 t 遮蔽，故用 getter 惰性建）
    private importFsCache?: ImportFs;
    private get importFs(): ImportFs {
        return this.importFsCache ??= {
            exists: async (p) => !!(await this.fileOps({ op: 'exists', path: p }))?.exists,
            readFile: async (p) => {
                const r = await this.fileOps({ op: 'readFile', path: p });
                if (typeof r?.content !== 'string') throw new Error(t('host.editorOpFailed'));
                return r.content;
            },
            readDir: async (p) => {
                const r = await this.fileOps({ op: 'readDir', path: p });
                return Array.isArray(r?.entries) ? r.entries.map((e: any) => ({ name: String(e.name), isDir: !!e.isDir })) : [];
            },
            writeFile: async (p, content) => { await this.fileOps({ op: 'writeFile', path: p, content }); },
            copyDir: async (src, dst) => { await this.fileOps({ op: 'copyDir', src, dst }); },
        };
    }

    /** home / project / sep 在面板生命周期内不变，只向 Kotlin 取一次（调用方均在 respond 内，ensureInit 已由其保证） */
    private importRootsPromise: Promise<ImportRoots> | null = null;
    private importRoots(): Promise<ImportRoots> {
        this.importRootsPromise ??= this.fileOps({ op: 'roots' }).then(
            r => ({ home: String(r?.home ?? ''), project: r?.project ? String(r.project) : undefined, sep: r?.sep === '\\' ? '\\' : '/' }),
            e => { this.importRootsPromise = null; throw e; },
        );
        return this.importRootsPromise;
    }
}
