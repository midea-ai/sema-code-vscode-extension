/**
 * 默认系统配置
 * 这个文件不依赖任何 VSCode API，可以在 webview 中安全使用
 */
export const defaultConfig = {
    stream: true,
    thinking: true,
    showThinkingText: false,
    skipFileEditPermission: false,
    skipShellExecPermission: false,
    skipSkillPermission: false,
    skipMCPToolPermission: false,
    skipFetchUrlPermission: false,
    skipExternalFileReadPermission: true,
    systemPrompt: "You are Sema, AIRC's Agent AI for coding.",
    customRules: "- 中文回答",
    enableLLMCache: false,
    disableBackgroundTasks: false,
    enableToolSearch: true,
    enableInputPrediction: true,
    enablePet: false
};