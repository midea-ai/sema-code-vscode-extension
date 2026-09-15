/**
 * 默认系统配置
 * 这个文件不依赖任何 VSCode API，可以在 webview 中安全使用
 */
import type { Language } from '../../common/i18n/core';

/** 各语言下 customRules 的默认值；Record<Language> 约束新增语言时必须补齐 */
export const DEFAULT_CUSTOM_RULES: Record<Language, string> = {
    zh: '- 中文回答',
    en: '- Answer in English',
    de: '- Antworte auf Deutsch',
    fr: '- Réponds en français',
    it: '- Rispondi in italiano',
};

/**
 * customRules 是否仍为某个语言的内置默认值（整体比较，忽略首尾空白）。
 * 切换语言时只有这种情况才替换为目标语言默认值，用户改过的规则一律不动。
 */
export function isBuiltinCustomRules(rules: unknown): boolean {
    const current = String(rules ?? '').trim();
    return Object.values(DEFAULT_CUSTOM_RULES).some(rule => rule.trim() === current);
}

export const defaultConfig = {
    lang: 'zh' as Language,
    stream: true,
    thinking: true,
    showThinkingText: false,
    skipFileEditPermission: false,
    skipShellExecPermission: false,
    skipSkillPermission: false,
    skipMCPToolPermission: false,
    skipFetchUrlPermission: false,
    skipExternalFileReadPermission: true,
    fetchUrlBrowserUserAgent: true,
    systemPrompt: "You are Sema, AIRC's Agent AI for coding.",
    customRules: DEFAULT_CUSTOM_RULES.zh,
    disableBackgroundTasks: false,
    enableToolSearch: true,
    enableInputPrediction: true,
    enablePet: false,
    enableBrowserControl: false,
    defaultPermissionLevel: 'AutoRun'
};