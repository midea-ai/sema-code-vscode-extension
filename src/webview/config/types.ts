// 模型管理相关接口
export interface ModelConfig {
    provider: string;
    modelName: string;
    baseURL: string;
    apiKey: string;
    maxTokens: number;
    contextLength: number;
}

export interface TaskConfig {
    main: string;
    quick: string;
}

// 模型信息接口
export interface ModelInfo {
    id: string;
    name: string;
    ownedBy?: string;
    key_doc_url?: string;
}

// 获取模型列表参数接口
export interface FetchModelsParams {
    baseURL: string;
    apiKey: string;
}

// 获取模型列表结果接口
export interface FetchModelsResult {
    success: boolean;
    models?: ModelInfo[];
    message?: string;
    curlCommand?: string;
}

// API 连接测试结果接口
export interface ApiTestResult {
    success: boolean;
    message: string;
    curlCommand?: string;
}

// API 连接测试参数接口
export interface ApiTestParams {
    baseURL: string;
    apiKey: string;
    modelName: string;
}

// 模型更新数据接口
export interface ModelUpdateData {
    modelName: string;
    modelList: string[];
    taskConfig: {
        main: string;
        quick: string;
    };
}

// webview 配置接口，直接使用 ModelUpdateData
export interface Config extends ModelUpdateData {}

export interface VscodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

declare global {
    interface Window {
        acquireVsCodeApi(): VscodeApi;
    }
}

// 工具信息类型
export interface ToolInfo {
  name: string
  description: string
  status: 'enable' | 'disable'
}

// 系统工具数据（带启用状态）
export interface SystemToolInfo extends ToolInfo {
  enabled: boolean
}

// 系统工具数据
export interface SystemToolsData {
  tools: SystemToolInfo[]
}

// 工具预设类型
export interface ToolPreset {
  name: string;
  tools: string[];
}

// 工具预设集合类型
export type ToolPresets = {
  [key: string]: ToolPreset;
};
