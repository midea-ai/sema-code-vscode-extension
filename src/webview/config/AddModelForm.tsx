import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
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

const AddModelForm: React.FC<AddModelFormProps> = ({ onSuccess, vscode }) => {
    const [provider, setProvider] = useState(DEFAULT_PROVIDER);
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
    const [modelFilter, setModelFilter] = useState('');
    const [modelDocUrls, setModelDocUrls] = useState<Record<string, string>>({});
    const [testStatus, setTestStatus] = useState<{ message: string; type: 'testing' | 'success' | 'error' | '' }>({ message: '', type: '' });
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | '' }>({ text: '', type: '' });
    const [isFetchingModels, setIsFetchingModels] = useState(false);
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
                    const fetchUrl = providerConfig.modelsUrl || baseURL;
                    if (!requiresApiKey) {
                        setLastFetchedConfig({ baseURL: fetchUrl, apiKey: lastFetchedConfig.apiKey });
                    } else {
                        setLastFetchedConfig({ baseURL: fetchUrl, apiKey });
                    }

                    if (msg.success) {
                        if (msg.models && msg.models.length > 0) {
                            setAvailableModels(msg.models);
                            setModelFilter('');

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
                            vscode.postMessage({ command: 'getModelAdapter', provider, modelName: autoSelectedModel });

                            setTestStatus({
                                message: `✓ 成功获取 ${msg.models.length} 个模型`,
                                type: 'success'
                            });
                            setTimeout(() => setTestStatus({ message: '', type: '' }), 3000);
                        } else {
                            // 请求成功但没有模型
                            setTestStatus({
                                message: '✗ 请求成功，但没有返回可用模型',
                                type: 'error'
                            });
                        }
                    } else {
                        // 请求失败
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
        const defaults = defaultModelProvider[newProvider];
        setBaseURL(defaults.baseURL);
        setApiKey('');
        setModelName('');
        setAvailableModels([]);
        setSelectedModel('');
        setModelFilter('');
        setModelDocUrls({});
        setConnectionTested(false);
        setConnectionSuccess(false);
        setTestStatus({ message: '', type: '' });
        setLastFetchedConfig({ baseURL: '', apiKey: '' });
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
        const fetchUrl = providerConfig.modelsUrl || baseURL;
        vscode.postMessage({
            command: 'fetchModels',
            data: { provider, baseURL: fetchUrl, apiKey: apiKey || '' }
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

        setIsSaving(true);
        vscode.postMessage({
            command: 'saveConfig',
            data: {
                provider,
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

    const filteredModels = availableModels.filter(model =>
        !modelFilter ||
        model.id.toLowerCase().includes(modelFilter.toLowerCase()) ||
        (model.name && model.name.toLowerCase().includes(modelFilter.toLowerCase()))
    );

    useEffect(() => {
        if (isManualInput || filteredModels.length === 0) return;
        if (!filteredModels.find(m => m.id === selectedModel)) {
            const newModel = filteredModels[0].id;
            setSelectedModel(newModel);
            setConnectionTested(false);
            setConnectionSuccess(false);
            const selectedModelData = availableModels.find(m => m.id === newModel);
            if (selectedModelData?.recommended_max_tokens) {
                setMaxTokens(String(selectedModelData.recommended_max_tokens));
            }
            setSelectedModelMaxTokens(selectedModelData?.max_tokens ?? null);
            vscode.postMessage({ command: 'getModelAdapter', provider, modelName: newModel });
        }
    }, [modelFilter]);

    const defaults = defaultModelProvider[provider];

    return (
        <div className="form-card">
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="provider">服务提供商</label>
                    <select
                        id="provider"
                        value={provider}
                        onChange={(e) => handleProviderChange(e.target.value)}
                    >
                        {PROVIDER_ORDER.filter(key => defaultModelProvider[key]).map(key => (
                            <option key={key} value={key}>
                                {defaultModelProvider[key].name}
                            </option>
                        ))}
                    </select>
                </div>

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
                    <label htmlFor="apiKey">API Key</label>
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
                    <label htmlFor="modelName">模型名称</label>
                    <div className="description" style={{ marginBottom: '8px', marginTop: 0 }}>
                        <span
                            style={{ color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setIsManualInput(!isManualInput)}
                        >
                            {isManualInput ? '从列表选择' : '手动输入'}
                        </span>
                    </div>

                    {!isManualInput ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {availableModels.length > 20 && (
                                <input
                                    type="text"
                                    placeholder="模型列表超过20，搜索模型..."
                                    value={modelFilter}
                                    onChange={(e) => setModelFilter(e.target.value)}
                                    style={{ width: '100%' }}
                                />
                            )}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <select
                                    id="modelNameSelect"
                                    value={selectedModel}
                                    onChange={(e) => {
                                        setSelectedModel(e.target.value);
                                        setConnectionTested(false);
                                        setConnectionSuccess(false);
                                        const selectedModelData = availableModels.find(m => m.id === e.target.value);
                                        if (selectedModelData?.recommended_max_tokens) {
                                            setMaxTokens(String(selectedModelData.recommended_max_tokens));
                                        }
                                        setSelectedModelMaxTokens(selectedModelData?.max_tokens ?? null);
                                        vscode.postMessage({ command: 'getModelAdapter', provider, modelName: e.target.value });
                                    }}
                                    style={{ flex: 1 }}
                                >
                                    {availableModels.length === 0 ? (
                                        <option value="">-- 请先获取模型列表 --</option>
                                    ) : filteredModels.length === 0 ? (
                                        <option value="">-- 无匹配模型 --</option>
                                    ) : (
                                        filteredModels.map((model) => (
                                            <option key={model.id} value={model.id}>
                                                {model.name || model.id}
                                            </option>
                                        ))
                                    )}
                                </select>
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
                            placeholder="手动输入模型名称"
                        />
                    )}

                    {currentModelDocUrl && (
                        <div className="description" style={{ marginTop: '8px' }}>
                            api_key申请详见: <a href={currentModelDocUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline' }}>{currentModelDocUrl}</a>
                        </div>
                    )}
                </div>

                <div className="form-group">
                    <label htmlFor="adapt">API 类型</label>
                    <select
                        id="adapt"
                        value={adapt}
                        onChange={(e) => setAdapt(e.target.value as AdapterType)}
                    >
                        <option value="openai">OpenAI 格式</option>
                        <option value="anthropic">Anthropic 格式</option>
                    </select>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="maxTokens">最大生成token数</label>
                        <select id="maxTokens" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)}>
                            {(defaults.maxTokensOptions ?? DEFAULT_MAX_TOKENS_OPTIONS).map(val => (
                                <option
                                    key={val}
                                    value={val}
                                    disabled={selectedModelMaxTokens !== null && val > selectedModelMaxTokens}
                                >
                                    {Math.round(val / 1000)}k
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label htmlFor="contextLength">上下文窗口大小</label>
                        <select id="contextLength" value={contextLength} onChange={(e) => setContextLength(e.target.value)}>
                            {(defaults.contextLengthOptions ?? DEFAULT_CONTEXT_LENGTH_OPTIONS).map(val => (
                                <option key={val} value={val}>{Math.round(val / 1000)}k</option>
                            ))}
                        </select>
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
