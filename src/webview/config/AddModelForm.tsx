import React, { useState, useEffect } from 'react';
import { ModelProfile, ThinkingHistoryPolicy, VscodeApi } from './types';
import ProviderLogo from '../common/ProviderLogo';
import IconSelect from './IconSelect';
import { OpenIcon } from './utils/svgIcons';
import {
    defaultModelProvider,
    DEFAULT_PROVIDER,
    PROVIDER_ORDER,
    DEFAULT_MAX_TOKENS,
    DEFAULT_CONTEXT_LENGTH,
    DEFAULT_MAX_TOKENS_OPTIONS,
    DEFAULT_CONTEXT_LENGTH_OPTIONS,
    AdapterType
} from './default/defaultModelProvider';
import { useT, t, I18nKey } from '../common/i18n/react';


/** 将 token 数格式化为易读形式：1000000 -> 1M，128000 -> 128k */
const formatTokenCount = (val: number): string => {
    if (val >= 1000000) {
        const m = val / 1000000;
        return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
    }
    return `${Math.round(val / 1000)}k`;
};

interface AddModelFormProps {
    onSuccess: () => void;
    /** 编辑模式下点「取消」：由 App 清空编辑目标并回到列表 */
    onCancelEdit: () => void;
    /** 非空即编辑模式：按其回填并锁住 provider/模型名；变为空时表单重置为空白新增态 */
    editModel: ModelProfile | null;
    /** 每次进入编辑递增，保证连续编辑同一模型也能重新回填 */
    editNonce: number;
    vscode: VscodeApi;
}

interface Model {
    id: string;
    name?: string;
    ownedBy?: string;
    key_doc_url?: string;
    recommended_max_tokens?: number;
    max_tokens?: number;
}

/** 预设服务商名称，自定义别名不允许与之重名（custom 本身除外，等价于不填） */
const RESERVED_PROVIDERS = PROVIDER_ORDER.filter(key => key !== 'custom');

/** 校验自定义服务商别名：留空合法（回退 custom），否则 2~20 位小写字母/数字/短横线，字母开头、不以短横线结尾（渲染期调用，可直接用 t） */
const validateCustomProviderName = (name: string): string | null => {
    if (!name) {
        return null;
    }
    if (name.length < 2 || name.length > 20) {
        return t('config.modelForm.aliasLength');
    }
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
        return t('config.modelForm.aliasCharset');
    }
    if (RESERVED_PROVIDERS.includes(name)) {
        return t('config.modelForm.aliasReserved', { name });
    }
    return null;
};

/** 历史思考回传策略选项；core 旧配置缺省即 preserve（labelKey 渲染期经 t() 取值） */
const DEFAULT_THINKING_HISTORY_POLICY: ThinkingHistoryPolicy = 'preserve';
const THINKING_HISTORY_POLICY_OPTIONS: { value: ThinkingHistoryPolicy; labelKey: I18nKey }[] = [
    { value: 'preserve', labelKey: 'config.modelForm.thinking.preserve' },
    { value: 'current_turn', labelKey: 'config.modelForm.thinking.currentTurn' },
    { value: 'omit', labelKey: 'config.modelForm.thinking.omit' }
];

/** 预设服务商 key 是否可直接在下拉里选中（custom 走别名分支） */
const isPresetProvider = (key: string) => key !== 'custom' && PROVIDER_ORDER.includes(key) && !!defaultModelProvider[key];

const AddModelForm: React.FC<AddModelFormProps> = ({ onSuccess, onCancelEdit, editModel, editNonce, vscode }) => {
    const t = useT();
    const isEditing = editModel !== null;
    const [provider, setProvider] = useState(DEFAULT_PROVIDER);
    const [customProviderName, setCustomProviderName] = useState(DEFAULT_PROVIDER === 'custom' ? 'custom' : '');
    const [baseURL, setBaseURL] = useState(defaultModelProvider[DEFAULT_PROVIDER].baseURL);
    const [apiKey, setApiKey] = useState('');
    const [adapt, setAdapt] = useState<AdapterType>(defaultModelProvider[DEFAULT_PROVIDER].defaultAdapt ?? 'openai');
    const [thinkingHistoryPolicy, setThinkingHistoryPolicy] = useState<ThinkingHistoryPolicy>(DEFAULT_THINKING_HISTORY_POLICY);
    const [modelName, setModelName] = useState('');
    const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
    const [selectedModelMaxTokens, setSelectedModelMaxTokens] = useState<number | null>(null);
    const [contextLength, setContextLength] = useState(String(DEFAULT_CONTEXT_LENGTH));
    const [showPassword, setShowPassword] = useState(false);
    const [isManualInput, setIsManualInput] = useState(false);
    const [availableModels, setAvailableModels] = useState<Model[]>([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [modelDocUrls, setModelDocUrls] = useState<Record<string, string>>({});
    const [testStatus, setTestStatus] = useState<{ message: string; type: 'testing' | 'success' | 'error' | '' }>({ message: '', type: '' });
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | '' }>({ text: '', type: '' });
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [fetchModelsFailed, setFetchModelsFailed] = useState(false);
    const [connectionTested, setConnectionTested] = useState(false);
    const [connectionSuccess, setConnectionSuccess] = useState(false);
    const [lastFetchedConfig, setLastFetchedConfig] = useState({ baseURL: '', apiKey: '' });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;

            switch (msg.command) {
                case 'saveResult':
                    setIsSaving(false);
                    setMessage({ text: msg.message, type: msg.success ? 'success' : 'error' });
                    setTimeout(() => setMessage({ text: '', type: '' }), 100);

                    if (msg.success) {
                        setTimeout(() => onSuccess(), 100);
                    }
                    break;

                case 'testResult':
                    setConnectionTested(true);
                    setConnectionSuccess(msg.success);
                    setTestStatus({
                        message: msg.message,
                        type: msg.success ? 'success' : 'error'
                    });
                    break;

                case 'modelAdapterResult':
                    if (msg.adapter) {
                        setAdapt(msg.adapter);
                    }
                    break;

                case 'modelsResult':
                    setIsFetchingModels(false);

                    // 无论成功还是失败，都更新 lastFetchedConfig，避免失败后反复重试
                    const providerConfig = defaultModelProvider[provider];
                    const requiresApiKey = providerConfig.requiresApiKeyForModelList !== false;
                    if (!requiresApiKey) {
                        setLastFetchedConfig({ baseURL, apiKey: lastFetchedConfig.apiKey });
                    } else {
                        setLastFetchedConfig({ baseURL, apiKey });
                    }

                    if (msg.success) {
                        if (msg.models && msg.models.length > 0) {
                            setFetchModelsFailed(false);
                            setAvailableModels(msg.models);

                            const docUrls: Record<string, string> = {};
                            msg.models.forEach((model: Model) => {
                                if (model.key_doc_url) {
                                    docUrls[model.id] = model.key_doc_url;
                                }
                            });
                            setModelDocUrls(docUrls);

                            // 智能选择默认模型
                            const preferredModelId = providerConfig.defaultModel;
                            const preferredModel = preferredModelId ? msg.models.find((m: Model) => m.id === preferredModelId) : null;
                            const autoSelectedModel = preferredModel ? preferredModel.id : msg.models[0].id;
                            setSelectedModel(autoSelectedModel);
                            const selectedModelData = msg.models.find((m: Model) => m.id === autoSelectedModel);
                            if (selectedModelData?.recommended_max_tokens) {
                                setMaxTokens(String(selectedModelData.recommended_max_tokens));
                            }
                            setSelectedModelMaxTokens(selectedModelData?.max_tokens ?? null);
                            vscode.postMessage({ command: 'getModelAdapter', provider, modelName: autoSelectedModel, baseURL });

                            setTestStatus({
                                message: t('config.modelForm.fetchedModels', { count: msg.models.length }),
                                type: 'success'
                            });
                            setTimeout(() => setTestStatus({ message: '', type: '' }), 3000);
                        } else {
                            // 请求成功但没有模型
                            setFetchModelsFailed(true);
                            setTestStatus({
                                message: t('config.modelForm.noModelsReturned'),
                                type: 'error'
                            });
                        }
                    } else {
                        // 请求失败
                        setFetchModelsFailed(true);
                        setTestStatus({
                            message: `✗ ${msg.message || t('config.modelForm.fetchFailed')}`,
                            type: 'error'
                        });
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [baseURL, apiKey, provider, onSuccess]);

    const handleProviderChange = (newProvider: string) => {
        setProvider(newProvider);
        setCustomProviderName(newProvider === 'custom' ? 'custom' : '');
        const defaults = defaultModelProvider[newProvider];
        setBaseURL(defaults.baseURL);
        setApiKey('');
        setModelName('');
        setAvailableModels([]);
        setSelectedModel('');
        setModelDocUrls({});
        setConnectionTested(false);
        setConnectionSuccess(false);
        setTestStatus({ message: '', type: '' });
        setLastFetchedConfig({ baseURL: '', apiKey: '' });
        setFetchModelsFailed(false);
        setIsManualInput(false);
        setMaxTokens(String(defaults.defaultMaxTokens ?? DEFAULT_MAX_TOKENS));
        setSelectedModelMaxTokens(null);
        setContextLength(String(defaults.defaultContextLength ?? DEFAULT_CONTEXT_LENGTH));
        setAdapt(defaults.defaultAdapt ?? 'openai');
        setThinkingHistoryPolicy(DEFAULT_THINKING_HISTORY_POLICY);
    };

    /**
     * 编辑目标变化：非空按落盘配置回填（模型名走手动输入分支，避免依赖「获取模型」），
     * 变为空时整表重置为默认值——同页内点「新增模型」标签退出编辑后，不能把回填的 apiKey/baseURL
     * 留在一个已解锁的表单里，否则用户以为在编辑，提交却新增了一条。
     */
    useEffect(() => {
        if (!editModel) {
            handleProviderChange(DEFAULT_PROVIDER);
            return;
        }
        const preset = isPresetProvider(editModel.provider);
        setProvider(preset ? editModel.provider : 'custom');
        setCustomProviderName(preset ? '' : editModel.provider);
        setBaseURL(editModel.baseURL ?? '');
        setApiKey(editModel.apiKey ?? '');
        setAdapt(editModel.adapt ?? 'openai');
        setThinkingHistoryPolicy(editModel.thinkingHistoryPolicy ?? DEFAULT_THINKING_HISTORY_POLICY);
        setIsManualInput(true);
        setModelName(editModel.modelName);
        setAvailableModels([]);
        setSelectedModel('');
        setModelDocUrls({});
        setSelectedModelMaxTokens(null);
        setMaxTokens(String(editModel.maxTokens));
        setContextLength(String(editModel.contextLength));
        setShowPassword(false);
        setConnectionTested(false);
        setConnectionSuccess(false);
        setTestStatus({ message: '', type: '' });
        setMessage({ text: '', type: '' });
        setLastFetchedConfig({ baseURL: '', apiKey: '' });
        setFetchModelsFailed(false);
    }, [editModel, editNonce]);

    /** 编辑模式下只有连接相关字段相对回填值有改动才要求重新测试连接；只改 token 数不用重测 */
    const connectionFieldsChanged = !editModel
        || baseURL !== (editModel.baseURL ?? '')
        || apiKey !== (editModel.apiKey ?? '')
        || adapt !== (editModel.adapt ?? 'openai');

    const handleFetchModels = () => {
        if (!baseURL) {
            setTestStatus({ message: t('config.modelForm.needBaseUrl'), type: 'error' });
            return;
        }

        // 检查是否需要 API Key 才能获取模型列表
        const providerConfig = defaultModelProvider[provider];
        const requiresApiKey = providerConfig?.requiresApiKeyForModelList !== false;
        if (requiresApiKey && !apiKey) {
            setTestStatus({ message: t('config.modelForm.needApiKey'), type: 'error' });
            return;
        }

        setTestStatus({ message: t('config.modelForm.fetching'), type: 'testing' });
        setIsFetchingModels(true);
        vscode.postMessage({
            command: 'fetchModels',
            data: { provider, baseURL, apiKey: apiKey || '', adapt, modelsUrl: providerConfig.modelsUrl }
        });
    };

    const handleTestConnection = () => {
        const currentModelName = getCurrentModelName();

        if (!baseURL) {
            setTestStatus({ message: t('config.modelForm.needBaseUrl'), type: 'error' });
            return;
        }
        if (!apiKey) {
            setTestStatus({ message: t('config.modelForm.needApiKey'), type: 'error' });
            return;
        }
        if (!currentModelName) {
            setTestStatus({ message: t('config.modelForm.needModel'), type: 'error' });
            return;
        }

        setTestStatus({ message: t('config.modelForm.testing'), type: 'testing' });

        vscode.postMessage({
            command: 'testConnection',
            data: {
                provider,
                baseURL,
                apiKey,
                modelName: currentModelName,
                adapt
            }
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const currentModelName = getCurrentModelName();

        if (!apiKey) {
            setMessage({ text: t('config.modelForm.needApiKey'), type: 'error' });
            return;
        }
        if (!currentModelName) {
            setMessage({ text: t('config.modelForm.needModel'), type: 'error' });
            return;
        }
        if (!baseURL) {
            setMessage({ text: t('config.modelForm.needBaseUrl'), type: 'error' });
            return;
        }

        if (connectionFieldsChanged && !connectionTested) {
            setTestStatus({ message: t('config.modelForm.testFirst'), type: 'error' });
            return;
        }

        if (connectionTested && !connectionSuccess) {
            setTestStatus({ message: t('config.modelForm.testNotPassed'), type: 'error' });
            return;
        }

        const aliasError = provider === 'custom' ? validateCustomProviderName(customProviderName) : null;
        if (aliasError) {
            setMessage({ text: t('config.modelForm.aliasInvalid', { error: aliasError }), type: 'error' });
            return;
        }

        setIsSaving(true);
        vscode.postMessage({
            command: 'saveConfig',
            data: {
                provider: provider === 'custom' && customProviderName ? customProviderName : provider,
                baseURL,
                apiKey,
                modelName: currentModelName,
                maxTokens: parseInt(maxTokens),
                contextLength: parseInt(contextLength),
                adapt,
                thinkingHistoryPolicy,
                isEdit: isEditing
            }
        });
    };

    const getCurrentModelName = () => {
        return isManualInput ? modelName : selectedModel;
    };

    const currentModelDocUrl = selectedModel && modelDocUrls[selectedModel]
        ? modelDocUrls[selectedModel]
        : (defaultModelProvider[provider].apikeyUrl || '');

    const defaults = defaultModelProvider[provider];

    return (
        <div className="form-card">
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="provider">{t('config.modelForm.provider')}</label>
                    <IconSelect
                        id="provider"
                        value={provider}
                        onChange={handleProviderChange}
                        disabled={isEditing}
                        options={PROVIDER_ORDER.filter(key => defaultModelProvider[key]).map(key => ({
                            value: key,
                            label: defaultModelProvider[key].nameKey ? t(defaultModelProvider[key].nameKey!) : defaultModelProvider[key].name,
                            icon: <ProviderLogo provider={key} className="icon-select-logo" />
                        }))}
                    />
                </div>

                {provider === 'custom' && (
                    <div className="form-group">
                        <label htmlFor="customProviderName">{t('config.modelForm.providerName')}</label>
                        <input
                            type="text"
                            id="customProviderName"
                            value={customProviderName}
                            onChange={(e) => setCustomProviderName(e.target.value.trim())}
                            disabled={isEditing}
                            placeholder={t('config.modelForm.providerNamePlaceholder')}
                        />
                        {validateCustomProviderName(customProviderName) && (
                            <div className="description" style={{ color: 'var(--vscode-errorForeground)' }}>
                                {validateCustomProviderName(customProviderName)}
                            </div>
                        )}
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="baseURL">{t('config.modelForm.baseUrl')}</label>
                    <input
                        type="text"
                        id="baseURL"
                        value={baseURL}
                        onChange={(e) => {
                            setBaseURL(e.target.value);
                            setConnectionTested(false);
                            setConnectionSuccess(false);
                        }}
                        placeholder={defaults.baseURLPlaceholder}
                    />
                    {/* <div className="description">API 服务的基础 URL</div> */}
                </div>

                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <label htmlFor="apiKey">API Key</label>
                        {currentModelDocUrl && (
                            <a
                                className="label-action"
                                href={currentModelDocUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={currentModelDocUrl}
                            >
                                {t('config.modelForm.getApiKey')}
                                <OpenIcon size={11} />
                            </a>
                        )}
                    </div>
                    <div className="input-group">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            id="apiKey"
                            value={apiKey}
                            onChange={(e) => {
                                setApiKey(e.target.value.trim());
                                setConnectionTested(false);
                                setConnectionSuccess(false);
                            }}
                            placeholder={defaults.apiKeyProviderLabel
                                ? t('config.modelForm.apiKeyPlaceholder', { provider: defaults.apiKeyProviderLabel })
                                : t('config.modelForm.apiKeyPlaceholderGeneric')}
                        />
                        <span
                            className={`input-icon ${showPassword ? 'hide-password' : 'show-password'}`}
                            onClick={() => setShowPassword(!showPassword)}
                        />
                    </div>
                    {/* <div className="description">您的 API 密钥，将安全存储在配置文件中</div> */}
                </div>

                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <label htmlFor="modelName">{t('config.modelForm.modelName')}</label>
                        {!isEditing && (
                            <span
                                className="label-action"
                                onClick={() => setIsManualInput(!isManualInput)}
                            >
                                {isManualInput ? t('config.modelForm.pickFromList') : t('config.modelForm.manualInput')}
                            </span>
                        )}
                    </div>

                    {!isManualInput ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <IconSelect
                                        id="modelNameSelect"
                                        value={selectedModel}
                                        onChange={(value) => {
                                            setSelectedModel(value);
                                            setConnectionTested(false);
                                            setConnectionSuccess(false);
                                            const selectedModelData = availableModels.find(m => m.id === value);
                                            if (selectedModelData?.recommended_max_tokens) {
                                                setMaxTokens(String(selectedModelData.recommended_max_tokens));
                                            }
                                            setSelectedModelMaxTokens(selectedModelData?.max_tokens ?? null);
                                            vscode.postMessage({ command: 'getModelAdapter', provider, modelName: value, baseURL });
                                        }}
                                        options={availableModels.map(model => ({
                                            value: model.id,
                                            label: model.name || model.id
                                        }))}
                                        disabled={availableModels.length === 0}
                                        placeholder={t('config.modelForm.fetchFirstPlaceholder')}
                                    />
                                </div>
                                <button
                                    type="button"
                                    className={`secondary ${isFetchingModels ? 'btn-loading' : ''}`}
                                    onClick={handleFetchModels}
                                    disabled={isFetchingModels}
                                    style={{ whiteSpace: 'nowrap', padding: '10px 16px' }}
                                >
                                    {isFetchingModels && <span className="spinner" />}
                                    {isFetchingModels ? t('config.modelForm.fetchingShort') : t('config.modelForm.fetchModels')}
                                </button>
                            </div>
                            {fetchModelsFailed && availableModels.length === 0 && (
                                <div className="description" style={{ marginTop: 0 }}>
                                    {t('config.modelForm.fetchHelpBefore')}
                                    <span
                                        style={{ color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'underline' }}
                                        onClick={() => setIsManualInput(true)}
                                    >
                                        {t('config.modelForm.fetchHelpLink')}
                                    </span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <input
                            type="text"
                            id="modelName"
                            value={modelName}
                            onChange={(e) => {
                                setModelName(e.target.value);
                                setConnectionTested(false);
                                setConnectionSuccess(false);
                            }}
                            placeholder={defaults.defaultModel ? t('config.modelForm.modelNamePlaceholderExample', { model: defaults.defaultModel }) : t('config.modelForm.modelNamePlaceholder')}
                            disabled={isEditing}
                        />
                    )}

                </div>

                <div className="form-group">
                    <label htmlFor="adapt">{t('config.modelForm.apiType')}</label>
                    <IconSelect
                        id="adapt"
                        value={adapt}
                        onChange={(value) => setAdapt(value as AdapterType)}
                        options={[
                            { value: 'openai', label: t('config.modelForm.openaiFormat') },
                            { value: 'anthropic', label: t('config.modelForm.anthropicFormat') }
                        ]}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="thinkingHistoryPolicy">{t('config.modelForm.thinkingHistory')}</label>
                    <IconSelect
                        id="thinkingHistoryPolicy"
                        value={thinkingHistoryPolicy}
                        onChange={(value) => setThinkingHistoryPolicy(value as ThinkingHistoryPolicy)}
                        options={THINKING_HISTORY_POLICY_OPTIONS.map(opt => ({ value: opt.value, label: t(opt.labelKey) }))}
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="maxTokens">{t('config.modelForm.maxTokens')}</label>
                        <IconSelect
                            id="maxTokens"
                            value={maxTokens}
                            onChange={setMaxTokens}
                            options={(defaults.maxTokensOptions ?? DEFAULT_MAX_TOKENS_OPTIONS).map(val => ({
                                value: String(val),
                                label: formatTokenCount(val),
                                disabled: selectedModelMaxTokens !== null && val > selectedModelMaxTokens
                            }))}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="contextLength">{t('config.modelForm.contextLength')}</label>
                        <IconSelect
                            id="contextLength"
                            value={contextLength}
                            onChange={setContextLength}
                            options={(defaults.contextLengthOptions ?? DEFAULT_CONTEXT_LENGTH_OPTIONS).map(val => ({
                                value: String(val),
                                label: formatTokenCount(val)
                            }))}
                        />
                    </div>
                </div>

                <div className="button-group">
                    <button
                        type="button"
                        className={`secondary ${testStatus.type === 'testing' ? 'btn-loading' : ''}`}
                        onClick={handleTestConnection}
                        disabled={testStatus.type === 'testing'}
                    >
                        {testStatus.type === 'testing' && <span className="spinner" />}
                        {testStatus.type === 'testing' ? t('config.modelForm.testingShort') : t('config.modelForm.testConnection')}
                    </button>
                    <button
                        type="submit"
                        className={isSaving ? 'btn-loading' : ''}
                        disabled={isSaving}
                    >
                        {isSaving && <span className="spinner" />}
                        {isSaving ? (isEditing ? t('common.saving') : t('common.adding')) : (isEditing ? t('config.modelForm.saveChanges') : t('config.modelForm.addModel'))}
                    </button>
                    {isEditing && (
                        <button
                            type="button"
                            className="secondary"
                            onClick={onCancelEdit}
                            disabled={isSaving}
                        >
                            {t('common.cancel')}
                        </button>
                    )}
                </div>

                {testStatus.type && (
                    <div className={`test-status ${testStatus.type}`}>
                        {testStatus.message}
                    </div>
                )}

                {message.type && (
                    <div className={`message ${message.type}`} style={{ display: 'flex' }}>
                        {message.text}
                    </div>
                )}
            </form>
        </div>
    );
};

export default AddModelForm;
