/**
 * 工具行 / 权限卡里文件路径的展示规则。
 * core 事件的 title 已统一为「项目内相对工作目录、项目外绝对路径」（不含 `../`）；
 * 本模块只负责人类友好渲染：绝对路径里的 home 缩写为 ~、取文件名。打开文件 / diff 仍用原始路径。
 * home 真值由宿主在 webview 启动时经 envInfo 消息下发（VSCode host / JB Kotlin），不用正则猜。
 */

let HOME_DIR = '';
let CASE_INSENSITIVE = false;

export interface PathEnv {
    homeDir?: string;
    /** process.platform 风格：win32 时路径比较忽略大小写 */
    platform?: string;
}

export function setPathEnv(env: PathEnv): void {
    HOME_DIR = (env.homeDir || '').replace(/[\\/]+$/, '');
    CASE_INSENSITIVE = env.platform === 'win32';
}

/** 文件名（兼容 / 与 \ 分隔符） */
export function baseName(p: string): string {
    return p.split(/[/\\]/).pop() || p;
}

function startsWithDir(p: string, dir: string): boolean {
    if (!dir || p.length < dir.length) return false;
    const head = p.slice(0, dir.length);
    const same = CASE_INSENSITIVE ? head.toLowerCase() === dir.toLowerCase() : head === dir;
    if (!same) return false;
    const rest = p.slice(dir.length);
    return rest === '' || /^[\\/]/.test(rest);
}

/**
 * 显示用路径：home 下的绝对路径缩写为 ~（保留原生分隔符，Windows 显示 ~\Documents\a.txt）；
 * 相对路径与 home 外的绝对路径（/tmp、/etc、D:\data）原样返回。
 */
export function displayPath(p: string): string {
    if (!p || !startsWithDir(p, HOME_DIR)) return p;
    return '~' + p.slice(HOME_DIR.length);
}
