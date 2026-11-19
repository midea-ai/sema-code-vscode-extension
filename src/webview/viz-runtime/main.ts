/**
 * 可视化页内 runtime：宿主把它注入到 attachments/<uuid>/*.html 的临时副本 <head>，
 * 在聊天内联 iframe 里跑（不透明源沙箱，宿主拿不到页面 DOM）。两件事：
 *   1. 把文档高度与标题 postMessage 给宿主，宿主据此定 iframe 高度与标题；
 *   2. 收到宿主的截图请求时，用 html-to-image 把整页渲染成 png Blob 回传（「复制为图像」）；
 *   3. 明暗主题：按技能契约用 <html data-theme="dark"> 切暗色（缺省亮色）。脚本在 <head> 里先于正文执行，
 *      启动时读 url hash（JB file url 带 #theme=dark；VSCode srcdoc 由宿主直接把属性写进 html）避免首帧闪亮色，
 *      之后收到宿主 theme 消息实时改属性，页面脚本按契约监听该属性重建图表。
 * webpack 单独打成 IIFE（dist/webview/viz-runtime.js），不与主应用共享代码。不在 iframe 里时静默退出。
 */
import { toBlob } from 'html-to-image';
import { VIZ_MSG_TYPE, type VizMessage, type VizTheme } from '../common/viz';

if (window.parent !== window) {
    // 不透明源没有可比对的 origin，只能 '*'；消息不含敏感内容
    const post = (msg: VizMessage) => window.parent.postMessage(msg, '*');

    const setTheme = (theme: VizTheme) => {
        if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
    };
    if (/(^|[#&])theme=dark(&|$)/.test(location.hash.slice(1))) setTheme('dark');

    let last = -1;
    const report = () => {
        const body = document.body;
        if (!body) return;
        // html.scrollHeight 至少是 iframe 的视口高度；拿它回设 iframe 高度后，
        // 内容变短也无法缩回，旧视口会变成页面底部的大块空白。
        // body 的实际盒子高度随内容变化，不受 iframe 当前高度的下限影响。
        const marginBottom = parseFloat(getComputedStyle(body).marginBottom) || 0;
        const height = Math.max(1, Math.ceil(body.getBoundingClientRect().bottom + window.scrollY + marginBottom));
        if (height === last) return;
        last = height;
        post({ type: VIZ_MSG_TYPE, kind: 'size', height, title: document.title || '' });
    };

    const start = () => {
        report();
        new ResizeObserver(report).observe(document.documentElement);
        if (document.body) new ResizeObserver(report).observe(document.body);
        // 图表库异步初始化 / 字体加载后高度会变，兜底再报几次
        [100, 400, 1200].forEach(ms => setTimeout(report, ms));
        document.fonts?.ready.then(report).catch(() => undefined);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.addEventListener('load', report);

    // VS Code 的 srcdoc 沙箱是独立的不透明源，选区无法由外层页面直接读取。
    // 复制命令有时只落在 webview 外层；在子页收到按键或右键复制时主动上报选区。
    if (location.href === 'about:srcdoc') {
        const selectedText = () => window.getSelection()?.toString() || '';
        window.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'c') return;
            const text = selectedText();
            if (!text) return;
            e.preventDefault();
            post({ type: VIZ_MSG_TYPE, kind: 'copyText', text });
        }, true);
        document.addEventListener('copy', e => {
            const text = selectedText();
            if (!text) return;
            e.clipboardData?.setData('text/plain', text);
            e.preventDefault();
            post({ type: VIZ_MSG_TYPE, kind: 'copyText', text });
        }, true);
    }

    window.addEventListener('message', async (e: MessageEvent<VizMessage>) => {
        const m = e.data;
        if (!m || m.type !== VIZ_MSG_TYPE) return;
        if (m.kind === 'theme') { setTheme(m.theme); return; }
        if (m.kind !== 'snapshot' || 'blob' in m || 'error' in m) return;
        try {
            const blob = await toBlob(document.body, { pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff', cacheBust: false });
            if (!blob) throw new Error('empty');
            post({ type: VIZ_MSG_TYPE, kind: 'snapshot', id: m.id, blob });
        } catch (err) {
            post({ type: VIZ_MSG_TYPE, kind: 'snapshot', id: m.id, error: err instanceof Error ? err.message : String(err) });
        }
    });
}
