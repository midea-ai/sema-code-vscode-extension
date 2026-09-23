/**
 * 界面文案 i18n 核心（无 React / 无 DOM 依赖，宿主与三个 webview 共用）。
 *
 * - 语言来源：webview 启动时读 <html lang>（宿主生成 HTML 时写入，避免首屏闪中文），
 *   之后由 systemConfigUpdate / langUpdate 消息驱动 setLang；宿主在 activate 与每次保存 lang 时调 setLang。
 * - React 组件请用 react.ts 的 useT()，非组件代码直接 import { t }。
 * - 模块顶层常量里不要调 t()（求值早于 setLang），改成函数或在渲染期取值。
 * - 字典分两档：zh / en 必须全量（漏写编译报错）；其他语言可选（Partial），缺的条目回退英文。
 *   以下分组只写 zh / en，不翻译到其他语言：
 *   config.usage.* / host.cfg.op.* / chat.task.* / config.mcp.status.* / config.hooks.status.* / host.demoReadme，
 *   以及各处错误提示（*.error、*Failed、*Error、*.err.*、*NotFound、*Invalid 等）。
 * - 新增语言：加字典文件 → 在 LANGS 登记一行 → 补 defaultConfig 的 DEFAULT_CUSTOM_RULES（漏写编译报错）
 *   → JB 侧补 SystemConfigManager.kt 的 HTML_LANGS 与 messages/SemaBundle_xx.properties。
 */
import { zh } from './zh';
import { en } from './en';
import { de } from './de';
import { fr } from './fr';
import { it } from './it';

export type I18nKey = keyof typeof zh;

interface LanguageMeta {
    /** 语言自称，任何界面语言下都原样显示，保证用户能认出自己的语言 */
    label: string;
    /** toLocaleDateString / toLocaleTimeString 使用的 locale */
    dateLocale: string;
    /** 字典；zh / en 全量，其余语言可缺条目（缺的回退英文） */
    dict: Partial<Record<I18nKey, string>>;
}

/** 受支持的界面语言注册表，Language 类型与下拉选项均由此推导。 */
export const LANGS = {
    zh: { label: '中文', dateLocale: 'zh-CN', dict: zh },
    en: { label: 'English', dateLocale: 'en-US', dict: en },
    de: { label: 'Deutsch', dateLocale: 'de-DE', dict: de },
    fr: { label: 'Français', dateLocale: 'fr-FR', dict: fr },
    it: { label: 'Italiano', dateLocale: 'it-IT', dict: it },
} satisfies Record<string, LanguageMeta>;

export type Language = keyof typeof LANGS;

/** 按登记顺序排列的语言码，用于渲染语言下拉框。 */
export const LANGUAGES = Object.keys(LANGS) as Language[];

/** 任意输入归一到受支持语言：取主语言码匹配注册表（'en-US' / 'zh_CN' → en / zh），匹配不到一律 zh。 */
export function normalizeLang(value: unknown): Language {
    const code = typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : '';
    return Object.prototype.hasOwnProperty.call(LANGS, code) ? code as Language : 'zh';
}

/** 宿主 tsconfig 不含 DOM lib，经 globalThis 取 <html> 元素；Node 环境下为 undefined。 */
function htmlElement(): { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void } | undefined {
    return (globalThis as any).document?.documentElement;
}

let currentLang: Language = (() => {
    const html = htmlElement();
    return html ? normalizeLang(html.getAttribute('lang')) : 'zh';
})();

const listeners = new Set<() => void>();

export function getLang(): Language {
    return currentLang;
}

export function setLang(value: unknown): void {
    const next = normalizeLang(value);
    if (next === currentLang) return;
    currentLang = next;
    htmlElement()?.setAttribute('lang', next);
    listeners.forEach(fn => fn());
}

export function subscribeLang(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** 取当前语言文案；{name} 占位符由 params 替换，缺省依次回退英文、中文，再缺省回退 key 本身。 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
    const text = LANGS[currentLang].dict[key] || en[key] || zh[key] || key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    );
}

/** 语言选择入口的 label：「当前语言文案 / Language」，英文兜底保证任一界面语言下都能找到；英文界面下只显示一次。 */
export function languageLabel(): string {
    const text = t('config.system.language');
    return currentLang === 'en' ? text : `${text} / Language`;
}
