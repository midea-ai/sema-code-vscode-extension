export type AdapterType = 'openai' | 'anthropic';

export interface ProviderDefaults {
    name: string;
    baseURL: string;
    baseURLPlaceholder?: string;
    apiKeyPlaceholder?: string;
    defaultModel?: string;
    modelsUrl?: string;  // 获取模型列表的 URL，默认用baseURL
    apikeyUrl?: string;
    /** 是否需要 API Key 才能获取模型列表，默认 true */
    requiresApiKeyForModelList?: boolean;
    /** 默认最大生成token数 */
    defaultMaxTokens?: number;
    /** 默认上下文窗口大小 */
    defaultContextLength?: number;
    /** 可选的最大生成token数列表 */
    maxTokensOptions?: number[];
    /** 可选的上下文窗口大小列表 */
    contextLengthOptions?: number[];
    /** 默认 API 适配器类型 */
    defaultAdapt?: AdapterType;
}

/** 全局默认的最大生成token数选项 */
export const DEFAULT_MAX_TOKENS_OPTIONS = [16000, 32000, 64000, 128000];

/** 全局默认的上下文窗口大小选项 */
export const DEFAULT_CONTEXT_LENGTH_OPTIONS = [128000, 256000, 512000, 1000000];

/** 全局默认最大生成token数 */
export const DEFAULT_MAX_TOKENS = 64000;

/** Main 任务推荐模型，为空则不显示推荐提示 */
export const RECOMMENDED_MAIN_MODEL = '';

/** Quick 任务推荐模型，为空则不显示推荐提示 */
export const RECOMMENDED_QUICK_MODEL = '';

/** 全局默认上下文窗口大小 */
export const DEFAULT_CONTEXT_LENGTH = 512000;

/** 默认提供商 key */
export const DEFAULT_PROVIDER = 'deepseek';

/** 提供商显示顺序 */
export const PROVIDER_ORDER = [
    'custom',
    'deepseek',
    'minimax',
    'glm',
    'mimo',
    'qwen',
    'kimi',
    'openrouter',
    'anthropic',
    'openai'
];

export const defaultModelProvider: Record<string, ProviderDefaults> = {
    'anthropic': {
        name: 'Anthropic',
        baseURL: 'https://api.anthropic.com',
        baseURLPlaceholder: 'https://api.anthropic.com',
        apiKeyPlaceholder: '输入您的 Anthropic API Key',
        defaultAdapt: 'anthropic',
    },
    'openai': {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        baseURLPlaceholder: 'https://api.openai.com/v1',
        apiKeyPlaceholder: '输入您的 OpenAI API Key',
        defaultAdapt: 'openai',
    },
    'kimi': {
        name: 'Kimi (Moonshot)',
        baseURL: 'https://api.moonshot.cn/v1',
        baseURLPlaceholder: 'https://api.moonshot.cn/v1',
        apiKeyPlaceholder: '输入您的 Moonshot API Key',
        defaultModel: 'kimi-k3',
        apikeyUrl: 'https://platform.moonshot.cn/console/api-keys',
        defaultAdapt: 'openai',
    },
    'minimax': {
        name: 'MiniMax',
        baseURL: 'https://api.minimaxi.com/anthropic',
        baseURLPlaceholder: 'https://api.minimaxi.com/anthropic',
        apiKeyPlaceholder: '输入您的 MiniMax API Key',
        defaultModel: 'MiniMax-M3',
        apikeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
        defaultAdapt: 'anthropic',
    },
    'deepseek': {
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com/anthropic',
        modelsUrl: 'https://api.deepseek.com/v1/models',
        baseURLPlaceholder: 'https://api.deepseek.com/anthropic',
        apiKeyPlaceholder: '输入您的 DeepSeek API Key',
        defaultModel: 'deepseek-v4-pro',
        apikeyUrl: 'https://platform.deepseek.com/api_keys',
        defaultAdapt: 'anthropic',
    },
    'glm': {
        name: 'GLM (智谱)',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        baseURLPlaceholder: 'https://open.bigmodel.cn/api/paas/v4',
        apiKeyPlaceholder: '输入您的智谱 API Key',
        defaultModel: 'glm-5.2',
        apikeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
        defaultAdapt: 'openai',
    },
    'openrouter': {
        name: 'OpenRouter',
        baseURL: 'https://openrouter.ai/api',
        modelsUrl: 'https://openrouter.ai/api/v1/models',
        baseURLPlaceholder: 'https://openrouter.ai/api/v1',
        apiKeyPlaceholder: '输入您的 OpenRouter API Key',
        defaultModel: 'anthropic/claude-opus-4.6',
        apikeyUrl: 'https://openrouter.ai/settings/keys',
        defaultAdapt: 'anthropic',
    },
    'qwen': {
        name: 'Qwen (Alibaba)',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        baseURLPlaceholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKeyPlaceholder: '输入您的阿里云 API Key',
        defaultModel: 'qwen3.7-max',
        apikeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?api-key',
        defaultAdapt: 'openai',
    },
    'mimo': {
        name: 'MiMo (Xiaomi)',
        baseURL: 'https://api.xiaomimimo.com/anthropic',
        modelsUrl: 'https://api.xiaomimimo.com/v1/models',
        baseURLPlaceholder: 'https://api.xiaomimimo.com/anthropic',
        apiKeyPlaceholder: '输入您的 Xiaomi MiMo API Key',
        defaultModel: 'mimo-v2.5-pro',
        apikeyUrl: 'https://platform.xiaomimimo.com/console/api-keys',
        defaultAdapt: 'anthropic',
    },
    'custom': {
        name: '自定义LLM接口',
        baseURL: '',
        baseURLPlaceholder: 'https://your-api.com/v1',
        apiKeyPlaceholder: '输入您的 API Key',
        defaultAdapt: 'openai',
    },
};
