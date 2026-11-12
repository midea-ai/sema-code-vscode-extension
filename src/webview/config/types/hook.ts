/** builtin：宿主注入（core 的 host），界面层归为内置，只读 */
export type HookSource = 'user' | 'project' | 'plugin' | 'builtin'

/** 支持的 11 个 hook 事件（与 sema-core HOOK_EVENTS 对齐；core 未从 types 入口导出该常量，本地维护一份，用于固定展示顺序、新增表单的事件下拉与导入过滤） */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'SessionEnd',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
] as const

export type HookEventName = (typeof HOOK_EVENTS)[number]

/** matcher 仅对工具类事件生效 */
export const TOOL_HOOK_EVENTS = new Set<string>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
])

export interface HookEntryInfo {
  /** 条目标识（hook 没有名字）：core 按来源 + 插件名 + 事件 + matcher + 命令算出，删除 / 启停的入参；内容完全相同的重复条目共用一个 id */
  id: string
  /** 是否启用（settings 的 disabledHooks 控制，用户级 + 项目级并集；内置条目恒为启用）；与 status 独立，都满足才会执行 */
  enabled: boolean
  event: string
  source: HookSource
  /** 仅插件来源：所属插件名 */
  pluginName?: string
  matcher?: string
  command: string
  timeout?: number
  status: 'ok' | 'skipped' | 'invalid'
  statusReason?: string
  /** 配置文件定位，格式同 MCPServerInfo.filePath："路径:起始行-结束行"，旧版 core 无此字段 */
  filePath?: string
}

/** 新增 hook 的入参（与 sema-core HookConfig 对齐）：写入 scope 对应层的 hooks.json */
export interface HookConfig {
  scope: 'user' | 'project'
  event: HookEventName
  /** 仅工具类事件生效；缺省匹配全部工具 */
  matcher?: string
  command: string
  /** 秒，缺省 60 */
  timeout?: number
  /** hook 执行失败时按阻断处理，缺省 false */
  failClosed?: boolean
}

export interface HooksInfo {
  userConfigPath: string
  projectConfigPath: string
  userConfigExists: boolean
  projectConfigExists: boolean
  parseErrors: Array<{ source: HookSource; pluginName?: string; message: string }>
  events: Record<string, HookEntryInfo[]>
}
