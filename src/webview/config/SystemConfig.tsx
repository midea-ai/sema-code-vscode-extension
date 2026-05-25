import React, { useState, useEffect, useCallback } from 'react';
import { VscodeApi } from './types';
import { defaultConfig } from './default/defaultConfig.ts';

interface SystemConfigProps {
    vscode: VscodeApi;
}

// 使用与 defaultConfig 相同的接口结构
interface SystemConfigData {
    stream?: boolean;
    thinking?: boolean;
    showThinkingText?: boolean;
    skipFileEditPermission?: boolean;
    skipShellExecPermission?: boolean;
    skipSkillPermission?: boolean;
    skipMCPToolPermission?: boolean;
    skipFetchUrlPermission?: boolean;
    systemPrompt?: string;
    customRules?: string;
    enableLLMCache?: boolean;
    disableBackgroundTasks?: boolean;
    enablePet?: boolean;
}

const SystemConfig: React.FC<SystemConfigProps> = ({ vscode }) => {
    const [config, setConfig] = useState<SystemConfigData>(defaultConfig);
    const [savedConfig, setSavedConfig] = useState<SystemConfigData>(defaultConfig); // 已保存的配置
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [platform, setPlatform] = useState<string>('');
    const petSupported = platform === 'darwin' || platform === 'win32' || platform === 'linux';
    const thinkingEnabled = config.thinking || false;
    const showThinkingText = config.showThinkingText ?? true;

    // 字符计数状态
    const [systemPromptCount, setSystemPromptCount] = useState(0);
    const [customRulesCount, setCustomRulesCount] = useState(0);

    useEffect(() => {
        // 更新字符计数
        setSystemPromptCount((config.systemPrompt || '').length);
        setCustomRulesCount((config.customRules || '').length);
    }, [config.systemPrompt, config.customRules]);

    // 组件挂载时加载配置（只执行一次）
    useEffect(() => {
        vscode.postMessage({ command: 'loadSystemConfig' });
    }, [vscode]);

    // 消息处理器
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;

            switch (msg.command) {
                case 'loadSystemConfigResult':
                    if (msg.success && msg.data) {
                        setConfig(msg.data);
                        setSavedConfig(msg.data);
                    }
                    if (typeof msg.platform === 'string') {
                        setPlatform(msg.platform);
                    }
                    break;
                case 'saveSystemConfigByKeyResult':
                    if (msg.success) {
                        // 使用 msg.value 更新已保存的配置
                        setSavedConfig(prev => ({ ...prev, [msg.key]: msg.value }));
                    } else {
                        setMessage({
                            text: `✗ ${msg.message || '保存失败'}`,
                            type: 'error'
                        });
                        setTimeout(() => setMessage(null), 3000);
                    }
                    break;
                case 'saveSystemConfigResult':
                    setMessage({
                        text: msg.success ? '✓ 配置已保存' : `✗ ${msg.message || '保存失败'}`,
                        type: msg.success ? 'success' : 'error'
                    });
                    setTimeout(() => setMessage(null), 3000);
                    break;
                case 'resetSystemConfigResult':
                    if (msg.success) {
                        // 重置成功，更新前端状态
                        setConfig(defaultConfig);
                        setSavedConfig(defaultConfig);
                    }
                    setMessage({
                        text: msg.success ? '✓ 已重置为默认配置' : `✗ ${msg.message || '重置失败'}`,
                        type: msg.success ? 'success' : 'error'
                    });
                    setTimeout(() => setMessage(null), 3000);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [vscode]);

    // 保存单个配置项
    const saveConfigByKey = useCallback((key: keyof SystemConfigData, value: any) => {
        vscode.postMessage({
            command: 'saveSystemConfigByKey',
            key,
            value
        });
    }, [vscode]);

    // 检查文本字段是否有未保存的修改
    const hasUnsavedChanges = (field: 'systemPrompt' | 'customRules') => {
        return config[field] !== savedConfig[field];
    };

    const handleChange = (field: keyof SystemConfigData, value: any) => {
        // 字符限制检查
        if (field === 'systemPrompt' && typeof value === 'string' && value.length > 500) {
            return;
        }
        if (field === 'customRules' && typeof value === 'string' && value.length > 1000) {
            return;
        }

        setConfig(prev => ({ ...prev, [field]: value }));

        // 非文本字段立即保存
        if (field !== 'systemPrompt' && field !== 'customRules') {
            saveConfigByKey(field, value);
        }
    };

    // 保存文本字段
    const handleSaveTextField = (field: 'systemPrompt' | 'customRules') => {
        saveConfigByKey(field, config[field]);
    };

    const handleReset = () => {
        // 发送重置请求到后端，由后端显示确认对话框
        vscode.postMessage({
            command: 'resetSystemConfig'
        });
    };

    return (
        <div className="form-card">
            <h2 className="section-title">系统配置</h2>

            {/* 开关配置 */}
            <div className="config-section">
                <h3 className="config-section-title">基础设置</h3>
                {/* 流式和Thinking一行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title="启用后AI回复将实时显示">
                            <input
                                type="checkbox"
                                checked={config.stream || false}
                                onChange={(e) => handleChange('stream', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            开启流式
                        </label>
                    </div>

                    <div className="form-group thinking-form-group">
                        <div className="thinking-options">
                            <label className="checkbox-label" title="开启AI的思考和推理过程">
                                <input
                                    type="checkbox"
                                    checked={thinkingEnabled}
                                    onChange={(e) => handleChange('thinking', e.target.checked)}
                                />
                                <span className="checkmark"></span>
                                开启Thinking
                            </label>
                            {thinkingEnabled && (
                                <button
                                    type="button"
                                    className={`show-thinking-toggle ${showThinkingText ? 'hide' : 'show'}`}
                                    title={showThinkingText ? '隐藏聊天区Thinking文本' : '显示聊天区Thinking文本'}
                                    onClick={() => handleChange('showThinkingText', !showThinkingText)}
                                >
                                    {showThinkingText ? '隐藏' : '显示'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 缓存设置 & 后台任务控制 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title="启用LLM响应缓存，建议仅在测试时使用">
                            <input
                                type="checkbox"
                                checked={config.enableLLMCache || false}
                                onChange={(e) => handleChange('enableLLMCache', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            启用LLM缓存
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title="启用后将禁止Bash后台运行、Agent后台执行、超时转后台等功能">
                            <input
                                type="checkbox"
                                checked={config.disableBackgroundTasks || false}
                                onChange={(e) => handleChange('disableBackgroundTasks', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            禁止后台任务
                        </label>
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label
                            className="checkbox-label"
                            title={petSupported
                                ? '启用后将下载并启动桌面 Pet（Sema Pet）。本地已有二进制时直接使用，否则从 GitHub releases 自动下载'
                                : '桌宠暂仅支持 macOS / Windows / Linux'}
                            style={petSupported ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
                        >
                            <input
                                type="checkbox"
                                checked={petSupported && (config.enablePet || false)}
                                disabled={!petSupported}
                                onChange={(e) => handleChange('enablePet', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            启用桌宠{petSupported ? '' : '（暂仅支持 macOS / Windows / Linux）'}
                        </label>
                    </div>
                </div>
            </div>

            {/* 开关配置 */}
            <div className="config-section">
                <h3 className="config-section-title">
                    权限设置
                    <span
                        className="section-hint-icon"
                        title="以下「跳过…权限检查」开关优先级高于输入框的权限等级（Ask / AutoEdit / AutoRun）。勾选后对应操作将始终跳过确认，不受当前权限等级影响。"
                    >ⓘ</span>
                </h3>
                {/* 跳过权限第一行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title="启用后将直接编辑文件而不需要确认">
                            <input
                                type="checkbox"
                                checked={config.skipFileEditPermission || false}
                                onChange={(e) => handleChange('skipFileEditPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            跳过文件编辑权限检查
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title="启用后将直接执行Shell命令而不需要确认，慎重勾选">
                            <input
                                type="checkbox"
                                checked={config.skipShellExecPermission || false}
                                onChange={(e) => handleChange('skipShellExecPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            跳过Shell执行权限检查
                        </label>
                    </div>
                </div>

                {/* 跳过权限第二行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title="启用后将直接执行Skill而不需要确认">
                            <input
                                type="checkbox"
                                checked={config.skipSkillPermission || false}
                                onChange={(e) => handleChange('skipSkillPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            跳过Skill权限检查
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title="启用后将直接执行MCP工具而不需要确认">
                            <input
                                type="checkbox"
                                checked={config.skipMCPToolPermission || false}
                                onChange={(e) => handleChange('skipMCPToolPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            跳过MCP工具权限检查
                        </label>
                    </div>
                </div>

                {/* 跳过权限第三行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title="启用后将直接执行FetchUrl而不需要确认">
                            <input
                                type="checkbox"
                                checked={config.skipFetchUrlPermission || false}
                                onChange={(e) => handleChange('skipFetchUrlPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            跳过FetchUrl权限检查
                        </label>
                    </div>
                </div>
            </div>

            {/* 提示词配置 */}
            <div className="config-section">
                <h3 className="config-section-title">提示词设置</h3>

                <div className="form-group">
                    <label htmlFor="systemPrompt">系统提示词</label>
                    <textarea
                        id="systemPrompt"
                        rows={2}
                        value={config.systemPrompt || ''}
                        onChange={(e) => handleChange('systemPrompt', e.target.value)}
                        placeholder={defaultConfig.systemPrompt}
                        maxLength={500}
                    />
                    <div className="description" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>定义AI助手的基本角色和行为</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: systemPromptCount > 450 ? '#f56565' : 'inherit' }}>
                                {systemPromptCount}/500
                            </span>
                            <button
                                type="button"
                                className="small"
                                onClick={() => handleSaveTextField('systemPrompt')}
                                disabled={!hasUnsavedChanges('systemPrompt')}
                            >
                                保存
                            </button>
                        </span>
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="customRules">自定义规则</label>
                    <textarea
                        id="customRules"
                        rows={6}
                        value={config.customRules || ''}
                        onChange={(e) => handleChange('customRules', e.target.value)}
                        placeholder={defaultConfig.customRules}
                        maxLength={1000}
                    />
                    <div className="description" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>定义AI助手应遵循的具体规则和约束</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: customRulesCount > 900 ? '#f56565' : 'inherit' }}>
                                {customRulesCount}/1000
                            </span>
                            <button
                                type="button"
                                className="small"
                                onClick={() => handleSaveTextField('customRules')}
                                disabled={!hasUnsavedChanges('customRules')}
                            >
                                保存
                            </button>
                        </span>
                    </div>
                </div>
            </div>

            {/* 按钮组 */}
            <div className="button-group">
                <button type="button" className="reset-btn" onClick={handleReset}>
                    重置为默认
                </button>
            </div>

            {message && (
                <div className={`message ${message.type}`} style={{ marginTop: '12px', display: 'flex' }}>
                    {message.text}
                </div>
            )}
        </div>
    );
};

export default SystemConfig;
