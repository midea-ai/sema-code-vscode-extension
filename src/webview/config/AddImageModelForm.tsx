import React, { useState, useEffect, useRef } from 'react';
import { ImageModelProfile, VscodeApi } from './types';
import ProviderLogo from '../common/ProviderLogo';
import IconSelect from './IconSelect';
import { OpenIcon } from './utils/svgIcons';
import { PROVIDER_ORDER } from './default/defaultModelProvider';
import {
    defaultImageProvider,
    DEFAULT_IMAGE_PROVIDER,
    IMAGE_PROVIDER_ORDER,
    isTextToImageModel,
    ImageListModel
} from './default/defaultImageProvider';
import { useT, t } from '../common/i18n/react';

interface AddImageModelFormProps {
    onSuccess: () => void;
    /** 编辑模式下点「取消」：由 App 清空编辑目标并回到列表 */
    onCancelEdit: () => void;
    /** 非空即编辑模式：按其回填并锁住 provider/模型名；变为空时表单重置为空白新增态 */
    editModel: ImageModelProfile | null;
    /** 每次进入编辑递增，保证连续编辑同一模型也能重新回填 */
    editNonce: number;
    /** 新增页是否正在显示：表单常驻挂载、靠 display 切换，需要由 App 告知何时可见 */
    active: boolean;
    vscode: VscodeApi;
}

/** 自定义别名不允许与对话模型预设、图像模型预设重名（custom 本身除外，等价于不填） */
const RESERVED_PROVIDERS = Array.from(new Set([...PROVIDER_ORDER, ...IMAGE_PROVIDER_ORDER])).filter(key => key !== 'custom');

/** 校验自定义服务商别名：规则同对话模型（留空合法，2~20 位小写字母/数字/短横线） */
const validateCustomProviderName = (name: string): string | null => {
    if (!name) return null;
    if (name.length < 2 || name.length > 20) return t('config.modelForm.aliasLength');
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) return t('config.modelForm.aliasCharset');
    if (RESERVED_PROVIDERS.includes(name)) return t('config.modelForm.aliasReserved', { name });
    return null;
};

const isPresetProvider = (key: string) => key !== 'custom' && IMAGE_PROVIDER_ORDER.includes(key) && !!defaultImageProvider[key];

/**
 * 新增 / 编辑图像模型：编辑态锁定 provider 与模型名，保存走 core.addImageModel 同名覆盖。
 * 不提供「测试连接」：core 没有图像模型的连接测试（测一次要真实出图）。
 */
const AddImageModelForm: React.FC<AddImageModelFormProps> = ({ onSuccess, onCancelEdit, editModel, editNonce, active, vscode }) => {
    const t = useT();
    const isEditing = editModel !== null;
    const [provider, setProvider] = useState(DEFAULT_IMAGE_PROVIDER);
    const [customProviderName, setCustomProviderName] = useState('');
    const [baseURL, setBaseURL] = useState(defaultImageProvider[DEFAULT_IMAGE_PROVIDER].baseURL);
    const [apiKey, setApiKey] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isManualInput, setIsManualInput] = useState(false);
    const [modelName, setModelName] = useState('');
    const [selectedModel, setSelectedModel] = useState('');
    const [availableModels, setAvailableModels] = useState<ImageListModel[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [fetchModelsFailed, setFetchModelsFailed] = useState(false);
    const [fetchStatus, setFetchStatus] = useState<{ message: string; type: 'testing' | 'success' | 'error' | '' }>({ message: '', type: '' });
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | '' }>({ text: '', type: '' });
    const [isSaving, setIsSaving] = useState(false);
    const apiKeyInputRef = useRef<HTMLInputElement>(null);

    const defaults = defaultImageProvider[provider];
    /** 有列表接口或内置列表的服务商才提供下拉选择；自定义接口只能手动输入 */
    const hasList = !!(defaults.modelsUrl || defaults.presetModels?.length);
    const pickFromList = hasList && !isManualInput;

    // 进入新增页（含从编辑态切回新增）时聚焦 API Key：服务商与地址有默认值，第一个要填的就是它；编辑态不抢焦点
    useEffect(() => {
        if (active && !editModel) apiKeyInputRef.current?.focus();
    }, [active, editModel]);

    /** 把模型列表填入下拉并选中默认模型，remote 与 preset 两种来源共用 */
    const applyModelList = (models: ImageListModel[]) => {
        setFetchModelsFailed(false);
        setAvailableModels(models);
        const preferred = defaults.defaultModel && models.find(m => m.id === defaults.defaultModel);
        setSelectedModel(preferred ? preferred.id : models[0].id);
    };

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;
            switch (msg.command) {
                case 'saveImageResult':
                    setIsSaving(false);
                    setMessage({ text: msg.message, type: msg.success ? 'success' : 'error' });
                    setTimeout(() => setMessage({ text: '', type: '' }), 100);
                    if (msg.success) setTimeout(() => onSuccess(), 100);
                    break;

                case 'imageModelsResult': {
                    setIsFetchingModels(false);
                    // 只保留能凭提示词出图的模型
                    const models = ((msg.models || []) as ImageListModel[]).filter(isTextToImageModel);
                    if (msg.success && models.length > 0) {
                        applyModelList(models);
                        setFetchStatus({ message: t('config.modelForm.fetchedModels', { count: models.length }), type: 'success' });
                        setTimeout(() => setFetchStatus({ message: '', type: '' }), 3000);
                    } else {
                        setFetchStatus({
                            message: msg.success ? t('config.modelForm.noModelsReturned') : `✗ ${msg.message || t('config.modelForm.fetchFailed')}`,
                            type: 'error'
                        });
                        // 远端拿不到时用内置列表兜底，没有内置列表才算没有模型列表
                        if (defaults.presetModels?.length) applyModelList(defaults.presetModels);
                        else setFetchModelsFailed(true);
                    }
                    break;
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [provider, onSuccess]);

    const handleProviderChange = (newProvider: string) => {
        setProvider(newProvider);
        setCustomProviderName(newProvider === 'custom' ? 'custom' : '');
        setBaseURL(defaultImageProvider[newProvider].baseURL);
        setApiKey('');
        setShowPassword(false);
        setModelName('');
        setSelectedModel('');
        setAvailableModels([]);
        setFetchModelsFailed(false);
        setIsManualInput(false);
        setFetchStatus({ message: '', type: '' });
        setMessage({ text: '', type: '' });
    };

    /** 编辑目标变化：非空按落盘配置回填（模型名走手动输入分支），变为空时整表重置为默认值 */
    useEffect(() => {
        if (!editModel) {
            handleProviderChange(DEFAULT_IMAGE_PROVIDER);
            return;
        }
        const preset = isPresetProvider(editModel.provider);
        setProvider(preset ? editModel.provider : 'custom');
        setCustomProviderName(preset ? '' : editModel.provider);
        setBaseURL(editModel.baseURL ?? '');
        setApiKey(editModel.apiKey ?? '');
        setShowPassword(false);
        setIsManualInput(true);
        setModelName(editModel.modelName);
        setSelectedModel('');
        setAvailableModels([]);
        setFetchModelsFailed(false);
        setFetchStatus({ message: '', type: '' });
        setMessage({ text: '', type: '' });
    }, [editModel, editNonce]);

    const handleFetchModels = () => {
        // 没有列表接口但有内置列表的服务商，直接使用内置列表，不请求 core
        if (!defaults.modelsUrl && defaults.presetModels?.length) {
            applyModelList(defaults.presetModels);
            setFetchStatus({ message: '', type: '' });
            return;
        }
        if (!baseURL) {
            setFetchStatus({ message: t('config.modelForm.needBaseUrl'), type: 'error' });
            return;
        }
        if (defaults.requiresApiKeyForModelList !== false && !apiKey) {
            setFetchStatus({ message: t('config.modelForm.needApiKey'), type: 'error' });
            return;
        }
        setFetchStatus({ message: t('config.modelForm.fetching'), type: 'testing' });
        setIsFetchingModels(true);
        vscode.postMessage({
            command: 'fetchImageModels',
            data: { provider, baseURL, apiKey: apiKey || '', adapt: 'openai', modelsUrl: defaults.modelsUrl }
        });
    };

    const currentModelName = pickFromList ? selectedModel : modelName.trim();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!baseURL.trim()) {
            setMessage({ text: t('config.modelForm.needBaseUrl'), type: 'error' });
            return;
        }
        if (!apiKey) {
            setMessage({ text: t('config.modelForm.needApiKey'), type: 'error' });
            return;
        }
        if (!currentModelName) {
            setMessage({ text: t('config.modelForm.needModel'), type: 'error' });
            return;
        }
        // 编辑态别名已锁定且是落盘值，不再校验
        const aliasError = provider === 'custom' && !isEditing ? validateCustomProviderName(customProviderName) : null;
        if (aliasError) {
            setMessage({ text: t('config.modelForm.aliasInvalid', { error: aliasError }), type: 'error' });
            return;
        }
        setIsSaving(true);
        vscode.postMessage({
            command: 'saveImageConfig',
            data: {
                provider: provider === 'custom' && customProviderName ? customProviderName : provider,
                baseURL: baseURL.trim(),
                apiKey,
                modelName: currentModelName,
                isEdit: isEditing
            }
        });
    };

    const aliasError = provider === 'custom' && !isEditing ? validateCustomProviderName(customProviderName) : null;

    return (
        <div className="form-card model-form-card">
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="imageProvider">{t('config.modelForm.provider')}</label>
                    <IconSelect
                        id="imageProvider"
                        value={provider}
                        onChange={handleProviderChange}
                        disabled={isEditing}
                        options={IMAGE_PROVIDER_ORDER.filter(key => defaultImageProvider[key]).map(key => ({
                            value: key,
                            label: defaultImageProvider[key].nameKey ? t(defaultImageProvider[key].nameKey!) : defaultImageProvider[key].name,
                            icon: <ProviderLogo provider={key} className="icon-select-logo" />
                        }))}
                    />
                </div>

                {provider === 'custom' && (
                    <div className="form-group">
                        <label htmlFor="imageCustomProviderName">{t('config.modelForm.providerName')}</label>
                        <input
                            type="text"
                            id="imageCustomProviderName"
                            value={customProviderName}
                            onChange={(e) => setCustomProviderName(e.target.value.trim())}
                            disabled={isEditing}
                            placeholder={t('config.modelForm.providerNamePlaceholder')}
                        />
                        {aliasError && (
                            <div className="description" style={{ color: 'var(--vscode-errorForeground)' }}>{aliasError}</div>
                        )}
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="imageBaseURL">{t('config.modelForm.baseUrl')}</label>
                    <input
                        type="text"
                        id="imageBaseURL"
                        value={baseURL}
                        onChange={(e) => setBaseURL(e.target.value)}
                        placeholder={defaults.baseURLPlaceholder || defaults.baseURL}
                    />
                </div>

                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <label htmlFor="imageApiKey">API Key</label>
                        {defaults.apikeyUrl && (
                            <a
                                className="label-action"
                                href={defaults.apikeyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={defaults.apikeyUrl}
                            >
                                {t('config.modelForm.getApiKey')}
                                <OpenIcon size={11} />
                            </a>
                        )}
                    </div>
                    <div className="input-group">
                        <input
                            ref={apiKeyInputRef}
                            type={showPassword ? 'text' : 'password'}
                            id="imageApiKey"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value.trim())}
                            placeholder={t('config.modelForm.apiKeyPlaceholderGeneric')}
                        />
                        <span
                            className={`input-icon ${showPassword ? 'hide-password' : 'show-password'}`}
                            onClick={() => setShowPassword(!showPassword)}
                        />
                    </div>
                </div>

                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <label htmlFor="imageModelName">{t('config.modelForm.modelName')}</label>
                        {!isEditing && hasList && (
                            <span className="label-action" onClick={() => setIsManualInput(!isManualInput)}>
                                {isManualInput ? t('config.modelForm.pickFromList') : t('config.modelForm.manualInput')}
                            </span>
                        )}
                    </div>

                    {pickFromList ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <IconSelect
                                        id="imageModelNameSelect"
                                        value={selectedModel}
                                        onChange={setSelectedModel}
                                        options={availableModels.map(model => ({ value: model.id, label: model.name || model.id }))}
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
                            id="imageModelName"
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            placeholder={defaults.defaultModel ? t('config.modelForm.modelNamePlaceholderExample', { model: defaults.defaultModel }) : t('config.modelForm.modelNamePlaceholder')}
                            disabled={isEditing}
                        />
                    )}
                </div>

                <div className="button-group">
                    <button
                        type="submit"
                        className={isSaving ? 'btn-loading' : ''}
                        disabled={isSaving}
                    >
                        {isSaving && <span className="spinner" />}
                        {isSaving ? (isEditing ? t('common.saving') : t('common.adding')) : (isEditing ? t('config.modelForm.saveChanges') : t('config.imageList.add'))}
                    </button>
                    {isEditing && (
                        <button type="button" className="secondary" onClick={onCancelEdit} disabled={isSaving}>
                            {t('common.cancel')}
                        </button>
                    )}
                </div>

                {fetchStatus.type && (
                    <div className={`test-status ${fetchStatus.type}`}>{fetchStatus.message}</div>
                )}

                {message.type && (
                    <div className={`message ${message.type}`} style={{ display: 'flex' }}>{message.text}</div>
                )}
            </form>
        </div>
    );
};

export default AddImageModelForm;
