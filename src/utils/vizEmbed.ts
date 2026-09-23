/**
 * 可视化产物内联嵌入的宿主侧准备：读取 attachments/<uuid>/<title>.html，给脚本补 webview nonce 并内联 viz-runtime，
 * 以 html 字符串回给 webview 走 iframe srcdoc（webview 里 iframe src 指向 asWebviewUri 不经 service worker，加载不出来）。
 * 原文件保持干净（用系统浏览器打开时不带宿主脚本）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { prepareVizHtml, isVizPath } from '../webview/common/viz';

/** 处理的体积上限（技能约定文件 < 1MB，留余量）；超过不嵌入 */
const VIZ_MAX_BYTES = 4 * 1024 * 1024;

let runtimeCache: { file: string; js: string } | null = null;

/** viz-runtime.js 源码只读一次（开发期改了产物需重载窗口） */
function loadVizRuntime(runtimeFile: string): string {
    if (runtimeCache?.file !== runtimeFile) runtimeCache = { file: runtimeFile, js: fs.readFileSync(runtimeFile, 'utf8') };
    return runtimeCache.js;
}

/** 返回可直接作 srcdoc 的 html；路径形状不对、文件不存在或过大返回 null */
export function buildVizEmbedHtml(htmlPath: string, runtimeFile: string, nonce: string): string | null {
    if (!isVizPath(htmlPath)) return null;
    const abs = path.resolve(htmlPath);
    if (!fs.existsSync(abs)) return null;
    const stat = fs.statSync(abs);
    if (stat.isDirectory() || stat.size > VIZ_MAX_BYTES) return null;
    return prepareVizHtml(fs.readFileSync(abs, 'utf8'), loadVizRuntime(runtimeFile), nonce);
}
