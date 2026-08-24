import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
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

/** 校验自定义服务商别名：留空合法（回退 custom），否则 2~20 位小写字母/数字/短横线，字母开头、不以短横线结尾 */
const validateCustomProviderName = (name: string): string | null => {
    if (!name) {
        return null;
    }
    if (name.length < 2 || name.length > 20) {
        return '长度需为 2~20 个字符';
    }
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
        return '仅支持小写字母、数字和短横线(-)，需以字母开头且不能以短横线结尾';
    }
    if (RESERVED_PROVIDERS.includes(name)) {
        return `"${name}" 是预设服务商名称，请换一个`;
    }
    return null;
};

const AddModelForm: React.FC<AddModelFormProps> = ({ onSuccess, vscode }) => {
    const [provider, setProvider] = useState(DEFAULT_PROVIDER);
    const [customProviderName, setCustomProviderName] = useState(DEFAULT_PROVIDER === 'custom' ? 'custom' : '');
    const [baseURL, setBaseURL] = useState(defaultModelProvider[DEFAULT_PROVIDER].baseURL);
    const [apiKey, setApiKey] = useState('');
    const [adapt, setAdapt] = useState<AdapterType>(defaultModelProvider[DEFAULT_PROVIDER].defaultAdapt ?? 'openai');
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
                                message: `✓ 成功获取 ${msg.models.length} 个模型`,
                                type: 'success'
                            });
                            setTimeout(() => setTestStatus({ message: '', type: '' }), 3000);
                        } else {
                            // 请求成功但没有模型
                            setFetchModelsFailed(true);
                            setTestStatus({
                                message: '✗ 请求成功，但没有返回可用模型',
                                type: 'error'
                            });
                        }
                    } else {
                        // 请求失败
                        setFetchModelsFailed(true);
                        setTestStatus({
                            message: `✗ ${msg.message || '获取模型列表失败'}`,
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
    };

    const handleFetchModels = () => {
        if (!baseURL) {
            setTestStatus({ message: '请输入模型地址', type: 'error' });
            return;
        }

        // 检查是否需要 API Key 才能获取模型列表
        const providerConfig = defaultModelProvider[provider];
        const requiresApiKey = providerConfig?.requiresApiKeyForModelList !== false;
        if (requiresApiKey && !apiKey) {
            setTestStatus({ message: '请输入 API Key', type: 'error' });
            return;
        }

        setTestStatus({ message: '正在获取模型列表...', type: 'testing' });
        setIsFetchingModels(true);
        vscode.postMessage({
            command: 'fetchModels',
            data: { provider, baseURL, apiKey: apiKey || '', adapt, modelsUrl: providerConfig.modelsUrl }
        });
    };

    const handleTestConnection = () => {
        const currentModelName = getCurrentModelName();

        if (!baseURL) {
            setTestStatus({ message: '请输入模型地址', type: 'error' });
            return;
        }
        if (!apiKey) {
            setTestStatus({ message: '请输入 API Key', type: 'error' });
            return;
        }
        if (!currentModelName) {
            setTestStatus({ message: '请先获取模型', type: 'error' });
            return;
        }

        setTestStatus({ message: '正在测试连接...', type: 'testing' });

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
            setMessage({ text: '请输入 API Key', type: 'error' });
            return;
        }
        if (!currentModelName) {
            setMessage({ text: '请先获取模型', type: 'error' });
            return;
        }
        if (!baseURL) {
            setMessage({ text: '请输入模型地址', type: 'error' });
            return;
        }

        if (!connectionTested) {
            setTestStatus({ message: '⚠ 请先点击"测试连接"按钮验证配置是否正确', type: 'error' });
            return;
        }

        if (!connectionSuccess) {
            setTestStatus({ message: '⚠ 连接测试未通过，请修正配置后重新测试', type: 'error' });
            return;
        }

        const aliasError = provider === 'custom' ? validateCustomProviderName(customProviderName) : null;
        if (aliasError) {
            setMessage({ text: `服务商名称不合法: ${aliasError}`, type: 'error' });
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
                adapt
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
                    <label htmlFor="provider">服务提供商</label>
                    <IconSelect
                        id="provider"
                        value={provider}
                        onChange={handleProviderChange}
                        options={PROVIDER_ORDER.filter(key => defaultModelProvider[key]).map(key => ({
                            value: key,
                            label: defaultModelProvider[key].name,
                            icon: <ProviderLogo provider={key} className="icon-select-logo" />
                        }))}
                    />
                </div>

                {provider === 'custom' && (
                    <div className="form-group">
                        <label htmlFor="customProviderName">服务商名称</label>
                        <input
                            type="text"
                            id="customProviderName"
                            value={customProviderName}
                            onChange={(e) => setCustomProviderName(e.target.value.trim())}
                            placeholder="为该服务命名以区分多个自定义服务，小写字母/数字/短横线，2~20 字符，留空默认为 custom"
                        />
                        {validateCustomProviderName(customProviderName) && (
                            <div className="description" style={{ color: 'var(--vscode-errorForeground)' }}>
                                {validateCustomProviderName(customProviderName)}
                            </div>
                        )}
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="baseURL">模型地址</label>
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
                                获取 API Key
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
                            placeholder={defaults.apiKeyPlaceholder}
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
                        <label htmlFor="modelName">模型名称</label>
                        <span
                            className="label-action"
                            onClick={() => setIsManualInput(!isManualInput)}
                        >
                            {isManualInput ? '从列表选择' : '手动输入'}
                        </span>
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
                                        placeholder="-- 请先获取模型列表 --"
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
                                    {isFetchingModels ? '获取中...' : '获取模型'}
                                </button>
                            </div>
                            {fetchModelsFailed && availableModels.length === 0 && (
                                <div className="description" style={{ marginTop: 0 }}>
                                    获取不到模型列表？该服务商可能不支持列出模型，可以
                                    <span
                                        style={{ color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'underline' }}
                                        onClick={() => setIsManualInput(true)}
                                    >
                                        手动输入模型名称
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
                            placeholder={defaults.defaultModel ? `输入模型名称，例如: ${defaults.defaultModel}` : '输入模型名称'}
                        />
                    )}

                </div>

                <div className="form-group">
                    <label htmlFor="adapt">API 类型</label>
                    <IconSelect
                        id="adapt"
                        value={adapt}
                        onChange={(value) => setAdapt(value as AdapterType)}
                        options={[
                            { value: 'openai', label: 'OpenAI 格式' },
                            { value: 'anthropic', label: 'Anthropic 格式' }
                        ]}
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="maxTokens">最大生成token数</label>
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
                        <label htmlFor="contextLength">上下文窗口大小</label>
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
                        {testStatus.type === 'testing' ? '测试中...' : '测试连接'}
                    </button>
                    <button
                        type="submit"
                        className={isSaving ? 'btn-loading' : ''}
                        disabled={isSaving}
                    >
                        {isSaving && <span className="spinner" />}
                        {isSaving ? '添加中...' : '添加模型'}
                    </button>
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
