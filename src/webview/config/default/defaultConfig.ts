/**
 * 默认系统配置
 * 这个文件不依赖任何 VSCode API，可以在 webview 中安全使用
 */
export const defaultConfig = {
    stream: true,
    thinking: true,
    skipFileEditPermission: false,
    skipBashExecPermission: false,
    skipSkillPermission: false,
    skipMCPToolPermission: false,
    systemPrompt: "You are Sema, AIRC's Agent AI for coding.",
    customRules: "- 中文回答",
    enableLLMCache: false,
    enableClaudeCodeCompat: true,
    disableBackgroundTasks: false,
    useTools: null  // null 表示使用所有工具，string[] 表示只使用指定工具
};