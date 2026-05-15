export type CommandScope = 'user' | 'project' | 'plugin'

export interface CommandConfig {
  name: string
  description: string
  prompt: string
  argumentHint?: string | string[]
  locate: CommandScope
  filePath?: string
}