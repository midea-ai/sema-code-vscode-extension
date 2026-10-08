import type { I18nKey } from '../../common/i18n/react';

export type AdapterType = 'openai' | 'anthropic';

export interface ProviderDefaults {
    /** 显示名（品牌名写死，不进字典）；需要按语言显示的服务商（如自定义接口）另给 nameKey，渲染期有 nameKey 则 t(nameKey) */
    name: string;
    nameKey?: I18nKey;
    baseURL: string;
    baseURLPlaceholder?: string;
    /**
     * API Key 输入框 placeholder 里的品牌名，渲染期拼进 'config.modelForm.apiKeyPlaceholder' 模板；
     * 为空（如自定义接口、智谱）则用 'config.modelForm.apiKeyPlaceholderGeneric'。
     */
    apiKeyProviderLabel?: string;
    defaultModel?: string;
    modelsUrl?: string;  // 获取模型列表的 URL，默认用baseURL
    /** 内置模型列表：无 modelsUrl 时直接使用，有 modelsUrl 时作为远端获取失败的兜底 */
    presetModels?: { id: string; name: string }[];
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

/** Main 任务推荐提示的字典 key，为空则不显示推荐提示（渲染期 t() 取值） */
export const RECOMMENDED_MAIN_MODEL_KEY: I18nKey | '' = 'config.task.recommendMain';

/** Quick 任务推荐提示的字典 key，为空则不显示推荐提示（渲染期 t() 取值） */
export const RECOMMENDED_QUICK_MODEL_KEY: I18nKey | '' = 'config.task.recommendQuick';

/** 全局默认上下文窗口大小 */
export const DEFAULT_CONTEXT_LENGTH = 1000000;

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
    'volcengine',
    'openrouter',
    'anthropic',
    'openai'
];

export const defaultModelProvider: Record<string, ProviderDefaults> = {
    'anthropic': {
        name: 'Anthropic',
        baseURL: 'https://api.anthropic.com',
        // 官方 Models API 默认一页只返回 20 条，带 limit 一次拉全
        modelsUrl: 'https://api.anthropic.com/v1/models?limit=1000',
        baseURLPlaceholder: 'https://api.anthropic.com',
        apiKeyProviderLabel: 'Anthropic',
        defaultAdapt: 'anthropic',
    },
    'openai': {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        baseURLPlaceholder: 'https://api.openai.com/v1',
        apiKeyProviderLabel: 'OpenAI',
        defaultAdapt: 'openai',
    },
    'kimi': {
        name: 'Kimi (Moonshot)',
        baseURL: 'https://api.moonshot.cn/v1',
        baseURLPlaceholder: 'https://api.moonshot.cn/v1',
        apiKeyProviderLabel: 'Moonshot',
        defaultModel: 'kimi-k3',
        apikeyUrl: 'https://platform.moonshot.cn/console/api-keys',
        defaultAdapt: 'openai',
    },
    'minimax': {
        name: 'MiniMax',
        baseURL: 'https://api.minimaxi.com/anthropic',
        modelsUrl: 'https://api.minimaxi.com/anthropic/v1/models',
        baseURLPlaceholder: 'https://api.minimaxi.com/anthropic',
        apiKeyProviderLabel: 'MiniMax',
        defaultModel: 'MiniMax-M3',
        apikeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
        defaultAdapt: 'anthropic',
    },
    'deepseek': {
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com/anthropic',
        modelsUrl: 'https://api.deepseek.com/v1/models',
        baseURLPlaceholder: 'https://api.deepseek.com/anthropic',
        apiKeyProviderLabel: 'DeepSeek',
        defaultModel: 'deepseek-v4-pro',
        apikeyUrl: 'https://platform.deepseek.com/api_keys',
        defaultAdapt: 'anthropic',
    },
    'glm': {
        name: 'GLM (智谱)',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        baseURLPlaceholder: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-5.3',
        apikeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
        defaultAdapt: 'openai',
    },
    'openrouter': {
        name: 'OpenRouter',
        baseURL: 'https://openrouter.ai/api',
        modelsUrl: 'https://openrouter.ai/api/v1/models',
        baseURLPlaceholder: 'https://openrouter.ai/api/v1',
        apiKeyProviderLabel: 'OpenRouter',
        defaultModel: 'anthropic/claude-opus-4.6',
        apikeyUrl: 'https://openrouter.ai/settings/keys',
        defaultAdapt: 'anthropic',
    },
    'qwen': {
        name: 'Qwen (Alibaba)',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        baseURLPlaceholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKeyProviderLabel: 'Alibaba Cloud',
        defaultModel: 'qwen3.8-max',
        apikeyUrl: 'https://bailian.console.aliyun.com/cn-beijing?api-key',
        defaultAdapt: 'openai',
    },
    'volcengine': {
        name: 'Volcengine (火山引擎)',
        // 火山方舟按量付费通用地址（OpenAI 协议）；Coding Plan 用户可改为 https://ark.cn-beijing.volces.com/api/coding 并切 Anthropic 适配
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        baseURLPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKeyProviderLabel: 'Volcengine',
        defaultModel: 'doubao-seed-2-1-pro-260915',
        apikeyUrl: 'https://ark.volcengine.com/region:cn-beijing/apiKey',
        defaultAdapt: 'openai',
        // 方舟没有模型列表接口，使用内置列表（来源：方舟文档「模型列表」文本生成模型）
        presetModels: [
            { id: 'doubao-seed-2-1-pro-260915', name: 'Doubao Seed 2.1 Pro' },
            { id: 'doubao-seed-2-1-lite-260915', name: 'Doubao Seed 2.1 Lite' },
            { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao Seed 2.1 Turbo' },
        ],
    },
    'mimo': {
        name: 'MiMo (Xiaomi)',
        baseURL: 'https://api.xiaomimimo.com/anthropic',
        modelsUrl: 'https://api.xiaomimimo.com/v1/models',
        baseURLPlaceholder: 'https://api.xiaomimimo.com/anthropic',
        apiKeyProviderLabel: 'Xiaomi MiMo',
        defaultModel: 'mimo-v2.6-pro',
        apikeyUrl: 'https://platform.xiaomimimo.com/console/api-keys',
        defaultAdapt: 'anthropic',
    },
    'custom': {
        name: 'Custom LLM API',
        nameKey: 'config.modelForm.provider.custom',
        baseURL: '',
        baseURLPlaceholder: 'https://your-api.com/v1',
        // 无品牌名 → 渲染期用 'config.modelForm.apiKeyPlaceholderGeneric'
        defaultAdapt: 'openai',
    },
};
