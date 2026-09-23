/**
 * 可视化产物识别：visualize 技能把 html 写到 <semaRoot>/attachments/<uuid>/<title>.html。
 * webview 据此把这类 html 在聊天里内联嵌入；宿主据此准备注入了 viz-runtime 的页面（VSCode 内联 html 字符串，JB 临时副本 file url）。
 * 只看路径形状（attachments/<uuid>/*.html，兼容 Windows 反斜杠），不依赖 semaRoot 具体位置。
 */
export const VIZ_PATH_RE = /[\\/]attachments[\\/][0-9a-f-]{36}[\\/][^\\/]+\.html?$/i;

export function isVizPath(p: string): boolean { return VIZ_PATH_RE.test(p); }

/** attachments/<uuid>/ 下的任何文件（粘贴转存、可视化产物）：宿主自己的落盘目录，不在「文件变更」面板里展示 */
export const ATTACHMENT_PATH_RE = /[\\/]attachments[\\/][0-9a-f-]{36}[\\/]/i;

export function isAttachmentPath(p: string): boolean { return ATTACHMENT_PATH_RE.test(p); }

/** iframe 内 runtime 与宿主的 postMessage 协议：统一 type 字段，kind 区分消息 */
export const VIZ_MSG_TYPE = 'sema-viz';

/** 产物主题：与技能契约一致，<html data-theme="dark"> 为暗色，缺省为亮色 */
export type VizTheme = 'light' | 'dark';

export type VizMessage =
    /** iframe → 宿主：文档高度与标题（加载后、尺寸变化时上报） */
    | { type: typeof VIZ_MSG_TYPE; kind: 'size'; height: number; title: string }
    /** 宿主 → iframe：请求整页截图 */
    | { type: typeof VIZ_MSG_TYPE; kind: 'snapshot'; id: number }
    /** iframe → 宿主：截图结果（png Blob；失败时 blob 为空并带 error） */
    | { type: typeof VIZ_MSG_TYPE; kind: 'snapshot'; id: number; blob?: Blob; error?: string }
    /** 宿主 → iframe：IDE 明暗切换，runtime 据此改 <html data-theme> */
    | { type: typeof VIZ_MSG_TYPE; kind: 'theme'; theme: VizTheme };

/** 加载前把初始主题写进 html 字符串（srcdoc 路径）：暗色给 <html> 加 data-theme，亮色是缺省不动 */
export function applyVizTheme(html: string, theme: VizTheme): string {
    if (theme !== 'dark') return html;
    return /<html\b/i.test(html) ? html.replace(/<html\b/i, '<html data-theme="dark"') : '<html data-theme="dark">' + html;
}

/** 加载前把初始主题写进 url（JB file url 路径）：runtime 启动时读 hash */
export function applyVizThemeToUrl(url: string, theme: VizTheme): string {
    return theme === 'dark' ? `${url}#theme=dark` : url;
}

/**
 * VSCode 宿主：把可视化 html 改造成能在 srcdoc iframe 里跑的形态。
 * srcdoc 继承 webview 的 CSP（script-src 'nonce-X'），所以给页面里每个 <script>（内联与 CDN 外链）补上同一个 nonce，
 * 并把 runtime 源码以内联 <script nonce> 注入 </head> 前（不透明源沙箱里 SW 不生效，外链 webview 资源加载不了，只能内联）。
 * 页面里已有 nonce 的标签不动；runtime 源码里的 </script 转义，避免提前闭合。
 */
export function prepareVizHtml(html: string, runtimeJs: string, nonce: string): string {
    const withNonce = html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
    const tag = `<script nonce="${nonce}">${runtimeJs.replace(/<\/script/gi, '<\\/script')}</script>`;
    return /<\/head>/i.test(withNonce) ? withNonce.replace(/<\/head>/i, `${tag}</head>`) : tag + withNonce;
}
