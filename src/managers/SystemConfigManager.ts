import * as vscode from 'vscode';
import { UpdatableCoreConfig } from 'sema-core/types';
import { defaultConfig } from '../webview/config/default/defaultConfig';

/**
 * SystemConfigManager 类 - 管理系统配置的持久化存储
 */
export class SystemConfigManager {
    private static readonly CONFIG_KEY = 'sema.systemConfig';
    private static readonly DISABLED_TOOLS_KEY = 'sema.disabledTools';
    private static readonly LEGACY_USE_TOOLS_KEY = 'sema.useTools';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        // 一次性迁移：旧版本以白名单形式存储工具配置（key 不一致 + 升级后会导致全部禁用），
        // 这里直接清掉历史值，回到"全部启用"的默认状态
        if (this.context.globalState.get(SystemConfigManager.LEGACY_USE_TOOLS_KEY) !== undefined) {
            this.context.globalState.update(SystemConfigManager.LEGACY_USE_TOOLS_KEY, undefined);
        }
    }

    /**
     * 获取系统配置
     */
    public getSystemConfig(): UpdatableCoreConfig {
        try {
            const stored = this.context.globalState.get<UpdatableCoreConfig>(SystemConfigManager.CONFIG_KEY);

            // 如果没有存储的配置，创建并存储默认配置
            if (!stored) {
               // console.log('No stored system config found, creating and storing default config');
                const defaultConfigCopy = { ...defaultConfig };

                // 异步保存默认配置，但不等待完成
                this.context.globalState.update(SystemConfigManager.CONFIG_KEY, defaultConfigCopy)
                    .then(() => {
                       // console.log('Default system config saved successfully');
                    }, (error: any) => {
                        console.error('Error saving default system config:', error);
                    });

                return defaultConfigCopy;
            }

            // 合并存储的配置和默认配置，确保所有字段都有值
            const config = {
                ...defaultConfig,
                ...stored
            };

            // console.log('Loaded system config:', config);
            return config;

        } catch (error) {
            console.error('Error loading system config:', error);
            return { ...defaultConfig };
        }
    }

    /**
     * 保存系统配置
     */
    public async saveSystemConfig(config: UpdatableCoreConfig): Promise<void> {
        try {
            await this.context.globalState.update(SystemConfigManager.CONFIG_KEY, config);
           // console.log('System config updated:', config);
        } catch (error) {
            console.error('Error saving system config:', error);
            throw new Error(`保存系统配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 保存单个系统配置项
     */
    public async saveSystemConfigByKey<K extends keyof UpdatableCoreConfig>(
        key: K,
        value: UpdatableCoreConfig[K]
    ): Promise<void> {
        try {
            const currentConfig = this.getSystemConfig();
            const newConfig = { ...currentConfig, [key]: value };
            await this.context.globalState.update(SystemConfigManager.CONFIG_KEY, newConfig);
           // console.log(`System config updated: ${String(key)} =`, value);

        } catch (error) {
            console.error('Error saving system config by key:', error);
            throw new Error(`保存系统配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 保存任意 key 到 globalState（不受 UpdatableCoreConfig 类型约束）
     * 用于扩展端本地副作用字段（如 enablePet），这类字段不应推给 sema-core。
     */
    public async saveSystemConfigByKeyRaw(key: string, value: any): Promise<void> {
        try {
            const currentConfig = this.getSystemConfig() as Record<string, any>;
            const newConfig = { ...currentConfig, [key]: value };
            await this.context.globalState.update(SystemConfigManager.CONFIG_KEY, newConfig);
        } catch (error) {
            console.error('Error saving system config by key (raw):', error);
            throw new Error(`保存系统配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 获取禁用工具黑名单
     * null 表示不禁用任何工具（即全部启用）
     */
    public getDisabledTools(): string[] | null {
        try {
            const stored = this.context.globalState.get<string[] | null>(SystemConfigManager.DISABLED_TOOLS_KEY);
            return stored !== undefined ? stored : null;
        } catch (error) {
            console.error('Error loading disabledTools config:', error);
            return null;
        }
    }

    /**
     * 保存禁用工具黑名单
     */
    public async saveDisabledTools(disabledTools: string[] | null): Promise<void> {
        try {
            await this.context.globalState.update(SystemConfigManager.DISABLED_TOOLS_KEY, disabledTools);
        } catch (error) {
            console.error('Error saving disabledTools config:', error);
            throw new Error(`保存 disabledTools 配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

}