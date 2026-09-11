/**
 * i18n 的 React 绑定：useT() 订阅语言变化，组件内 `const t = useT();` 后按 key 取文案，
 * 语言切换时即使是 React.memo 包裹的组件也会重渲染。
 */
import { useSyncExternalStore } from 'react';
import { getLang, subscribeLang, t, Language } from './core';

export function useLang(): Language {
    return useSyncExternalStore(subscribeLang, getLang, getLang);
}

export function useT(): typeof t {
    useLang();
    return t;
}

export { t, getLang, setLang, normalizeLang, languageLabel, LANGS, LANGUAGES } from './core';
export type { Language, I18nKey } from './core';
