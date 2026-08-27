import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { defaultConfig } from './default/defaultConfig';
import { skillHubConfig } from './default/defaultSkillHub';
import { AgentConfig } from './types/agent';
import { CommandConfig } from './types/command';
import type { ClawCoordinator } from '../../claw/coordinator';

export class ConfigWebviewProvider {
    private panel?: vscode.WebviewPanel;
    private coreManager: any;
    private fileOperationManager: any;
    private clawCoordinator?: ClawCoordinator;
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

    public show(extensionUri: vscode.Uri, page?: string, taskId?: string) {
        this.pendingPage = page;
        this.pendingTaskId = taskId;
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            this.navigateTo(page || 'models', taskId);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'semaConfig', 'Code Agent 配置', vscode.ViewColumn.One,
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
                updateModelPointer:         () => this.updateModelPointer(m.pointer, m.modelName),
                confirmTaskConfig:          () => this.confirmTaskConfig(m.data),
                testConnection:             () => this.testConnection(m.data),
                deleteModel:                () => this.deleteModel(m.provider, m.modelName),
                fetchModels:                () => this.fetchModels(m.data),
                loadSystemConfig:           () => this.loadSystemConfig(),
                saveSystemConfig:           () => this.saveSystemConfig(m.data),
                saveSystemConfigByKey:      () => this.saveSystemConfigByKey(m.key, m.value),
                resetSystemConfig:          () => this.resetSystemConfig(),
                openExternal:               () => Promise.resolve(this.openExternalUrl(m.url)),
                loadSystemTools:            () => this.loadSystemTools(),
                updateDisabledTools:        () => this.updateDisabledTools(m.disabledTools),
                getModelAdapter:            () => Promise.resolve(this.getModelAdapter(m.provider, m.modelName, m.baseURL)),
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
                searchSkillHub:             () => this.searchSkillHub(m.query),
                installSkillFromHub:        () => this.installSkillFromHub(m.slug, m.scope),
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
        if (!this.coreManager) throw new Error('SemaCore 未初始化');
        if (!await this.coreManager.waitForReady(5000)) throw new Error('SemaCore 初始化超时');
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
                    this.postMessage({ command: 'clawQrCode', data: { qrcodeDataUrl: url, message: '二维码已刷新，请重新扫描' } }),
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
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: 'App ID 和 App Secret 不能为空' } });
            return;
        }
        this.clawCoordinator.bindFeishu(appId.trim(), appSecret.trim());
        const res = await this.clawCoordinator.enable();
        const status = this.clawCoordinator.getStatus();
        if (res.ok) {
            this.postMessage({ command: 'clawBindResult', data: { connected: true, message: '已连接飞书' } });
            this.postMessage({ command: 'clawStatus', data: status });
        } else if (res.occupiedBy) {
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: `claw 正在『${res.occupiedBy.projectPath}』使用中` } });
            this.postMessage({ command: 'clawStatus', data: { ...status, occupancy: res.occupiedBy } });
        } else {
            this.postMessage({ command: 'clawBindResult', data: { connected: false, message: res.error || '连接失败' } });
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
            const message = error instanceof Error ? error.message : '未知错误';
            console.error(`Error ${errorMsg}:`, error);
            if (resultCommand) {
                this.postMessage({ command: resultCommand, success: false, message: `${errorMsg}失败：${message}` });
            }
            if (errorMsg) {
                vscode.window.showErrorMessage(`${errorMsg}失败：${message}`);
            }
        }
    }

    private async confirm(msg: string, confirmLabel = '确定') {
        return await vscode.window.showWarningMessage(msg, { modal: true }, confirmLabel) === confirmLabel;
    }

    public refreshConfigPage() {
        if (this.panel) this.loadConfig();
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
        const { provider, modelName, baseURL, apiKey, maxTokens, contextLength, adapt } = data;
        await this.execute('saveResult', '添加模型配置', async () => {
            await this.coreManager.addModel({ provider, modelName, baseURL, apiKey, maxTokens, contextLength, ...(adapt && { adapt }) }, true);
            this.postMessage({ command: 'saveResult', success: true, message: '模型配置已添加！' });
            this.loadConfig();
        });
    }

    private async toggleModelActive(_provider: string, modelName: string) {
        await this.execute('', '切换模型', async () => {
            await this.coreManager.switchModel(modelName);
            this.loadConfig();
        });
    }

    private async updateModelPointer(pointer: string, modelName: string) {
        this.postMessage({ command: 'taskConfigChanged', pointer, modelName });
    }

    private async confirmTaskConfig(data: { main: string; quick: string }) {
        await this.execute('', '更新任务配置', async () => {
            await this.coreManager.applyTaskModel(data);
            this.postMessage({ command: 'taskConfigConfirmed' });
            this.loadConfig();
        });
    }

    private async deleteModel(_provider: string, modelName: string) {
        if (!await this.confirm(`确定要删除模型 "${modelName}" 吗？\n\n注意：如果该模型正在被任务配置使用，将无法删除。`, '删除')) return;
        await this.execute('deleteResult', '删除模型', async () => {
            await this.coreManager.deleteModel(modelName);
            this.postMessage({ command: 'deleteResult', success: true, message: '模型已删除' });
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
                    ? (result.message || '获取模型列表成功')
                    : `${result.message || '获取模型列表失败'}${result.curlCommand ? '\n调试命令: ' + result.curlCommand : ''}`
            });
        } catch (error) {
            this.postMessage({ command: 'modelsResult', success: false, models: [], message: `获取模型列表失败: ${(error as Error).message}` });
        }
    }

    private getModelAdapter(provider: string, modelName: string, baseURL: string) {
        try {
            this.postMessage({ command: 'modelAdapterResult', adapter: this.coreManager.getModelAdapter(provider, modelName, baseURL) ?? null });
        } catch { /* 静默失败 */ }
    }

    private async testConnection(data: any) {
        try {
            await this.ensureCoreReady();
            const result = await this.coreManager.testApiConnection(data);
            this.postMessage({
                command: 'testResult', success: result.success,
                message: result.success ? '✓ 连接测试成功！API 配置正确。' : `${result.message}\n调试命令: ${result.curlCommand}` || '连接测试失败'
            });
        } catch (error) {
            this.postMessage({ command: 'testResult', success: false, message: `✗ 测试失败: ${(error as Error).message}` });
        }
    }

    // ─── System config ────────────────────────────────────────────────────────

    private async loadSystemConfig() {
        await this.execute('loadSystemConfigResult', '加载系统配置', async () => {
            const data = this.coreManager.getSystemConfig();
            this.postMessage({ command: 'loadSystemConfigResult', success: true, data, platform: process.platform });
        });
    }

    private async saveSystemConfig(data: any) {
        await this.execute('saveSystemConfigResult', '保存系统配置', async () => {
            await this.coreManager.updateSystemConfig(data);
            this.postMessage({ command: 'saveSystemConfigResult', success: true, message: '系统配置已保存' });
        });
    }

    private async saveSystemConfigByKey(key: string, value: any) {
        await this.execute('saveSystemConfigByKeyResult', '保存系统配置', async () => {
            // enablePet/showThinkingText 是扩展端本地字段，不应推给 sema-core
            if (key === 'enablePet' || key === 'showThinkingText') {
                await this.coreManager.saveLocalSystemConfigByKey(key, value);
            } else {
                await this.coreManager.updateSystemConfigByKey(key, value);
            }
            this.postMessage({ command: 'saveSystemConfigByKeyResult', success: true, key, value, message: '配置已保存' });
            this.onSystemConfigChanged?.(key, value);
        });
    }

    private async resetSystemConfig() {
        if (!await this.confirm('确定要重置为默认配置吗？此操作将恢复所有系统配置', '重置')) return;
        await this.execute('resetSystemConfigResult', '重置系统配置', async () => {
            await this.coreManager.updateSystemConfig(defaultConfig);
            this.postMessage({ command: 'resetSystemConfigResult', success: true, message: '系统配置已重置' });
            this.onSystemConfigChanged?.('skipFileEditPermission', defaultConfig.skipFileEditPermission);
            this.onSystemConfigChanged?.('thinking', defaultConfig.thinking);
            this.onSystemConfigChanged?.('showThinkingText', defaultConfig.showThinkingText);
            this.onSystemConfigChanged?.('enablePet', defaultConfig.enablePet);
        });
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
        await this.execute('updateDisabledToolsResult', '更新工具配置', async () => {
            await this.coreManager.updateDisabledTools(disabledTools);
            this.postMessage({ command: 'updateDisabledToolsResult', success: true, message: '工具配置已更新' });
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
        await this.execute('refreshPluginConfigResult', '刷新插件信息', async () => {
            const data = await this.coreManager.refreshMarketplacePluginsInfo();
            this.postMessage({ command: 'refreshPluginConfigResult', success: true, data });
        });
    }

    private async installPlugin(pluginName: string, marketplaceName: string, scope: string, key: string) {
        await this.execute('installPluginResult', '安装插件', async () => {
            const data = await this.coreManager.installPlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'installPluginResult', success: true, key, data });
        });
    }

    private async uninstallPlugin(pluginName: string, marketplaceName: string, scope: string, key: string) {
        if (!await this.confirm(`确定要卸载插件 "${pluginName}" 吗？`, '卸载')) {
            this.postMessage({ command: 'uninstallPluginResult', success: false, key, cancelled: true });
            return;
        }
        await this.execute('uninstallPluginResult', '卸载插件', async () => {
            const data = await this.coreManager.uninstallPlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'uninstallPluginResult', success: true, key, data });
        });
    }

    private async enablePlugin(pluginName: string, marketplaceName: string, scope: string) {
        await this.execute('enablePluginResult', '启用插件', async () => {
            const data = await this.coreManager.enablePlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'enablePluginResult', success: true, data });
        });
    }

    private async disablePlugin(pluginName: string, marketplaceName: string, scope: string) {
        await this.execute('disablePluginResult', '禁用插件', async () => {
            const data = await this.coreManager.disablePlugin(pluginName, marketplaceName, scope);
            this.postMessage({ command: 'disablePluginResult', success: true, data });
        });
    }

    private async updateMarketplace(marketplaceName: string) {
        await this.execute('updateMarketplaceResult', '更新插件市场', async () => {
            const data = await this.coreManager.updateMarketplace(marketplaceName);
            this.postMessage({ command: 'updateMarketplaceResult', success: true, name: marketplaceName, data });
        });
    }

    private async removeMarketplace(marketplaceName: string) {
        if (!await this.confirm(`确定要移除插件市场 "${marketplaceName}" 吗？`, '移除')) {
            this.postMessage({ command: 'removeMarketplaceResult', success: false, name: marketplaceName, cancelled: true });
            return;
        }
        await this.execute('removeMarketplaceResult', '移除插件市场', async () => {
            const data = await this.coreManager.removeMarketplace(marketplaceName);
            this.postMessage({ command: 'removeMarketplaceResult', success: true, name: marketplaceName, data });
        });
    }

    private async addMarketplace(type: 'github' | 'directory', value: string) {
        await this.execute('addMarketplaceResult', '添加插件市场', async () => {
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
        await this.execute('addAgentResult', '创建 Agent', async () => {
            const agents = await this.coreManager.addAgentConf(data);
            this.postMessage({ command: 'addAgentResult', success: true, message: 'Agent 创建成功', data: agents });
        });
    }

    private async removeAgent(name: string) {
        if (!await this.confirm(`确定要删除 Agent "${name}" 吗？`, '删除')) return;
        await this.execute('removeAgentResult', '删除 Agent', async () => {
            const agents = await this.coreManager.removeAgentConf(name);
            this.postMessage({ command: 'removeAgentResult', success: true, message: 'Agent 已删除', data: agents });
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
        if (!await this.confirm(`确定要删除 Skill "${name}" 吗？`, '删除')) return;
        await this.execute('removeSkillResult', '删除 Skill', async () => {
            const skills = await this.coreManager.removeSkillConf(name);
            this.postMessage({ command: 'removeSkillResult', success: true, message: 'Skill 已删除', data: skills });
        });
    }

    private async toggleSkill(name: string, enabled: boolean) {
        // 写入哪层 settings 由 core 按技能所在层决定
        // 成功消息由 execute 统一发送（successExtra 挂 data），fn 里不要再 postMessage，否则会多发一条无 data 的成功消息
        await this.execute(
            'toggleSkillResult',
            enabled ? '启用 Skill' : '禁用 Skill',
            async () => (enabled ? await this.coreManager.enableSkill(name) : await this.coreManager.disableSkill(name)),
            (data) => ({ data }),
        );
    }

    private async searchSkillHub(query: string) {
        try {
            const data = await this.httpsGet(skillHubConfig.searchUrl(query));
            const json = JSON.parse(data);
            this.postMessage({ command: 'searchSkillHubResult', success: true, data: json.results || [] });
        } catch (error) {
            this.postMessage({ command: 'searchSkillHubResult', success: false, data: [], message: (error as Error).message });
        }
    }

    private async installSkillFromHub(slug: string, scope: 'project' | 'user') {
        try {
            // 确定安装目录（绝对路径）
            let skillsDir: string;
            if (scope === 'project') {
                const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!wsFolder) throw new Error('未打开项目，无法执行项目安装');
                skillsDir = path.join(wsFolder, '.sema', 'skills');
            } else {
                skillsDir = path.join(os.homedir(), '.sema', 'skills');
            }

            // 确保目录存在
            fs.mkdirSync(skillsDir, { recursive: true });

            // 下载 zip 到系统临时目录（避免工作目录问题）
            const zipPath = path.join(os.tmpdir(), `sema-skill-${slug}-${Date.now()}.zip`);
            await this.downloadFile(skillHubConfig.downloadUrl(slug), zipPath);

            // zip 根目录直接是文件，解压到 skillsDir/<slug>/ 下
            const destSkillDir = path.join(skillsDir, slug);
            fs.mkdirSync(destSkillDir, { recursive: true });
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(destSkillDir, true);

            // 删除 zip
            fs.unlinkSync(zipPath);

            // 刷新 skill 信息
            await this.ensureCoreReady();
            const skills = await this.coreManager.getSkillsInfo(true);
            this.postMessage({ command: 'installSkillFromHubResult', success: true, slug, data: skills });
        } catch (error) {
            this.postMessage({ command: 'installSkillFromHubResult', success: false, slug, message: (error as Error).message });
            vscode.window.showErrorMessage(`安装 Skill "${slug}" 失败: ${(error as Error).message}`);
        }
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

    /** 发起 HTTPS GET 请求，返回响应体字符串，自动跟随重定向 */
    private httpsGet(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const get = (targetUrl: string) => {
                const mod = targetUrl.startsWith('https') ? https : http;
                (mod as typeof https).get(targetUrl, { headers: { 'User-Agent': 'sema-vscode' } }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        get(res.headers.location);
                        return;
                    }
                    let body = '';
                    res.on('data', (chunk) => { body += chunk; });
                    res.on('end', () => resolve(body));
                    res.on('error', reject);
                }).on('error', reject);
            };
            get(url);
        });
    }

    /** 下载文件到指定绝对路径，自动跟随重定向 */
    private downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const get = (targetUrl: string) => {
                const mod = targetUrl.startsWith('https') ? https : http;
                (mod as typeof https).get(targetUrl, { headers: { 'User-Agent': 'sema-vscode' } }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        get(res.headers.location);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`下载失败，状态码: ${res.statusCode}`));
                        return;
                    }
                    const file = fs.createWriteStream(destPath);
                    res.pipe(file);
                    file.on('finish', () => file.close(() => resolve()));
                    file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
                }).on('error', reject);
            };
            get(url);
        });
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
        await this.execute('addCommandResult', '创建 Command', async () => {
            const commands = await this.coreManager.addCommandConf(data);
            this.postMessage({ command: 'addCommandResult', success: true, message: 'Command 创建成功', data: commands });
        });
    }

    private async removeCommand(name: string) {
        if (!await this.confirm(`确定要删除 Command "${name}" 吗？`, '删除')) return;
        await this.execute('removeCommandResult', '删除 Command', async () => {
            const commands = await this.coreManager.removeCommandConf(name);
            this.postMessage({ command: 'removeCommandResult', success: true, message: 'Command 已删除', data: commands });
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
        await this.execute('addMCPServerResult', '添加 MCP Server', async () => {
            const servers = await this.coreManager.addMCPServer(data);
            this.postMessage({ command: 'addMCPServerResult', success: true, message: 'MCP Server 添加成功', data: servers });
        });
    }

    private async removeMCPServer(name: string) {
        if (!await this.confirm(`确定要删除 MCP Server "${name}" 吗？`, '删除')) return;
        await this.execute('removeMCPServerResult', '删除 MCP Server', async () => {
            const servers = await this.coreManager.removeMCPServer(name);
            this.postMessage({ command: 'removeMCPServerResult', success: true, message: 'MCP Server 已删除', data: servers });
        });
    }

    private async reconnectMCPServer(name: string) {
        await this.execute('reconnectMCPServerResult', '重连 MCP Server', async () => {
            const servers = await this.coreManager.reconnectMCPServer(name);
            this.postMessage({ command: 'reconnectMCPServerResult', success: true, message: 'MCP Server 重连成功', data: servers });
        });
    }

    private async disableMCPServer(name: string) {
        await this.execute('disableMCPServerResult', '禁用 MCP Server', async () => {
            const servers = await this.coreManager.disableMCPServer(name);
            this.postMessage({ command: 'disableMCPServerResult', success: true, data: servers });
        });
    }

    private async enableMCPServer(name: string) {
        await this.execute('enableMCPServerResult', '启用 MCP Server', async () => {
            const servers = await this.coreManager.enableMCPServer(name);
            this.postMessage({ command: 'enableMCPServerResult', success: true, data: servers });
        });
    }

    private async updateMCPUseTools(name: string, toolNames: string[]) {
        await this.execute('updateMCPUseToolsResult', '更新 MCP 工具配置', async () => {
            const servers = await this.coreManager.updateMCPUseTools(name, toolNames);
            this.postMessage({ command: 'updateMCPUseToolsResult', success: true, message: '工具配置已更新', data: servers });
        });
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
        await this.execute('stopTaskResult', '停止任务', async () => {
            this.coreManager.stopTask(taskId);
            this.unwatchTask(taskId);
            this.postMessage({ command: 'stopTaskResult', success: true, taskId });
        });
    }

    // ─── Cron Tasks ─────────────────────────────────────────────────────────

    private async loadCronTasks() {
        await this.execute('', '加载定时任务', async () => {
            const data = await this.coreManager.getCronTasks();
            // console.log('[loadCronTasks] data:', data);
            this.postMessage({ command: 'loadCronTasksResult', success: true, data });
        });
    }

    private async deleteCronTask(id: string) {
        await this.execute('', '删除定时任务', async () => {
            const success = this.coreManager.deleteCronTask(id);
            this.postMessage({ command: 'deleteCronTaskResult', success, id });
        });
    }

    private async enableCronTask(id: string) {
        await this.execute('', '启用定时任务', async () => {
            const success = this.coreManager.enableCronTask(id);
            this.postMessage({ command: 'enableCronTaskResult', success, id });
        });
    }

    private async disableCronTask(id: string) {
        await this.execute('', '禁用定时任务', async () => {
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
                err => vscode.window.showErrorMessage(`打开文件失败：${(err as Error).message}`)
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
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src ${webview.cspSource}; img-src data:;">
    <title>Code Agent Model配置</title>
</head>
<body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}