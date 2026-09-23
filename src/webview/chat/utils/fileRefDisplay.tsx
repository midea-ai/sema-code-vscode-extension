/**
 * @ 文件引用的显示：把 `@path` / `@"path with space"` / `@path:13-17` 渲染成「文件图标 + 文件名」芯片，
 * 输入框（mention span）与用户气泡共用。只影响显示，发给 core 的文本仍是原始 `@...` 字面量。
 */
import React from 'react';
import { getFileIconHtml } from '../components/ui/FileIcon';

/** 与 core util/fileReference 的解析正则一致：@ 前须为行首或边界字符，引用体为双引号串或连续非边界字符 */
const BOUNDARY = '\\s。，、；：！？“”‘’「」『』（）《》〈〉【】,;!?';
export const FILE_REF_RE = new RegExp(`(?:^|(?<=[${BOUNDARY}]))@(?:"([^"]+)"|([^${BOUNDARY}]+))`, 'g');

export interface RefSegment {
    type: 'ref';
    /** 原始字面量（含 @ 与引号） */
    raw: string;
    /** 去掉行号后缀的路径 */
    path: string;
    line?: number;
    endLine?: number;
    isDirectory: boolean;
}
export type TextSegment = { type: 'text'; text: string };
export type Segment = TextSegment | RefSegment;

/** 解析引用体的行号后缀：`a.ts:13` / `a.ts:13-17`；解析不出行号时整个当作路径（与 core 一致） */
function parseRef(body: string): Pick<RefSegment, 'path' | 'line' | 'endLine'> {
    const m = body.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (!m) return { path: body };
    const line = Math.max(1, parseInt(m[2], 10));
    return { path: m[1], line, endLine: m[3] ? Math.max(line, parseInt(m[3], 10)) : undefined };
}

/** 把文本切成普通段与引用段（无引用时返回单个普通段；空文本返回空数组） */
export function splitFileRefs(text: string): Segment[] {
    const out: Segment[] = [];
    let last = 0;
    for (const m of text.matchAll(FILE_REF_RE)) {
        const idx = m.index!;
        if (idx > last) out.push({ type: 'text', text: text.slice(last, idx) });
        const body = m[1] ?? m[2]!;
        out.push({ type: 'ref', raw: m[0], ...parseRef(body), isDirectory: /[\\/]$/.test(body) });
        last = idx + m[0].length;
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
    return out;
}

/** 存在性确认用的路径键：去掉尾部分隔符 */
export const refStatPath = (path: string) => path.replace(/[\\/]+$/, '') || path;

/** 文本里所有引用的路径键（去重） */
export function refPaths(text: string): string[] {
    const out = new Set<string>();
    for (const s of splitFileRefs(text)) if (s.type === 'ref') out.add(refStatPath(s.path));
    return [...out];
}

/** 芯片上显示的名字：basename（目录保留尾部 /），带行号时追加 `:13-17` */
export function refLabel(path: string, isDirectory: boolean, line?: number, endLine?: number): string {
    const trimmed = path.replace(/[\\/]+$/, '');
    const base = trimmed.split(/[\\/]/).pop() || path;
    const name = isDirectory ? `${base}/` : base;
    return line ? `${name}:${line}${endLine ? `-${endLine}` : ''}` : name;
}

/** 芯片图标的 svg 与类名（尺寸 / 放大规则由 .file-ref-icon-file / -folder 给出，同 webui FileIcon：文件放大 1.35，目录不放大） */
function refIcon(path: string, isDirectory: boolean) {
    const { svg, color } = getFileIconHtml(path.split(/[\\/]/).pop() || path, isDirectory);
    return { svg, color, className: `file-icon file-ref-icon ${isDirectory ? 'file-ref-icon-folder' : 'file-ref-icon-file'}` };
}

/**
 * 图标 + 文件名，内联在文字中（无底色）；有 onOpen 时可点击。
 * 用户气泡里用：文件名走链接高亮色，图标保持文件类型色（与 chat 正文文件链接一致）；
 * 只有输入框芯片（buildMentionChipHtml）把图标与文字统一成链接高亮色。
 * 不用 FileIcon 组件是为了避开其内联的 scale(1.1)+contrast 滤镜，与输入框 HTML 路径结构完全一致。
 */
export function FileRefChip({ seg, onOpen }: { seg: RefSegment; onOpen?: (seg: RefSegment) => void }) {
    const icon = refIcon(seg.path, seg.isDirectory);
    return (
        <span
            className={`file-ref-chip${onOpen ? ' clickable' : ''}`}
            title={seg.path}
            onMouseDown={onOpen ? e => { e.preventDefault(); e.stopPropagation(); } : undefined}
            onClick={onOpen ? e => { e.stopPropagation(); onOpen(seg); } : undefined}
        >
            <span className={icon.className} style={{ color: icon.color }} dangerouslySetInnerHTML={{ __html: icon.svg }} />
            <span className="file-ref-name">{refLabel(seg.path, seg.isDirectory, seg.line, seg.endLine)}</span>
        </span>
    );
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 输入框 mention span 的内部 HTML（非 React DOM）：与 FileRefChip 同一套结构与类名，图标不设类型色、随文字用链接色 */
export function buildMentionChipHtml(m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }): string {
    const icon = refIcon(m.path, !!m.isDirectory);
    const label = refLabel(m.path, !!m.isDirectory, m.startLine, m.endLine);
    return `<span class="file-ref-chip"><span class="${icon.className}">${icon.svg}</span><span class="file-ref-name">${escapeHtml(label)}</span></span>`;
}
