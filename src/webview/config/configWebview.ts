import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { defaultConfig, DEFAULT_CUSTOM_RULES } from './default/defaultConfig';
import { SkillCatalogManager, CatalogScope } from '../../managers/SkillCatalogManager';
import { AgentConfig } from './types/agent';
import { CommandConfig } from './types/command';
import type { ClawCoordinator } from '../../claw/coordinator';
import { t, getLang, normalizeLang } from '../common/i18n/core';
import { BrowserControlManager } from '../../managers/BrowserControlManager';
import { detectSources, previewImport, executeImport } from './import/importer';
import type { ImportFs, ImportRoots, ImportSource, ImportItem } from './import/types';

/** 「导入」页的文件访问：Node fs.promises 实现 ImportFs（JB 侧同接口下沉到 Kotlin）；异步以免大文件 / 目录拷贝阻塞扩展宿主 */
const nodeImportFs: ImportFs = {
    exists: (p) => fs.promises.access(p).then(() => true, () => false),
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    readDir: async (p) => {
        try { return (await fs.promises.readdir(p, { withFileTypes: true })).map(e => ({ name: e.name, isDir: e.isDirectory() })); }
        catch { return []; }
    },
    writeFile: async (p, content) => { await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, content, 'utf8'); },
    copyDir: async (src, dst) => { await fs.promises.mkdir(path.dirname(dst), { recursive: true }); await fs.promises.cp(src, dst, { recursive: true, errorOnExist: false }); },
};

/** 仅落宿主本地、不推 sema-core 的系统配置键（对齐 semaProcessWrapper.LOCAL_SYSTEM_CONFIG_KEYS） */
const LOCAL_SYSTEM_CONFIG_KEYS = new Set(['enablePet', 'showThinkingText', 'defaultPermissionLevel', 'enableBrowserControl']);

export class ConfigWebviewProvider {
    private panel?: vscode.WebviewPanel;
    private coreManager: any;
    private fileOperationManager: any;
    private clawCoordinator?: ClawCoordinator;
    private browserControl?: BrowserControlManager;
    private skillCatalog?: SkillCatalogManager;
    private mcpStatusHandler?: (data: any) => void;
    private cronUpdateHandler?: () => void;
    private taskWatcherMap: Map<string, () => void> = new Map();
    private pendingPage?: string;
    private pendingTaskId?: string;
    private onSystemConfigChanged?: (key: string, value: any) => void;

    constructor(coreManager: any, fileOperationManager?: any, clawCoordinator?: ClawCoordinator) {
        this.coreManager = coreManager;
        this.fileOperationManager = fileOperationManager;
        this.clawCoordinator = clawCoordinator;
    }

    public setOnSystemConfigChanged(callback: (key: string, value: any) => void): void {
        this.onSystemConfigChanged = callback;
    }

    /** 聊天页切换语言后，同步已打开的配置页及其原生面板标题；customRules 带当前落盘值，供页面在仍为默认规则时跟着切换。 */
    public postLangUpdate(lang: string): void {
        if (!this.panel) return;
        this.panel.title = t('host.cfg.panelTitle');
        const customRules = (this.coreManager.getSystemConfig() as Record<string, any>)?.customRules;
        this.postMessage({ command: 'langUpdate', lang, customRules });
    }

    public show(extensionUri: vscode.Uri, page?: string, taskId?: string) {
        this.pendingPage = page;
        this.pendingTaskId = taskId;
        // 需要扩展根路径定位 assets/chrome/，构造时拿不到，首次 show 时创建
        this.browserControl ??= new BrowserControlManager(this.coreManager, extensionUri.fsPath);
        // Skill 市场内置资源在扩展根目录 resources/，同样首次 show 时创建
        this.skillCatalog ??= new SkillCatalogManager(path.join(extensionUri.fsPath, 'resources'));
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            this.navigateTo(page || 'models', taskId);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'semaConfig', t('host.cfg.panelTitle'), vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')] }
        );

        this.panel.webview.html = this.getHtmlContent(this.panel.webview, extensionUri);

        // 订阅 MCP 服务状态变更事件，实时推送给 webview
        this.mcpStatusHandler = (data: any) => {
            this.postMessage({ command: 'mcpServerStatusUpdate', data });
        };
        this.coreManager.getSemaCore().on('mcp:server:status', this.mcpStatusHandler);

        // 订阅定时任务变更事件，实时推送给 webview
        this.cronUpdateHandler = () => {
            this.postMessage({ command: 'cronUpdate' });
        };
        this.coreManager.getSemaCore().on('cron:update', this.cronUpdateHandler);

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            const m = msg;
            const handlers: Record<string, () => Promise<void>> = {
                saveConfig:                 () => this.saveConfig(m.data),
                loadConfig:                 () => this.loadConfig(),
                toggleModelActive:          () => this.toggleModelActive(m.provider, m.modelName),
                confirmTaskConfig:          () => this.confirmTaskConfig(m.data),
                testConnection:             () => this.testConnection(m.data),
                deleteModel:                () => this.deleteModel(m.provider, m.modelName),
                fetchModels:                () => this.fetchModels(m.data),
                loadSystemConfig:           () => this.loadSystemConfig(),
                saveSystemConfig:           () => this.saveSystemConfig(m.data),
                saveSystemConfigByKey:      () => this.saveSystemConfigByKey(m.key, m.value),
                resetSystemConfig:          () => this.resetSystemConfig(),
                setBrowserControl:          () => this.setBrowserControl(!!m.enabled),
                openExternal:               () => Promise.resolve(this.openExternalUrl(m.url)),
                loadSystemTools:            () => this.loadSystemTools(),
                updateDisabledTools:        () => this.updateDisabledTools(m.disabledTools),
                getModelAdapter:            () => Promise.resolve(this.getModelAdapter(m.provider, m.modelName, m.baseURL)),
                getModelProfile:            () => this.getModelProfile(m.provider, m.modelName),
                loadPluginConfig:           () => this.loadPluginConfig(),
                refreshPluginConfig:        () => this.refreshPluginConfig(),
                installPlugin:              () => this.installPlugin(m.pluginName, m.marketplaceName, m.scope, m.key),
                uninstallPlugin:            () => this.uninstallPlugin(m.pluginName, m.marketplaceName, m.scope, m.key),
                enablePlugin:               () => this.enablePlugin(m.pluginName, m.marketplaceName, m.scope),
                disablePlugin:              () => this.disablePlugin(m.pluginName, m.marketplaceName, m.scope),
                updateMarketplace:          () => this.updateMarketplace(m.marketplaceName),
                removeMarketplace:          () => this.removeMarketplace(m.marketplaceName),
                addMarketplaceFromGit:      () => this.addMarketplace('github', m.repo),
                addMarketplaceFromDirectory:() => this.addMarketplace('directory', m.dirPath),
                loadAgentsInfo:             () => this.loadAgentsInfo(),
                refreshAgents:              () => this.refreshAgentsInfo(),
                addAgent:                   () => this.addAgent(m.data),
                removeAgent:                () => this.removeAgent(m.name),
                loadSkillsInfo:             () => this.loadSkillsInfo(),
                refreshSkills:              () => this.refreshSkillsInfo(),
                removeSkill:                () => this.removeSkill(m.name),
                toggleSkill:                () => this.toggleSkill(m.name, m.enabled),
                loadSkillCatalog:           () => Promise.resolve(this.loadSkillCatalog()),
                installCatalogSkill:        () => this.installCatalogSkill(m.id, m.scope),
                uninstallCatalogSkill:      () => this.uninstallCatalogSkill(m.id),
                loadHooksInfo:              () => this.loadHooksInfo(),
                refreshHooks:               () => this.refreshHooksInfo(),
                loadCommandsInfo:           () => this.loadCommandsInfo(),
                refreshCommandsInfo:        () => this.refreshCommandsInfo(),
                addCommand:                 () => this.addCommand(m.data),
                removeCommand:              () => this.removeCommand(m.name),
                loadMCPConfig:              () => this.loadMCPServerInfo(),
                refreshMCPConfig:           () => this.refreshMCPServerInfo(),
                addMCPServer:               () => this.addMCPServer(m.data),
                removeMCPServer:            () => this.removeMCPServer(m.name),
                reconnectMCPServer:         () => this.reconnectMCPServer(m.name),
                disableMCPServer:           () => this.disableMCPServer(m.name),
                enableMCPServer:            () => this.enableMCPServer(m.name),
                updateMCPUseTools:          () => this.updateMCPUseTools(m.name, m.toolNames),
                importDetectSources:        () => this.importDetectSources(),
                importPreview:              () => this.importPreview(m.source),
                importExecute:              () => this.importExecute(m.source, m.items),
                loadMemoryInfo:             () => this.loadMemoryInfo(),
                refreshMemoryInfo:          () => this.refreshMemoryInfo(),
                loadRuleInfo:               () => this.loadRuleInfo(),
                refreshRuleInfo:            () => this.refreshRuleInfo(),
                loadTaskList:               () => this.loadTaskList(),
                watchTask:                  () => this.watchTask(m.taskId),
                unwatchTask:                () => Promise.resolve(this.unwatchTask(m.taskId)),
                stopTask:                   () => this.stopTask(m.taskId),
                openBashOutput:             () => this.openBashOutput(m.content, m.title, m.toolId),
                openAgentDetail:            () => Promise.resolve(this.openAgentDetail(m.taskId)),
                openFile:                   () => Promise.resolve(this.openFile(m.filePath, m.line, m.endLine)),
                loadUsageStats:             () => this.loadUsageStats(),
                clearUsageStats:            () => this.clearUsageStats(),
                loadCronTasks:              () => this.loadCronTasks(),
                deleteCronTask:             () => this.deleteCronTask(m.id),
                enableCronTask:             () => this.enableCronTask(m.id),
                disableCronTask:            () => this.disableCronTask(m.id),
                loadDesignSkills:           () => this.loadDesignSkills(),
                refreshDesignSkills:        () => this.refreshDesignSkills(),
                loadDesignSystems:          () => this.loadDesignSystems(),
                refreshDesignSystems:       () => this.refreshDesignSystems(),
                clawLoadStatus:             () => this.clawLoadStatus(),
                clawEnable:                 () => this.clawEnable(),
                clawDisable:                () => this.clawDisable(),
                clawStartBind:              () => this.clawStartBind(),
                clawBindFeishu:             () => this.clawBindFeishu(m.appId, m.appSecret),
                clawSubmitVerifyCode:       () => Promise.resolve(this.clawCoordinator?.submitVerifyCode(m.code)),
                clawUnbind:                 () => this.clawUnbind(),
                clawSaveVerbosity:          () => this.clawSaveVerbosity(m.value),
            };
            await handlers[m.command]?.();
        });

        this.panel.onDidDispose(() => {
            if (this.mcpStatusHandler) {
                this.coreManager.getSemaCore().off('mcp:server:status', this.mcpStatusHandler);
                this.mcpStatusHandler = undefined;
            }
            if (this.cronUpdateHandler) {
                this.coreManager.getSemaCore().off('cron:update', this.cronUpdateHandler);
                this.cronUpdateHandler = undefined;
            }
            for (const unwatch of this.taskWatcherMap.values()) {
                unwatch();
            }
            this.taskWatcherMap.clear();
            this.panel = undefined;
        });
        this.loadConfig();
    }

    // ─── Core helpers ────────────────────────────────────────────────────────

    private async ensureCoreReady() {
        if (!this.coreManager) throw new Error(t('host.cfg.coreNotReady'));
        if (!await this.coreManager.waitForReady(5000)) throw new Error(t('host.cfg.coreTimeout'));
    }

    private postMessage(message: any) {
        this.panel?.webview.postMessage(message);
    }

    // ─── Claw（远程入口）────────────────────────────────────────────────────
    // 轻量：仅 fs 读 + 内存布尔，不触发懒载 chunk。占用信息只在 enable 失败时回传。

    private clawLoadStatus(): Promise<void> {
        if (this.clawCoordinator) {
            this.postMessage({ command: 'clawStatus', data: this.clawCoordinator.getStatus() });
        }
        return Promise.resolve();
    }

    private async clawEnable(): Promise<void> {
        if (!this.clawCoordinator) return;
        const res = await this.clawCoordinator.enable();
        const status = this.clawCoordinator.getStatus();
        if (res.ok) {
            this.postMessage({ command: 'clawStatus', data: status });
        } else if (res.occupiedBy) {
            this.postMessage({ command: 'clawStatus', data: { ...status, occupancy: res.occupiedBy } });
        } else {
            this.postMessage({ command: 'clawStatus', data: { ...status, error: res.error } });
        }
    }

    private async clawDisable(): Promise<void> {
        if (!this.clawCoordinator) return;
        await this.clawCoordinator.disable();
        this.postMessage({ command: 'clawStatus', data: this.clawCoordinator.getStatus() });
    }

    private async clawStartBind(): Promise<void> {
        if (!this.clawCoordinator) return;
        try {
            const { qrcodeDataUrl, message, sessionKey } = await this.clawCoordinator.startBind();
            this.postMessage({ command: 'clawQrCode', data: { qrcodeDataUrl, message } });
            // Drive the long-poll bind in the background; report back as it progresses.
            void this.clawCoordinator.waitBind(sessionKey, {
                onVerifyCodeNeeded: () => this.postMessage({ command: 'clawVerifyCodeNeeded' }),
                onQrRefresh: (url: string) =>
                    this.postMessage({ command: 'clawQrCode', data: { qrcodeDataUrl: url, message: t('host.cfg.qrRefreshed') } }),
                onResult: (r) => {
                    this.postMessage({ command: 'clawBindResult', data: r });
                    if (this.clawCoordinator) {
                        this.postMessage({ command: 'clawStatus', data: this.clawCoordinator.getStatus() });
                    }
                },
            });
        } catch (e) {
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: String(e) } });
        }
    }

    /** 绑定飞书并立即开启长连接（点「连接飞书」一步到位）。已绑定其它平台时前端会禁用入口，这里不再二次校验。 */
    private async clawBindFeishu(appId: string, appSecret: string): Promise<void> {
        if (!this.clawCoordinator) return;
        if (!appId?.trim() || !appSecret?.trim()) {
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: t('host.cfg.feishuEmpty') } });
            return;
        }
        this.clawCoordinator.bindFeishu(appId.trim(), appSecret.trim());
        const res = await this.clawCoordinator.enable();
        const status = this.clawCoordinator.getStatus();
        if (res.ok) {
            this.postMessage({ command: 'clawBindResult', data: { connected: true, message: t('host.cfg.feishuConnected') } });
            this.postMessage({ command: 'clawStatus', data: status });
        } else if (res.occupiedBy) {
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: t('host.cfg.clawOccupied', { path: res.occupiedBy.projectPath }) } });
            this.postMessage({ command: 'clawStatus', data: { ...status, occupancy: res.occupiedBy } });
        } else {
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: res.error || t('host.cfg.connectFailed') } });
            this.postMessage({ command: 'clawStatus', data: { ...status, error: res.error } });
        }
    }

    private clawUnbind(): Promise<void> {
        if (this.clawCoordinator) {
            this.clawCoordinator.unbind();
            this.postMessage({ command: 'clawStatus', data: this.clawCoordinator.getStatus() });
        }
        return Promise.resolve();
    }

    private clawSaveVerbosity(level: any): Promise<void> {
        if (this.clawCoordinator) {
            this.clawCoordinator.setVerbosity(level);
            this.postMessage({ command: 'clawStatus', data: this.clawCoordinator.getStatus() });
        }
        return Promise.resolve();
    }

    /**
     * 通用执行模板：ensureCoreReady → fn() → postMessage(success) / postMessage(error)
     * @param resultCommand  回传给 webview 的 command 名（为空则不回传）
     * @param errorMsg       vscode.showErrorMessage 前缀（为空则不弹窗）
     * @param fn             业务逻辑，返回值会合并到成功消息里
     */
    private async execute<T>(
        resultCommand: string,
        errorMsg: string,
        fn: () => Promise<T>,
        successExtra?: (data: T) => object
    ) {
        try {
            await this.ensureCoreReady();
            const data = await fn();
            if (resultCommand) {
                this.postMessage({ command: resultCommand, success: true, ...successExtra?.(data) });
            }
            return data;
        } catch (error) {
            const message = error instanceof Error ? error.message : t('common.unknownError');
            console.error(`Error ${errorMsg}:`, error);
            const text = t('host.cfg.opFailed', { op: errorMsg, error: message });
            if (resultCommand) {
                this.postMessage({ command: resultCommand, success: false, message: text });
            }
            if (errorMsg) {
                vscode.window.showErrorMessage(text);
            }
        }
    }

    private async confirm(msg: string, confirmLabel = t('common.ok')) {
        return await vscode.window.showWarningMessage(msg, { modal: true }, confirmLabel) === confirmLabel;
    }

    public refreshConfigPage() {
        if (this.panel) this.loadConfig();
    }

    /**
     * 新会话通知：core 建会话会重扫插件并级联刷新 skills/agents/commands/MCP/hooks，
     * 配置页停在扩展的那几个子页时列表已过期。这里只发信号，由页面按当前所在子页自行重拉。
     */
    public notifySessionCreated(): void {
        if (this.panel) this.postMessage({ command: 'sessionCreated' });
    }

    // ─── Models ───────────────────────────────────────────────────────────────

    private async loadConfig() {
        try {
            await this.ensureCoreReady();
            const modelData = await this.coreManager.getModelData();
            this.postMessage({ command: 'loadConfig', data: modelData, showAddPage: !modelData?.modelList?.length });
        } catch {
            this.postMessage({ command: 'loadConfig', data: null, showAddPage: true });
        }
        if (this.pendingPage) {
            this.navigateTo(this.pendingPage, this.pendingTaskId);
            this.pendingPage = undefined;
            this.pendingTaskId = undefined;
        }
    }

    private async saveConfig(data: any) {
        const { provider, modelName, baseURL, apiKey, maxTokens, contextLength, adapt, thinkingHistoryPolicy, isEdit } = data;
        await this.execute('saveResult', isEdit ? t('host.cfg.op.saveModel') : t('host.cfg.op.addModel'), async () => {
            // 编辑与新增走同一接口：core 对同名 (provider, modelName) 原地覆盖，指针与会话覆盖不受影响
            await this.coreManager.addModel({
                provider, modelName, baseURL, apiKey, maxTokens, contextLength,
                ...(adapt && { adapt }),
                ...(thinkingHistoryPolicy && { thinkingHistoryPolicy })
            }, true);
            this.postMessage({ command: 'saveResult', success: true, message: isEdit ? t('host.cfg.modelSaved') : t('host.cfg.modelAdded') });
            this.loadConfig();
        });
    }

    private async toggleModelActive(_provider: string, modelName: string) {
        await this.execute('', t('host.cfg.op.switchModel'), async () => {
            await this.coreManager.switchModel(modelName);
            this.loadConfig();
        });
    }

    /** 任务配置下拉选完即落盘；失败时 execute 弹错，随后 loadConfig 让前端状态回滚 */
    private async confirmTaskConfig(data: { main: string; quick: string }) {
        await this.execute('', t('host.cfg.op.updateTask'), async () => {
            await this.coreManager.applyTaskModel(data);
            this.loadConfig();
        });
    }

    private async deleteModel(_provider: string, modelName: string) {
        if (!await this.confirm(t('host.cfg.deleteModelConfirm', { name: modelName }), t('common.delete'))) return;
        await this.execute('deleteResult', t('host.cfg.op.deleteModel'), async () => {
            await this.coreManager.deleteModel(modelName);
            this.postMessage({ command: 'deleteResult', success: true, message: t('host.cfg.modelDeleted') });
            this.loadConfig();
        });
    }

    private async fetchModels(data: { provider: string; baseURL: string; apiKey: string; adapt: 'openai' | 'anthropic'; modelsUrl?: string }) {
        try {
            await this.ensureCoreReady();
            const result = await this.coreManager.fetchAvailableModels(data);
            this.postMessage({
                command: 'modelsResult', success: result.success,
                models: result.models || [],
                message: result.success
                    ? (result.message || t('host.cfg.fetchModelsOk'))
                    : `${result.message || t('host.cfg.fetchModelsFailed')}${result.curlCommand ? '\n' + t('host.cfg.debugCommand') + result.curlCommand : ''}`
            });
        } catch (error) {
            this.postMessage({ command: 'modelsResult', success: false, models: [], message: `${t('host.cfg.fetchModelsFailed')}: ${(error as Error).message}` });
        }
    }

    private getModelAdapter(provider: string, modelName: string, baseURL: string) {
        try {
            this.postMessage({ command: 'modelAdapterResult', adapter: this.coreManager.getModelAdapter(provider, modelName, baseURL) ?? null });
        } catch { /* 静默失败 */ }
    }

    /** 编辑模型：取完整落盘配置回灌给配置页，由 App 切到新增页并回填表单 */
    private async getModelProfile(provider: string, modelName: string) {
        await this.execute('', t('host.cfg.op.readModel'), async () => {
            const profile = this.coreManager.getModelProfile(provider, modelName);
            if (!profile) throw new Error(t('host.cfg.modelNotExist', { name: `${modelName}[${provider}]` }));
            this.postMessage({ command: 'modelProfileResult', profile });
        });
    }

    private async testConnection(data: any) {
        try {
            await this.ensureCoreReady();
            const result = await this.coreManager.testApiConnection(data);
            this.postMessage({
                command: 'testResult', success: result.success,
                message: result.success ? t('host.cfg.testOk') : `${result.message}\n${t('host.cfg.debugCommand')}${result.curlCommand}` || t('host.cfg.testFailed')
            });
        } catch (error) {
            this.postMessage({ command: 'testResult', success: false, message: t('host.cfg.testError', { error: (error as Error).message }) });
        }
    }

    // ─── System config ────────────────────────────────────────────────────────

    private async loadSystemConfig() {
        await this.execute('loadSystemConfigResult', t('host.cfg.op.loadSystem'), async () => {
            const data = this.coreManager.getSystemConfig();
            this.postMessage({ command: 'loadSystemConfigResult', success: true, data, platform: process.platform });
        });
    }

    private async saveSystemConfig(data: any) {
        await this.execute('saveSystemConfigResult', t('host.cfg.op.saveSystem'), async () => {
            await this.coreManager.updateSystemConfig(data);
            this.postMessage({ command: 'saveSystemConfigResult', success: true, message: t('host.cfg.systemSaved') });
        });
    }

    private async saveSystemConfigByKey(key: string, value: any) {
        await this.execute('saveSystemConfigByKeyResult', t('host.cfg.op.saveSystem'), async () => {
            // 扩展端本地字段（见 LOCAL_SYSTEM_CONFIG_KEYS）不应推给 sema-core
            if (LOCAL_SYSTEM_CONFIG_KEYS.has(key)) {
                await this.coreManager.saveLocalSystemConfigByKey(key, value);
            } else {
                await this.coreManager.updateSystemConfigByKey(key, value);
            }
            if (key === 'lang' && this.panel) this.panel.title = t('host.cfg.panelTitle');
            this.postMessage({ command: 'saveSystemConfigByKeyResult', success: true, key, value, message: t('host.cfg.configSaved') });
            this.onSystemConfigChanged?.(key, value);
        });
    }

    private async resetSystemConfig() {
        if (!await this.confirm(t('host.cfg.resetConfirm'), t('host.cfg.resetLabel'))) return;
        await this.execute('resetSystemConfigResult', t('host.cfg.op.resetSystem'), async () => {
            // 重置不改界面语言：lang 保留当前值，customRules 取当前语言对应的默认规则，其余字段回默认。
            // enableBrowserControl 只允许由 BrowserControlManager 在动作成功后写入，重置时保留当前值，避免键与实际 skill/MCP 状态脱节
            const current = this.coreManager.getSystemConfig() as Record<string, any>;
            const lang = normalizeLang(current.lang);
            const resetConfig = {
                ...defaultConfig, lang, customRules: DEFAULT_CUSTOM_RULES[lang],
                enableBrowserControl: !!current.enableBrowserControl
            };
            await this.coreManager.updateSystemConfig(resetConfig);
            this.postMessage({ command: 'resetSystemConfigResult', success: true, data: resetConfig, message: t('host.cfg.systemReset') });
            this.onSystemConfigChanged?.('skipFileEditPermission', defaultConfig.skipFileEditPermission);
            this.onSystemConfigChanged?.('thinking', defaultConfig.thinking);
            this.onSystemConfigChanged?.('showThinkingText', defaultConfig.showThinkingText);
            this.onSystemConfigChanged?.('enablePet', defaultConfig.enablePet);
        });
    }

    // ─── Browser control ─────────────────────────────────────────────────────

    /**
     * 浏览器控制开关：由 BrowserControlManager 串行执行补齐/删除 skill 与 MCP，成功后才落 enableBrowserControl。
     * 回传 enabled：成功为目标值，失败为原值（页面据此回弹）。
     */
    private async setBrowserControl(enabled: boolean) {
        const previous = !!(this.coreManager.getSystemConfig() as Record<string, any>)?.enableBrowserControl;
        try {
            await this.ensureCoreReady();
            if (!this.browserControl) throw new Error(t('host.cfg.coreNotReady'));
            const result = await this.browserControl.setEnabled(enabled);
            this.postMessage({ command: 'setBrowserControlResult', success: true, enabled: result });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('common.unknownError');
            console.error('Error setBrowserControl:', error);
            const text = t('host.cfg.opFailed', { op: t('host.cfg.op.browserControl'), error: message });
            this.postMessage({ command: 'setBrowserControlResult', success: false, enabled: previous, message: text });
            vscode.window.showErrorMessage(text);
        }
    }

    // ─── Tools ────────────────────────────────────────────────────────────────

    private async loadSystemTools() {
        try {
            await this.ensureCoreReady();
            this.postMessage({ command: 'loadSystemToolsResult', success: true, data: this.coreManager.getToolInfos() });
        } catch (error) {
            this.postMessage({ command: 'loadSystemToolsResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async updateDisabledTools(disabledTools: string[] | null) {
        await this.execute('updateDisabledToolsResult', t('host.cfg.op.updateTools'), async () => {
            await this.coreManager.updateDisabledTools(disabledTools);
            this.postMessage({ command: 'updateDisabledToolsResult', success: true, message: t('host.cfg.toolsUpdated') });
        });
    }

    // ─── Plugins / Marketplace ───────────────────────────────────────────────

    private async loadPluginConfig() {
        try {
            await this.ensureCoreReady();
            const pluginsInfo = await this.coreManager.getMarketplacePluginsInfo();     
            // console.log('[loadPluginsInfo] data:', pluginsInfo);
            this.postMessage({ command: 'loadPluginConfigResult', success: true, data: pluginsInfo });
        } catch (error) {
            this.postMessage({ command: 'loadPluginConfigResult', success: false, data: { marketplaces: [], plugins: [] }, message: (error as Error).message });
        }
    }

    private async refreshPluginConfig() {
        await this.execute('refreshPluginConfigResult', t('host.cfg.op.refreshPlugin'), async () => {
            const data = await this.coreManager.refreshMarketplacePluginsInfo();
            this.postMessage({ command: 'refreshPluginConfigResult', success: true, data });
        });
    }

    private async installPlugin(pluginName: string, marketplaceName: string, scope: string, key: string) {
        await this.execute('installPluginResult', t('host.cfg.op.installPlugin'), async () => {
            const data = await this.coreManager.installPlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'installPluginResult', success: true, key, data });
        });
    }

    private async uninstallPlugin(pluginName: string, marketplaceName: string, scope: string, key: string) {
        if (!await this.confirm(t('host.cfg.uninstallPluginConfirm', { name: pluginName }), t('host.cfg.uninstallLabel'))) {
            this.postMessage({ command: 'uninstallPluginResult', success: false, key, cancelled: true });
            return;
        }
        await this.execute('uninstallPluginResult', t('host.cfg.op.uninstallPlugin'), async () => {
            const data = await this.coreManager.uninstallPlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'uninstallPluginResult', success: true, key, data });
        });
    }

    private async enablePlugin(pluginName: string, marketplaceName: string, scope: string) {
        await this.execute('enablePluginResult', t('host.cfg.op.enablePlugin'), async () => {
            const data = await this.coreManager.enablePlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'enablePluginResult', success: true, data });
        });
    }

    private async disablePlugin(pluginName: string, marketplaceName: string, scope: string) {
        await this.execute('disablePluginResult', t('host.cfg.op.disablePlugin'), async () => {
            const data = await this.coreManager.disablePlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'disablePluginResult', success: true, data });
        });
    }

    private async updateMarketplace(marketplaceName: string) {
        await this.execute('updateMarketplaceResult', t('host.cfg.op.updateMarket'), async () => {
            const data = await this.coreManager.updateMarketplace(marketplaceName);
            this.postMessage({ command: 'updateMarketplaceResult', success: true, name: marketplaceName, data });
        });
    }

    private async removeMarketplace(marketplaceName: string) {
        if (!await this.confirm(t('host.cfg.removeMarketConfirm', { name: marketplaceName }), t('host.cfg.removeLabel'))) {
            this.postMessage({ command: 'removeMarketplaceResult', success: false, name: marketplaceName, cancelled: true });
            return;
        }
        await this.execute('removeMarketplaceResult', t('host.cfg.op.removeMarket'), async () => {
            const data = await this.coreManager.removeMarketplace(marketplaceName);
            this.postMessage({ command: 'removeMarketplaceResult', success: true, name: marketplaceName, data });
        });
    }

    private async addMarketplace(type: 'github' | 'directory', value: string) {
        await this.execute('addMarketplaceResult', t('host.cfg.op.addMarket'), async () => {
            const data = type === 'github'
                ? await this.coreManager.addMarketplaceFromGit(value)
                : await this.coreManager.addMarketplaceFromDirectory(value);
            this.postMessage({ command: 'addMarketplaceResult', success: true, data });
        });
    }

    // ─── Agents ───────────────────────────────────────────────────────────────

    private async loadAgentsInfo() {
        try {
            await this.ensureCoreReady();
            const agentsInfo = await this.coreManager.getAgentsInfo();
            // console.log('[loadAgentsInfo] data:', agentsInfo);
            this.postMessage({ command: 'loadAgentsInfoResult', success: true, data: agentsInfo });
        } catch (error) {
            this.postMessage({ command: 'loadAgentsInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async refreshAgentsInfo() {
        try {
            await this.ensureCoreReady();
            this.postMessage({ command: 'refreshAgentsInfoResult', success: true, data: await this.coreManager.getAgentsInfo(true) });
        } catch (error) {
            this.postMessage({ command: 'refreshAgentsInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async addAgent(data: Omit<AgentConfig, 'locate'> & { locate: 'project' | 'user' }) {
        await this.execute('addAgentResult', t('host.cfg.op.createAgent'), async () => {
            const agents = await this.coreManager.addAgentConf(data);
            this.postMessage({ command: 'addAgentResult', success: true, message: t('host.cfg.agentCreated'), data: agents });
        });
    }

    private async removeAgent(name: string) {
        if (!await this.confirm(t('host.cfg.deleteAgentConfirm', { name }), t('common.delete'))) return;
        await this.execute('removeAgentResult', t('host.cfg.op.deleteAgent'), async () => {
            const agents = await this.coreManager.removeAgentConf(name);
            this.postMessage({ command: 'removeAgentResult', success: true, message: t('host.cfg.agentDeleted'), data: agents });
        });
    }

    // ─── Skills ───────────────────────────────────────────────────────────────

    private async loadSkillsInfo() {
        try {
            await this.ensureCoreReady();
            const skillsInfo = await this.coreManager.getSkillsInfo();
            // console.log('[loadSkillsInfo] data:', skillsInfo);
            this.postMessage({ command: 'loadSkillsInfoResult', success: true, data: skillsInfo });
        } catch (error) {
            this.postMessage({ command: 'loadSkillsInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async refreshSkillsInfo() {
        try {
            await this.ensureCoreReady();
            this.postMessage({ command: 'refreshSkillsInfoResult', success: true, data: await this.coreManager.getSkillsInfo(true) });
        } catch (error) {
            this.postMessage({ command: 'refreshSkillsInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async removeSkill(name: string) {
        if (!await this.confirm(t('host.cfg.deleteSkillConfirm', { name }), t('common.delete'))) return;
        await this.execute('removeSkillResult', t('host.cfg.op.deleteSkill'), async () => {
            const skills = await this.coreManager.removeSkillConf(name);
            this.postMessage({ command: 'removeSkillResult', success: true, message: t('host.cfg.skillDeleted'), data: skills });
        });
    }

    private async toggleSkill(name: string, enabled: boolean) {
        // 写入哪层 settings 由 core 按技能所在层决定
        // 成功消息由 execute 统一发送（successExtra 挂 data），fn 里不要再 postMessage，否则会多发一条无 data 的成功消息
        await this.execute(
            'toggleSkillResult',
            enabled ? t('host.cfg.op.enableSkill') : t('host.cfg.op.disableSkill'),
            async () => (enabled ? await this.coreManager.enableSkill(name) : await this.coreManager.disableSkill(name)),
            (data) => ({ data }),
        );
    }

    // ─── Skill 市场（内置资源目录） ──────────────────────────────────────────

    private get workspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /** 目录列表是纯本地扫描，不依赖 core，同步返回 */
    private loadSkillCatalog() {
        try {
            this.postMessage({ command: 'loadSkillCatalogResult', success: true, data: this.skillCatalog!.listCatalog(this.workspaceRoot) });
        } catch (error) {
            this.postMessage({ command: 'loadSkillCatalogResult', success: false, data: [], message: (error as Error).message });
        }
    }

    /** 安装后一并带回最新目录与已安装 skills，页面不用再发两次请求 */
    private async installCatalogSkill(id: string, scope: CatalogScope) {
        await this.execute(
            'installCatalogSkillResult',
            t('host.cfg.op.installSkill'),
            async () => {
                const catalog = this.skillCatalog!;
                const r = await catalog.install(id, scope, false, this.workspaceRoot);
                if (r !== true) {
                    const name = catalog.listCatalog().find(s => s.id === id)?.name || id;
                    if (!await this.confirm(t('host.cfg.confirmOverwriteSkill', { name }), t('host.cfg.overwrite'))) return { cancelled: true };
                    await catalog.install(id, scope, true, this.workspaceRoot);
                }
                return { skills: await this.coreManager.getSkillsInfo(true), catalog: catalog.listCatalog(this.workspaceRoot) };
            },
            (r) => ({ id, scope, ...r }),
        );
    }

    private async uninstallCatalogSkill(id: string) {
        await this.execute(
            'uninstallCatalogSkillResult',
            t('host.cfg.op.uninstallSkill'),
            async () => {
                const catalog = this.skillCatalog!;
                const name = catalog.listCatalog().find(s => s.id === id)?.name || id;
                if (!await this.confirm(t('host.cfg.confirmUninstallSkill', { name }), t('config.skill.uninstall'))) return { cancelled: true };
                const skillName = catalog.uninstall(id, this.workspaceRoot);
                // 清掉禁用残留，否则重装后开关显示开、实际仍禁用；失败不阻塞卸载
                try { await this.coreManager.enableSkill(skillName); } catch { /* ignore */ }
                return { skills: await this.coreManager.getSkillsInfo(true), catalog: catalog.listCatalog(this.workspaceRoot) };
            },
            (r) => ({ id, ...r }),
        );
    }

    // ─── Hooks ────────────────────────────────────────────────────────────────

    private async loadHooksInfo() {
        try {
            await this.ensureCoreReady();
            const hooksInfo = await this.coreManager.getHooksInfo();
            console.log('[loadHooksInfo] data:', hooksInfo);
            this.postMessage({ command: 'loadHooksInfoResult', success: true, data: hooksInfo });
        } catch (error) {
            this.postMessage({ command: 'loadHooksInfoResult', success: false, data: null, message: (error as Error).message });
        }
    }

    private async refreshHooksInfo() {
        try {
            await this.ensureCoreReady();
            this.postMessage({ command: 'refreshHooksInfoResult', success: true, data: await this.coreManager.getHooksInfo(true) });
        } catch (error) {
            this.postMessage({ command: 'refreshHooksInfoResult', success: false, data: null, message: (error as Error).message });
        }
    }

    // ─── Commands ─────────────────────────────────────────────────────────────

    private async loadCommandsInfo() {
        try {
            await this.ensureCoreReady();
            const commandsInfo = await this.coreManager.getCommandsInfo();
            // console.log('[loadCommandsInfo] data:', commandsInfo);
            this.postMessage({ command: 'loadCommandsInfoResult', success: true, data: commandsInfo });
        } catch (error) {
            this.postMessage({ command: 'loadCommandsInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async refreshCommandsInfo() {
        try {
            await this.ensureCoreReady();
            this.postMessage({ command: 'refreshCommandsInfoResult', success: true, data: await this.coreManager.getCommandsInfo(true) });
        } catch (error) {
            this.postMessage({ command: 'refreshCommandsInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async addCommand(data: Omit<CommandConfig, 'locate'> & { locate: 'project' | 'user' }) {
        await this.execute('addCommandResult', t('host.cfg.op.createCommand'), async () => {
            const commands = await this.coreManager.addCommandConf(data);
            this.postMessage({ command: 'addCommandResult', success: true, message: t('host.cfg.commandCreated'), data: commands });
        });
    }

    private async removeCommand(name: string) {
        if (!await this.confirm(t('host.cfg.deleteCommandConfirm', { name }), t('common.delete'))) return;
        await this.execute('removeCommandResult', t('host.cfg.op.deleteCommand'), async () => {
            const commands = await this.coreManager.removeCommandConf(name);
            this.postMessage({ command: 'removeCommandResult', success: true, message: t('host.cfg.commandDeleted'), data: commands });
        });
    }

    // ─── MCP ─────────────────────────────────────────────────────────────────

    private async loadMCPServerInfo() {
        try {
            await this.ensureCoreReady();
            const MCPServerInfo = await this.coreManager.getMCPServerInfo();
            // console.log('[loadMCPServerInfo] data:', MCPServerInfo);
            this.postMessage({ command: 'loadMCPServerInfoResult', success: true, data: MCPServerInfo });
        } catch (error) {
            this.postMessage({ command: 'loadMCPServerInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async refreshMCPServerInfo() {
        try {
            await this.ensureCoreReady();
            const MCPServerInfo = await this.coreManager.refreshMCPServerInfo();
            this.postMessage({ command: 'refreshMCPServerInfoResult', success: true, data: MCPServerInfo });
        } catch (error) {
            this.postMessage({ command: 'refreshMCPServerInfoResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async addMCPServer(data: any) {
        await this.execute('addMCPServerResult', t('host.cfg.op.addMcp'), async () => {
            const servers = await this.coreManager.addMCPServer(data);
            this.postMessage({ command: 'addMCPServerResult', success: true, message: t('host.cfg.mcpAdded'), data: servers });
        });
    }

    private async removeMCPServer(name: string) {
        if (!await this.confirm(t('host.cfg.deleteMcpConfirm', { name }), t('common.delete'))) return;
        await this.execute('removeMCPServerResult', t('host.cfg.op.deleteMcp'), async () => {
            const servers = await this.coreManager.removeMCPServer(name);
            this.postMessage({ command: 'removeMCPServerResult', success: true, message: t('host.cfg.mcpDeleted'), data: servers });
        });
    }

    private async reconnectMCPServer(name: string) {
        await this.execute('reconnectMCPServerResult', t('host.cfg.op.reconnectMcp'), async () => {
            const servers = await this.coreManager.reconnectMCPServer(name);
            this.postMessage({ command: 'reconnectMCPServerResult', success: true, message: t('host.cfg.mcpReconnected'), data: servers });
        });
    }

    private async disableMCPServer(name: string) {
        await this.execute('disableMCPServerResult', t('host.cfg.op.disableMcp'), async () => {
            const servers = await this.coreManager.disableMCPServer(name);
            this.postMessage({ command: 'disableMCPServerResult', success: true, data: servers });
        });
    }

    private async enableMCPServer(name: string) {
        await this.execute('enableMCPServerResult', t('host.cfg.op.enableMcp'), async () => {
            const servers = await this.coreManager.enableMCPServer(name);
            this.postMessage({ command: 'enableMCPServerResult', success: true, data: servers });
        });
    }

    private async updateMCPUseTools(name: string, toolNames: string[]) {
        await this.execute('updateMCPUseToolsResult', t('host.cfg.op.updateMcpTools'), async () => {
            const servers = await this.coreManager.updateMCPUseTools(name, toolNames);
            this.postMessage({ command: 'updateMCPUseToolsResult', success: true, message: t('host.cfg.toolsUpdated'), data: servers });
        });
    }

    // ─── 导入（从 Claude Code / Codex / Cursor）──────────────────────────────
    // 读三家配置用 Node fs；写入走 core 公开 API 或直接落盘，逻辑全在 import/importer.ts（与 JB 共用）。

    private importRoots(): ImportRoots {
        return { home: os.homedir(), project: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, sep: path.sep };
    }

    private async importDetectSources() {
        try {
            const data = await detectSources(nodeImportFs, this.importRoots());
            this.postMessage({ command: 'importDetectSourcesResult', success: true, data });
        } catch (error) {
            this.postMessage({ command: 'importDetectSourcesResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async importPreview(source: ImportSource) {
        try {
            await this.ensureCoreReady();
            const data = await previewImport(nodeImportFs, this.importRoots(), this.coreManager, source);
            this.postMessage({ command: 'importPreviewResult', success: true, source, data });
        } catch (error) {
            this.postMessage({ command: 'importPreviewResult', success: false, source, message: (error as Error).message });
        }
    }

    private async importExecute(source: ImportSource, items: ImportItem[]) {
        // 成功消息由 execute 统一发送（successExtra 挂 source / data），fn 里不要再 postMessage
        await this.execute(
            'importExecuteResult',
            t('host.cfg.op.import'),
            () => executeImport(nodeImportFs, this.importRoots(), this.coreManager, items ?? []),
            (data) => ({ source, data }),
        );
    }

    // ─── Memory ───────────────────────────────────────────────────────────────

    private async loadMemoryInfo() {
        try {
            await this.ensureCoreReady();
            const memoryInfo = await this.coreManager.getMemoryInfo();
            // console.log('[loadMemoryInfo] data:', memoryInfo);
            this.postMessage({ command: 'loadMemoryInfoResult', success: true, data: memoryInfo });
        } catch (error) {
            this.postMessage({ command: 'loadMemoryInfoResult', success: false, data: null, message: (error as Error).message });
        }
    }

    private async refreshMemoryInfo() {
        try {
            await this.ensureCoreReady();
            const memoryInfo = await this.coreManager.getMemoryInfo(true);
            this.postMessage({ command: 'refreshMemoryInfoResult', success: true, data: memoryInfo });
        } catch (error) {
            this.postMessage({ command: 'refreshMemoryInfoResult', success: false, data: null, message: (error as Error).message });
        }
    }

    // ─── Rule ───────────────────────────────────────────────────────────────

    private async loadRuleInfo() {
        try {
            await this.ensureCoreReady();
            const ruleInfo = await this.coreManager.getRuleInfo();
            // console.log('[loadRuleInfo] data:', ruleInfo);
            this.postMessage({ command: 'loadRuleInfoResult', success: true, data: ruleInfo });
        } catch (error) {
            this.postMessage({ command: 'loadRuleInfoResult', success: false, data: null, message: (error as Error).message });
        }
    }

    private async refreshRuleInfo() {
        try {
            await this.ensureCoreReady();
            const ruleInfo = await this.coreManager.getRuleInfo(true);
            this.postMessage({ command: 'refreshRuleInfoResult', success: true, data: ruleInfo });
        } catch (error) {
            this.postMessage({ command: 'refreshRuleInfoResult', success: false, data: null, message: (error as Error).message });
        }
    }

    // ─── Task (后台任务) ──────────────────────────────────────────────────────

    private async loadTaskList() {
        try {
            await this.ensureCoreReady();
            const list = this.coreManager.getTaskList();
            console.log('[loadTaskList] data:', list);
            this.postMessage({ command: 'loadTaskListResult', success: true, data: list });
        } catch (error) {
            this.postMessage({ command: 'loadTaskListResult', success: false, data: [], message: (error as Error).message });
        }
    }

    public pushTaskStart(data: any) {
        this.postMessage({ command: 'taskStart', data });
    }

    public pushTaskEnd(data: any) {
        this.postMessage({ command: 'taskEnd', data });
    }

    public navigateTo(page: string, taskId?: string) {
        this.postMessage({ command: 'navigateTo', page, taskId });
    }

    private async watchTask(taskId: string) {
        if (this.taskWatcherMap.has(taskId)) return;
        try {
            await this.ensureCoreReady();
            const unwatch = this.coreManager.watchTask(taskId, (delta: string) => {
                this.postMessage({ command: 'taskDelta', taskId, delta });
            });
            this.taskWatcherMap.set(taskId, unwatch);
        } catch (error) {
            this.postMessage({ command: 'watchTaskError', taskId, message: (error as Error).message });
        }
    }

    private unwatchTask(taskId: string) {
        const unwatch = this.taskWatcherMap.get(taskId);
        if (unwatch) {
            unwatch();
            this.taskWatcherMap.delete(taskId);
        }
    }

    private async stopTask(taskId: string) {
        await this.execute('stopTaskResult', t('host.cfg.op.stopTask'), async () => {
            this.coreManager.stopTask(taskId);
            this.unwatchTask(taskId);
            this.postMessage({ command: 'stopTaskResult', success: true, taskId });
        });
    }

    // ─── 使用统计 ────────────────────────────────────────────────────────────
    // 数据由 core 采集落盘；页面每次进入拉一次逐日聚合，时间范围求和在页面做。

    private async loadUsageStats() {
        try {
            await this.ensureCoreReady();
            const data = await this.coreManager.getUsageStats();
            this.postMessage({ command: 'loadUsageStatsResult', success: true, data });
        } catch (error) {
            this.postMessage({ command: 'loadUsageStatsResult', success: false, message: (error as Error).message });
        }
    }

    private async clearUsageStats() {
        if (!await this.confirm(t('config.usage.clearConfirm'), t('config.usage.clearOk'))) {
            this.postMessage({ command: 'clearUsageStatsResult', success: false, cancelled: true });
            return;
        }
        await this.execute('clearUsageStatsResult', t('host.cfg.op.clearUsage'), () => this.coreManager.clearUsageStats());
    }

    // ─── Cron Tasks ─────────────────────────────────────────────────────────

    private async loadCronTasks() {
        await this.execute('', t('host.cfg.op.loadCron'), async () => {
            const data = await this.coreManager.getCronTasks();
            // console.log('[loadCronTasks] data:', data);
            this.postMessage({ command: 'loadCronTasksResult', success: true, data });
        });
    }

    private async deleteCronTask(id: string) {
        await this.execute('', t('host.cfg.op.deleteCron'), async () => {
            const success = this.coreManager.deleteCronTask(id);
            this.postMessage({ command: 'deleteCronTaskResult', success, id });
        });
    }

    private async enableCronTask(id: string) {
        await this.execute('', t('host.cfg.op.enableCron'), async () => {
            const success = this.coreManager.enableCronTask(id);
            this.postMessage({ command: 'enableCronTaskResult', success, id });
        });
    }

    private async disableCronTask(id: string) {
        await this.execute('', t('host.cfg.op.disableCron'), async () => {
            const success = this.coreManager.disableCronTask(id);
            this.postMessage({ command: 'disableCronTaskResult', success, id });
        });
    }

    // ─── Design ──────────────────────────────────────────────────────────────

    private async loadDesignSkills() {
        try {
            await this.ensureCoreReady();
            const data = await this.coreManager.getDesignSkillsInfo(false);
            // console.log('[loadDesignSkills] data:', data);
            this.postMessage({ command: 'loadDesignSkillsResult', success: true, data });
        } catch (error) {
            this.postMessage({ command: 'loadDesignSkillsResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async refreshDesignSkills() {
        try {
            await this.ensureCoreReady();
            const data = await this.coreManager.getDesignSkillsInfo(true);
            this.postMessage({ command: 'refreshDesignSkillsResult', success: true, data });
        } catch (error) {
            this.postMessage({ command: 'refreshDesignSkillsResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async loadDesignSystems() {
        try {
            await this.ensureCoreReady();
            const data = await this.coreManager.getDesignSystemsInfo(false);
            // console.log('[loadDesignSystems] data:', data);
            this.postMessage({ command: 'loadDesignSystemsResult', success: true, data });
        } catch (error) {
            this.postMessage({ command: 'loadDesignSystemsResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async refreshDesignSystems() {
        try {
            await this.ensureCoreReady();
            const data = await this.coreManager.getDesignSystemsInfo(true);
            this.postMessage({ command: 'refreshDesignSystemsResult', success: true, data });
        } catch (error) {
            this.postMessage({ command: 'refreshDesignSystemsResult', success: false, data: [], message: (error as Error).message });
        }
    }

    // ─── Utils ────────────────────────────────────────────────────────────────

    private openAgentDetail(taskId: string): void {
        this.coreManager.openAgentDetail(taskId);
    }

    private async openBashOutput(content: string, title: string, toolId?: string) {
        if (this.fileOperationManager) {
            await this.fileOperationManager.openBashOutputAsDocument(content, title, toolId);
        }
    }

    private openFile(filePath: string, line?: number, endLine?: number) {
        if (!filePath) return;
        if (this.fileOperationManager && (line || endLine)) {
            this.fileOperationManager.openFileAtLine(filePath, line || 1, endLine);
        } else {
            vscode.workspace.openTextDocument(filePath).then(
                doc => vscode.window.showTextDocument(doc),
                err => vscode.window.showErrorMessage(t('host.cfg.openFileFailed', { error: (err as Error).message }))
            );
        }
    }

    private openExternalUrl(url: string) {
        if (url) vscode.env.openExternal(vscode.Uri.parse(url));
    }

    // ─── HTML ─────────────────────────────────────────────────────────────────

    private getHtmlContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'config.js'));
        return `<!DOCTYPE html>
<html lang="${getLang()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src ${webview.cspSource}; img-src data:;">
    <title>${t('host.cfg.panelTitle')}</title>
</head>
<body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
