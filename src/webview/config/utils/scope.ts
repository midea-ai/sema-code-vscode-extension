/** 界面层作用域：宿主注入（core 的 host）与 core 内置（builtin）统一算「内置」，只读 */
export const uiScope = <T extends string | undefined>(scope: T): Exclude<T, 'host'> | 'builtin' =>
    (scope === 'host' ? 'builtin' : scope) as Exclude<T, 'host'> | 'builtin';
