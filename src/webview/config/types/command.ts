/** builtin：宿主注入（core 的 host），界面层归为内置，只读 */
export type CommandScope = 'user' | 'project' | 'plugin' | 'builtin'

export interface CommandConfig {
  name: string
  description: string
  prompt: string
  argumentHint?: string | string[]
  locate: CommandScope
  filePath?: string
}