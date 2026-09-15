import React, { useState, useEffect, useCallback } from 'react';
import { VscodeApi } from './types';
import IconSelect from './IconSelect';
import { defaultConfig, DEFAULT_CUSTOM_RULES, isBuiltinCustomRules } from './default/defaultConfig.ts';
import { useT, setLang, getLang, normalizeLang, languageLabel, I18nKey, LANGS, LANGUAGES } from '../common/i18n/react';

interface SystemConfigProps {
    vscode: VscodeApi;
}

// 使用与 defaultConfig 相同的接口结构
interface SystemConfigData {
    lang?: string;
    stream?: boolean;
    thinking?: boolean;
    showThinkingText?: boolean;
    skipFileEditPermission?: boolean;
    skipShellExecPermission?: boolean;
    skipSkillPermission?: boolean;
    skipMCPToolPermission?: boolean;
    skipFetchUrlPermission?: boolean;
    skipExternalFileReadPermission?: boolean;
    fetchUrlBrowserUserAgent?: boolean;
    systemPrompt?: string;
    customRules?: string;
    disableBackgroundTasks?: boolean;
    enableToolSearch?: boolean;
    enableInputPrediction?: boolean;
    enablePet?: boolean;
    enableBrowserControl?: boolean;
    defaultPermissionLevel?: string;
}

/** Chrome 扩展商店页（Sema Browser Control） */
const CHROME_EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/pjofgjgagohldpbcnkgnfjeehealejie';

/** 可选的默认权限档位（与输入框权限菜单一致），descKey 为说明文案 key，渲染期取值 */
const PERMISSION_LEVEL_OPTIONS: Array<{ value: string; descKey: I18nKey }> = [
    { value: 'Ask', descKey: 'config.system.perm.ask' },
    { value: 'AutoEdit', descKey: 'config.system.perm.autoEdit' },
    { value: 'AutoRun', descKey: 'config.system.perm.autoRun' },
    { value: 'Bypass', descKey: 'config.system.perm.bypass' }
];

const SystemConfig: React.FC<SystemConfigProps> = ({ vscode }) => {
    // JB 插件不支持桌宠，隐藏「启用桌宠」开关（VSCode 下 __SEMA_JB__ 为 undefined，行为不变）。
    // 必须在组件内读取：模块顶层求值早于 jb-index 设置该标记，会恒为 false。
    const IS_JB = !!(window as any).__SEMA_JB__;
    const t = useT();
    // 初始值按当前语言取默认，避免英文用户在配置加载完成前闪一帧「- 中文回答」
    const [config, setConfig] = useState<SystemConfigData>(() => ({ ...defaultConfig, lang: getLang(), customRules: DEFAULT_CUSTOM_RULES[getLang()] }));
    const [savedConfig, setSavedConfig] = useState<SystemConfigData>(() => ({ ...defaultConfig, lang: getLang(), customRules: DEFAULT_CUSTOM_RULES[getLang()] })); // 已保存的配置
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [platform, setPlatform] = useState<string>('');
    const petSupported = platform === 'darwin' || platform === 'win32' || platform === 'linux';
    const thinkingEnabled = config.thinking || false;
    const showThinkingText = config.showThinkingText ?? true;
    // 浏览器控制：win32 不支持（disabled），linux 实验性；执行中禁用开关等宿主回结果
    const browserControlSupported = platform !== 'win32';
    const [browserControlBusy, setBrowserControlBusy] = useState<false | 'enabling' | 'disabling'>(false);

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
                case 'langUpdate':
                    // 聊天页切换语言：宿主已落盘 lang，且当规则仍为内置默认值时一并落盘了目标语言默认规则（随消息带来）。
                    // 页面同步 lang；customRules 仅在当前值仍是内置默认值时替换，用户正在编辑的自定义规则不动。
                    if (typeof msg.lang === 'string') {
                        const lang = normalizeLang(msg.lang);
                        const rules = typeof msg.customRules === 'string' ? msg.customRules : undefined;
                        setLang(lang);
                        setConfig(prev => ({
                            ...prev,
                            lang,
                            ...(rules !== undefined && isBuiltinCustomRules(prev.customRules) ? { customRules: rules } : {})
                        }));
                        setSavedConfig(prev => ({
                            ...prev,
                            lang,
                            ...(rules !== undefined ? { customRules: rules } : {})
                        }));
                    }
                    break;
                case 'loadSystemConfigResult':
                    if (msg.success && msg.data) {
                        setConfig(msg.data);
                        setSavedConfig(msg.data);
                        if (msg.data.lang) setLang(msg.data.lang);
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
                            text: `✗ ${msg.message || t('config.system.saveFailed')}`,
                            type: 'error'
                        });
                        setTimeout(() => setMessage(null), 3000);
                    }
                    break;
                case 'setBrowserControlResult':
                    // 成功 enabled 为目标值，失败为原值：统一按 enabled 回填即可实现回弹
                    setBrowserControlBusy(false);
                    setConfig(prev => ({ ...prev, enableBrowserControl: !!msg.enabled }));
                    setSavedConfig(prev => ({ ...prev, enableBrowserControl: !!msg.enabled }));
                    if (!msg.success) {
                        setMessage({
                            text: `✗ ${msg.message || t('config.system.saveFailed')}`,
                            type: 'error'
                        });
                        setTimeout(() => setMessage(null), 3000);
                    }
                    break;
                case 'saveSystemConfigResult':
                    setMessage({
                        text: msg.success ? t('config.system.saved') : `✗ ${msg.message || t('config.system.saveFailed')}`,
                        type: msg.success ? 'success' : 'error'
                    });
                    setTimeout(() => setMessage(null), 3000);
                    break;
                case 'resetSystemConfigResult':
                    if (msg.success) {
                        // 重置不改界面语言：优先使用宿主实际写入的配置回填；
                        // 兜底按同样规则本地构造（保留当前 lang，customRules 取当前语言默认值）
                        const lang = normalizeLang(msg.data?.lang ?? getLang());
                        const resetConfig: SystemConfigData = msg.data ?? { ...defaultConfig, lang, customRules: DEFAULT_CUSTOM_RULES[lang] };
                        setConfig(resetConfig);
                        setSavedConfig(resetConfig);
                    }
                    setMessage({
                        text: msg.success ? t('config.system.resetDone') : `✗ ${msg.message || t('config.system.resetFailed')}`,
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

    /**
     * 切换界面语言：页面立即切换并落盘 lang。
     * customRules 仅当当前值仍是某个语言的默认值（整体比较，忽略首尾空白）时才替换为目标语言默认值；
     * 用户改过的规则一律不动。
     */
    const handleLangChange = (value: string) => {
        const lang = normalizeLang(value);
        const isDefaultRules = isBuiltinCustomRules(config.customRules);
        setConfig(prev => ({
            ...prev,
            lang,
            ...(isDefaultRules ? { customRules: DEFAULT_CUSTOM_RULES[lang] } : {})
        }));
        setLang(lang);
        saveConfigByKey('lang', lang);
        if (isDefaultRules) {
            saveConfigByKey('customRules', DEFAULT_CUSTOM_RULES[lang]);
        }
    };

    /** 浏览器控制开关：不走 saveSystemConfigByKey，发「执行动作」消息，配置键由宿主在动作成功后写入 */
    const handleBrowserControlChange = (enabled: boolean) => {
        if (browserControlBusy || !browserControlSupported) return;
        setBrowserControlBusy(enabled ? 'enabling' : 'disabling');
        vscode.postMessage({ command: 'setBrowserControl', enabled });
    };

    const handleReset = () => {
        // 发送重置请求到后端，由后端显示确认对话框
        vscode.postMessage({
            command: 'resetSystemConfig'
        });
    };

    return (
        <div className="form-card">
            <h2 className="section-title">{t('config.system.title')}</h2>

            {/* 开关配置 */}
            <div className="config-section">
                <h3 className="config-section-title">{t('config.system.basic')}</h3>
                {/* 界面语言：label 见 languageLabel()，保证任一语言下都能找到入口 */}
                <div className="form-row">
                    <div className="form-group">
                        <div className="perm-level-field" title={t('config.system.languageTip')}>
                            <label htmlFor="uiLang">{languageLabel()}</label>
                            <div className="lang-select">
                                <IconSelect
                                    id="uiLang"
                                    value={normalizeLang(config.lang)}
                                    onChange={handleLangChange}
                                    options={LANGUAGES.map(code => ({ value: code, label: LANGS[code].label }))}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                {/* 流式和Thinking一行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.streamTip')}>
                            <input
                                type="checkbox"
                                checked={config.stream || false}
                                onChange={(e) => handleChange('stream', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.stream')}
                        </label>
                    </div>

                    <div className="form-group thinking-form-group">
                        <div className="thinking-options">
                            <label className="checkbox-label" title={t('config.system.thinkingTip')}>
                                <input
                                    type="checkbox"
                                    checked={thinkingEnabled}
                                    onChange={(e) => handleChange('thinking', e.target.checked)}
                                />
                                <span className="checkmark"></span>
                                {t('config.system.thinking')}
                            </label>
                            {thinkingEnabled && (
                                <button
                                    type="button"
                                    className={`show-thinking-toggle ${showThinkingText ? 'hide' : 'show'}`}
                                    title={showThinkingText ? t('config.system.hideThinkingTip') : t('config.system.showThinkingTip')}
                                    onClick={() => handleChange('showThinkingText', !showThinkingText)}
                                >
                                    {showThinkingText ? t('config.system.hide') : t('config.system.show')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 输入预测 & 桌宠（JB 不支持桌宠，仅隐藏该项） */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.inputPredictionTip')}>
                            <input
                                type="checkbox"
                                checked={config.enableInputPrediction || false}
                                onChange={(e) => handleChange('enableInputPrediction', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.inputPrediction')}
                        </label>
                    </div>

                    {!IS_JB && (
                        <div className="form-group">
                            <label
                                className="checkbox-label"
                                title={petSupported
                                    ? t('config.system.petTip')
                                    : t('config.system.petUnsupportedTip')}
                                style={petSupported ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                <input
                                    type="checkbox"
                                    checked={petSupported && (config.enablePet || false)}
                                    disabled={!petSupported}
                                    onChange={(e) => handleChange('enablePet', e.target.checked)}
                                />
                                <span className="checkmark"></span>
                                {t('config.system.pet')}{petSupported ? '' : t('config.system.petUnsupportedSuffix')}
                            </label>
                        </div>
                    )}
                </div>
            </div>

            {/* 工具设置 */}
            <div className="config-section">
                <h3 className="config-section-title">{t('config.system.tools')}</h3>
                {/* 工具搜索 & 后台任务 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.toolSearchTip')}>
                            <input
                                type="checkbox"
                                checked={config.enableToolSearch || false}
                                onChange={(e) => handleChange('enableToolSearch', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.toolSearch')}
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.disableBackgroundTip')}>
                            <input
                                type="checkbox"
                                checked={config.disableBackgroundTasks || false}
                                onChange={(e) => handleChange('disableBackgroundTasks', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.disableBackground')}
                        </label>
                    </div>
                </div>

                {/* FetchUrl 浏览器标识 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.fetchUrlUATip')}>
                            <input
                                type="checkbox"
                                checked={config.fetchUrlBrowserUserAgent || false}
                                onChange={(e) => handleChange('fetchUrlBrowserUserAgent', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.fetchUrlUA')}
                        </label>
                    </div>
                </div>
            </div>

            {/* 集成：VSCode 与 JB 同样渲染，JB 侧由 config-controller 的 setBrowserControl 承接 */}
            <div className="config-section">
                <h3 className="config-section-title">{t('config.system.integrations')}</h3>
                <div className="form-row">
                    <div className="form-group">
                        <label
                            className={`checkbox-label${browserControlSupported ? '' : ' disabled'}`}
                            title={t('config.system.browserControlTip')}
                            style={browserControlBusy ? { cursor: 'progress' } : undefined}
                        >
                            <input
                                type="checkbox"
                                checked={browserControlSupported && (config.enableBrowserControl || false)}
                                disabled={!browserControlSupported || !!browserControlBusy}
                                onChange={(e) => handleBrowserControlChange(e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.browserControl')}
                            {!browserControlSupported && t('config.system.browserControlUnsupportedSuffix')}
                            {platform === 'linux' && t('config.system.browserControlExperimentalSuffix')}
                        </label>
                        {browserControlBusy && (
                            <div className="browser-control-hint">
                                {browserControlBusy === 'enabling'
                                    ? t('config.system.browserControlEnabling')
                                    : t('config.system.browserControlDisabling')}
                            </div>
                        )}
                        {!browserControlBusy && browserControlSupported && config.enableBrowserControl && (
                            <div className="browser-control-hint">
                                {t('config.system.browserControlInstallPrefix')}
                                <a
                                    href="#"
                                    className="browser-control-hint-link"
                                    onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: CHROME_EXTENSION_STORE_URL }); }}
                                >
                                    {t('config.system.browserControlInstallLink')}
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 开关配置 */}
            <div className="config-section">
                <h3 className="config-section-title">
                    {t('config.system.permissions')}
                    <span
                        className="section-hint-icon"
                        title={t('config.system.permissionsHint')}
                    >ⓘ</span>
                </h3>
                {/* 默认权限档位 */}
                <div className="form-row">
                    <div className="form-group">
                        <div
                            className="perm-level-field"
                            title={t('config.system.defaultPermTip')}
                        >
                            <label htmlFor="defaultPermissionLevel">{t('config.system.defaultPerm')}</label>
                            {/* 展开的下拉列表显示「档位（说明）」，收起后框内只显示档位短名 */}
                            <div className="perm-level-select">
                                <IconSelect
                                    id="defaultPermissionLevel"
                                    value={config.defaultPermissionLevel || 'AutoRun'}
                                    onChange={(value) => handleChange('defaultPermissionLevel', value)}
                                    options={PERMISSION_LEVEL_OPTIONS.map(opt => ({
                                        value: opt.value,
                                        label: `${opt.value}（${t(opt.descKey)}）`,
                                        selectedLabel: opt.value
                                    }))}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                {/* 跳过权限第一行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.skipReadTip')}>
                            <input
                                type="checkbox"
                                checked={config.skipExternalFileReadPermission || false}
                                onChange={(e) => handleChange('skipExternalFileReadPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.skipRead')}
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.skipEditTip')}>
                            <input
                                type="checkbox"
                                checked={config.skipFileEditPermission || false}
                                onChange={(e) => handleChange('skipFileEditPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.skipEdit')}
                        </label>
                    </div>
                </div>

                {/* 跳过权限第二行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.skipShellTip')}>
                            <input
                                type="checkbox"
                                checked={config.skipShellExecPermission || false}
                                onChange={(e) => handleChange('skipShellExecPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.skipShell')}
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.skipSkillTip')}>
                            <input
                                type="checkbox"
                                checked={config.skipSkillPermission || false}
                                onChange={(e) => handleChange('skipSkillPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.skipSkill')}
                        </label>
                    </div>
                </div>

                {/* 跳过权限第三行 */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.skipMcpTip')}>
                            <input
                                type="checkbox"
                                checked={config.skipMCPToolPermission || false}
                                onChange={(e) => handleChange('skipMCPToolPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.skipMcp')}
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label" title={t('config.system.skipFetchTip')}>
                            <input
                                type="checkbox"
                                checked={config.skipFetchUrlPermission || false}
                                onChange={(e) => handleChange('skipFetchUrlPermission', e.target.checked)}
                            />
                            <span className="checkmark"></span>
                            {t('config.system.skipFetch')}
                        </label>
                    </div>
                </div>
            </div>

            {/* 提示词配置 */}
            <div className="config-section">
                <h3 className="config-section-title">{t('config.system.prompts')}</h3>

                <div className="form-group">
                    <label htmlFor="systemPrompt">{t('config.system.systemPrompt')}</label>
                    <textarea
                        id="systemPrompt"
                        rows={2}
                        value={config.systemPrompt || ''}
                        onChange={(e) => handleChange('systemPrompt', e.target.value)}
                        placeholder={defaultConfig.systemPrompt}
                        maxLength={500}
                    />
                    <div className="description" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t('config.system.systemPromptDesc')}</span>
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
                                {t('common.save')}
                            </button>
                        </span>
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="customRules">{t('config.system.customRules')}</label>
                    <textarea
                        id="customRules"
                        rows={6}
                        value={config.customRules || ''}
                        onChange={(e) => handleChange('customRules', e.target.value)}
                        placeholder={DEFAULT_CUSTOM_RULES[normalizeLang(config.lang)]}
                        maxLength={1000}
                    />
                    <div className="description" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t('config.system.customRulesDesc')}</span>
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
                                {t('common.save')}
                            </button>
                        </span>
                    </div>
                </div>
            </div>

            {/* 按钮组 */}
            <div className="button-group">
                <button type="button" className="reset-btn" onClick={handleReset}>
                    {t('config.system.reset')}
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
