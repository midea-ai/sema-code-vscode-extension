
// MCP 相关类型定义

/**
 * MCP Server 传输类型
 */
export type MCPTransportType = 'stdio' | 'sse' | 'http'

/**
 * MCP Server 安装范围类型
 */
export type MCPScopeType = 'local' | 'project' | 'user' | 'plugin'

/**
 * MCP Server 配置
 */
export interface MCPServerConfig {
  /** 服务名称（唯一标识） */
  name: string
  /** 传输类型 */
  transport: MCPTransportType
  /** 服务描述 */
  description?: string
  /** 是否启用，默认 true */
  enabled?: boolean
  /** 允许使用的工具列表，null 或 undefined 表示使用所有工具 */
  useTools?: string[] | null

  // stdio 类型配置
  /** 可执行命令 */
  command?: string
  /** 命令参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  // /** 工作目录 */
  // cwd?: string

  // sse/http 类型配置
  /** 服务 URL */
  url?: string
  /** 请求头 */
  headers?: Record<string, string>

  scope: MCPScopeType
}

/**
 * MCP Server 状态
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * MCP 工具定义
 */
export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, any>
    required?: string[]
  }
}

/**
 * MCP Server 能力
 * 先不支持resources、prompts
 */
export interface MCPServerCapabilities {
  tools?: MCPToolDefinition[]
  // resources?: MCPResourceDefinition[]
  // prompts?: MCPPromptDefinition[]
}

/**
 * MCP Server 详细信息
 */
export interface MCPServerInfo {
  config: MCPServerConfig
  connectStatus: MCPServerStatus  // 连接状态
  status: boolean  // 是否生效
  capabilities?: MCPServerCapabilities
  error?: string
  connectedAt?: number
  scope?: MCPScopeType
  filePath?: string
}

// MCP 市场相关类型
export interface MCPMarketInfo {
    config: MCPServerConfig;
    description: string;
    icon: string;
    github?: string;
    tools: string[];
    tags: string[];
    filePath?: string
}