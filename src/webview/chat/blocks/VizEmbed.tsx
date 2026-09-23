/**
 * 可视化内联嵌入：visualize 技能产出的 html（attachments/<uuid>/*.html，见 common/viz.ts）在本轮消息末尾直接以 iframe 展示。
 * 宿主注入 viz-runtime 后回给 webview（prepareVizEmbed → vizEmbedReady），两种形态：
 *   - VSCode 回 html 字符串走 srcdoc：webview 里 iframe src 指向 asWebviewUri 不经 service worker，加载不出来；
 *     srcdoc 继承 webview 的 nonce CSP，宿主已给页面脚本补上同一 nonce、runtime 内联；
 *   - JB 回临时副本的 file url 走 src。
 * runtime 通过 postMessage 上报高度与标题、响应截图请求。视口外不建 iframe（懒加载）。
 * iframe 始终按真实文档高度铺开、不内部滚动；超过 MAX_HEIGHT 时折叠：只露顶部、底部渐隐，右下角「展开」后整体铺开用页面滚动看完。
 * 明暗跟随 IDE：从 body 的 vscode-light/dark 类取值，初始值烘进 srcdoc（<html data-theme>）或 url hash，换肤后 postMessage 给 runtime。
 * 悬浮时右上角出现「⋯」，点开菜单：复制为图像（剪贴板写 png）、在浏览器打开。
 */
import React, { useEffect, useRef, useState } from 'react';
import { VIZ_MSG_TYPE, type VizMessage, type VizTheme, applyVizTheme, applyVizThemeToUrl } from '../../common/viz';
import { useT } from '../../common/i18n/react';

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;
const FALLBACK_HEIGHT = 480;
const SNAPSHOT_TIMEOUT = 15000;
const PREPARE_TIMEOUT = 5000;

let snapshotSeq = 0;
let prepareSeq = 0;

/** 从 body 类推断 IDE 明暗（VSCode 与 JB 宿主都挂 vscode-light / vscode-dark，高对比暗色是 vscode-high-contrast） */
function ideVizTheme(): VizTheme {
    const cls = document.body?.classList;
    return cls && (cls.contains('vscode-dark') || (cls.contains('vscode-high-contrast') && !cls.contains('vscode-high-contrast-light'))) ? 'dark' : 'light';
}

interface VizEmbedProps {
    path: string;
    vscode: any;
}

const VizEmbed: React.FC<VizEmbedProps> = ({ path, vscode }) => {
    const t = useT();
    const fileName = path.split(/[\\/]/).pop() || path;

    const rootRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [visible, setVisible] = useState(false);
    const [source, setSource] = useState<{ url?: string; html?: string } | null>(null);
    /** IDE 明暗：初始值烘进 srcdoc/url 避免首帧闪亮色，之后变化走 postMessage；ref 供异步回调取最新值 */
    const [theme, setTheme] = useState<VizTheme>(ideVizTheme);
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const [failed, setFailed] = useState(false);
    /** 真实文档高度（runtime 上报），iframe 始终按它铺开，不在 iframe 内部滚动 */
    const [height, setHeight] = useState(MIN_HEIGHT);
    const [expanded, setExpanded] = useState(false);
    const [title, setTitle] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

    // 懒加载：进入视口前后 400px 才向宿主要副本、建 iframe（长会话里可能有很多个）
    useEffect(() => {
        const el = rootRef.current;
        if (!el || visible) return;
        const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setVisible(true); }, { rootMargin: '400px 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);

    // 向宿主要注入了 runtime 的页面：html 字符串（srcdoc）或临时副本 url（src）
    useEffect(() => {
        if (!visible || source || !vscode) return;
        const reqId = `viz-${Date.now()}-${prepareSeq++}`;
        let alive = true;
        const timer = window.setTimeout(() => { if (alive) { cleanup(); setFailed(true); } }, PREPARE_TIMEOUT);
        const onMsg = (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.type !== 'vizEmbedReady' || msg.reqId !== reqId) return;
            cleanup();
            if (typeof msg.html === 'string' && msg.html) setSource({ html: applyVizTheme(msg.html, themeRef.current) });
            else if (typeof msg.url === 'string' && msg.url) setSource({ url: applyVizThemeToUrl(msg.url, themeRef.current) });
            else setFailed(true);
        };
        const cleanup = () => { alive = false; window.clearTimeout(timer); window.removeEventListener('message', onMsg); };
        window.addEventListener('message', onMsg);
        vscode.postMessage({ type: 'prepareVizEmbed', path, reqId });
        return cleanup;
    }, [visible, source, path, vscode]);

    // runtime 上报：只认来自本 iframe 的消息
    useEffect(() => {
        const onMsg = (e: MessageEvent<VizMessage>) => {
            const m = e.data;
            if (!m || m.type !== VIZ_MSG_TYPE || m.kind !== 'size' || e.source !== iframeRef.current?.contentWindow) return;
            // 记真实文档高度，不加余量：iframe 按此高度铺开后 scrollHeight 恰等于视口，多加会被回报成新高度而逐次增长
            setHeight(Math.max(MIN_HEIGHT, m.height));
            if (m.title) setTitle(m.title);
            setLoaded(true);
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, []);

    // IDE 换肤：宿主改 body 类（VSCode 与 JB 都是），观察到变化后同步给 iframe
    useEffect(() => {
        const mo = new MutationObserver(() => setTheme(ideVizTheme()));
        mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => mo.disconnect();
    }, []);

    // 加载完成后也补发一次：请求副本到 iframe 就绪之间主题可能已变，烘进去的初始值会过期
    useEffect(() => {
        if (!loaded) return;
        const msg: VizMessage = { type: VIZ_MSG_TYPE, kind: 'theme', theme };
        iframeRef.current?.contentWindow?.postMessage(msg, '*');
    }, [theme, loaded]);

    // 点击菜单外关闭
    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [menuOpen]);

    // runtime 没起来（页面自己出错）时也要能看到内容：iframe load 后 1.5s 仍无上报就按默认高度显示
    const onIframeLoad = () => {
        window.setTimeout(() => setLoaded(prev => { if (!prev) setHeight(FALLBACK_HEIGHT); return true; }), 1500);
    };

    const copyImage = async () => {
        const win = iframeRef.current?.contentWindow;
        setMenuOpen(false);
        if (!win || copyState === 'copying') return;
        setCopyState('copying');
        const id = ++snapshotSeq;
        try {
            const blob = await new Promise<Blob>((resolve, reject) => {
                const timer = window.setTimeout(() => { cleanup(); reject(new Error('timeout')); }, SNAPSHOT_TIMEOUT);
                const onMsg = (e: MessageEvent<VizMessage>) => {
                    const m = e.data;
                    if (!m || m.type !== VIZ_MSG_TYPE || m.kind !== 'snapshot' || m.id !== id || e.source !== win) return;
                    cleanup();
                    if ('blob' in m && m.blob) resolve(m.blob); else reject(new Error(('error' in m && m.error) || 'snapshot failed'));
                };
                const cleanup = () => { window.clearTimeout(timer); window.removeEventListener('message', onMsg); };
                window.addEventListener('message', onMsg);
                const req: VizMessage = { type: VIZ_MSG_TYPE, kind: 'snapshot', id };
                win.postMessage(req, '*');
            });
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setCopyState('copied');
        } catch (e) {
            console.warn('[viz] copy image failed:', e);
            setCopyState('failed');
        } finally {
            window.setTimeout(() => setCopyState('idle'), 1500);
        }
    };

    const openExternal = () => {
        setMenuOpen(false);
        // 打开原始文件（不是注入了 runtime 的副本）：宿主按 file URL 交给系统默认程序（浏览器）
        const url = /^[a-zA-Z]:[\\/]/.test(path) ? 'file:///' + path.replace(/\\/g, '/') : 'file://' + path;
        vscode?.postMessage({ type: 'openExternal', url });
    };

    // 超高：折叠态只露 MAX_HEIGHT、底部渐隐，右下「展开」；展开后按真实高度铺开，用页面滚动看完
    const overflow = loaded && height > MAX_HEIGHT;
    const collapsed = overflow && !expanded;

    const menuLabel = copyState === 'copying' ? '…' : copyState === 'copied' ? '✓' : copyState === 'failed' ? '✕' : '⋯';
    const menuTitle = copyState === 'copied' ? t('viz.copied') : copyState === 'failed' ? t('viz.copyFailed') : '';

    return (
        <div ref={rootRef} className={`viz-embed${menuOpen || copyState !== 'idle' ? ' viz-embed--active' : ''}`}>
            <button
                type="button"
                className="viz-embed-menu-btn"
                title={menuTitle}
                disabled={!loaded}
                onClick={() => setMenuOpen(v => !v)}
            >
                {menuLabel}
            </button>
            {menuOpen && (
                <div className="viz-embed-menu">
                    <div className="viz-embed-menu-item" onClick={copyImage}>{t('viz.copyImage')}</div>
                    <div className="viz-embed-menu-item" onClick={openExternal}>{t('viz.openExternal')}</div>
                </div>
            )}
            <div className={`viz-embed-body${collapsed ? ' viz-embed-body--collapsed' : ''}`} style={{ height: collapsed ? MAX_HEIGHT : height }}>
                {source && (
                    // 不给 allow-same-origin（不透明源），防内嵌页脚本借同源访问 webview
                    <iframe
                        ref={iframeRef}
                        title={title || fileName}
                        src={source.url}
                        srcDoc={source.html}
                        onLoad={onIframeLoad}
                        sandbox="allow-scripts allow-popups allow-modals allow-downloads"
                        className={`viz-embed-frame${loaded ? '' : ' viz-embed-frame--pending'}`}
                        style={{ height }}
                    />
                )}
                {!loaded && (
                    <div className="viz-embed-loading">{failed ? fileName : '…'}</div>
                )}
            </div>
            {overflow && (
                <div className="viz-embed-toggle-row">
                    <button type="button" className="viz-embed-toggle" onClick={() => setExpanded(v => !v)}>
                        {expanded ? t('common.collapse') : t('common.expand')}
                    </button>
                </div>
            )}
        </div>
    );
};

export default React.memo(VizEmbed);
