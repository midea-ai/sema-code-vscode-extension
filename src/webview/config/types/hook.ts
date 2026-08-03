export type HookSource = 'user' | 'project'

/** 基础功能支持的 7 个 hook 事件（sema-core 未从 types 入口导出该常量，本地维护一份，用于固定展示顺序） */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'SessionEnd',
] as const

/** matcher 仅对工具类事件生效 */
export const TOOL_HOOK_EVENTS = new Set<string>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
])

export interface HookEntryInfo {
  event: string
  source: HookSource
  matcher?: string
  command: string
  timeout?: number
  status: 'ok' | 'skipped' | 'invalid'
  statusReason?: string
  /** 配置文件定位，格式同 MCPServerInfo.filePath："路径:起始行-结束行"，旧版 core 无此字段 */
  filePath?: string
}

export interface HooksInfo {
  userConfigPath: string
  projectConfigPath: string
  userConfigExists: boolean
  projectConfigExists: boolean
  parseErrors: Array<{ source: HookSource; message: string }>
  events: Record<string, HookEntryInfo[]>
}
