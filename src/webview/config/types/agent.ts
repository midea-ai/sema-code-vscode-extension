export type AgentScope = 'user' | 'project' | 'builtin' | 'plugin'

export interface AgentConfig {
  name: string
  description: string
  tools: string[] | '*'  // 默认 '*' 
  model: string  // haiku quick 对应 quick ，其他值均对应 main
  locate: AgentScope
  filePath?: string
}