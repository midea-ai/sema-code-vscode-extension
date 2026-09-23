/**
 * 超长粘贴转附件：阈值、预览生成、发给模型的 input 模板拼装与解析。
 * webview（输入框 / 气泡）与宿主（chatWebview / jb controller / semaSessionWrapper）共用，
 * 两端同一份规则保证格式一致。路径以 `@` 引用，由 core 现有的文件引用机制直接注入内容。
 */

export interface PasteAttachment {
    /** 转存文件绝对路径：<semaRoot>/attachments/<uuid>/pasted-text.txt */
    path: string;
    /** 首个非空行起的单行预览（≤80 字符） */
    preview: string;
}

/** 粘贴文本满足其一即转文件 */
const PASTE_MIN_CHARS = 3000;
const PASTE_MIN_LINES = 100;
const PREVIEW_LEN = 80;

export const PASTE_HEADER = '# Files pasted by the user:';
export const PASTE_REQUEST = '## My request:';

export function isLongPaste(text: string): boolean {
    return text.length >= PASTE_MIN_CHARS || text.split(/\r?\n/).length >= PASTE_MIN_LINES;
}

/** 预览：空白折叠为单个空格，`"` 换成 `'`（模板里用双引号包裹），截 80 字符后加 … */
export function makePastePreview(text: string): string {
    const one = text.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
    return one.length > PREVIEW_LEN ? one.slice(0, PREVIEW_LEN) + '…' : one;
}

/** 一行一段粘贴：`## "<预览>": @"<绝对路径>"`；路径一律加引号，用户目录含空格或标点（如 C:\Users\Zhou Jie）时 core 才不会截断引用 */
export function buildPasteInput(pastes: PasteAttachment[], text: string): string {
    const lines = [PASTE_HEADER, ''];
    for (const p of pastes) lines.push(`## "${p.preview}": @"${p.path}"`, '');
    lines.push(PASTE_REQUEST, text);
    return lines.join('\n');
}

/** 只认 attachments/<uuid>/pasted-text.txt 形状的路径（兼容 Windows 反斜杠），其余行忽略 */
const PASTE_LINE_RE = /^## "(.*)": @"([^"]+[\\/]attachments[\\/][^\\/"]+[\\/]pasted-text\.txt)"$/;

/** 从 input 解析粘贴列表：不是模板格式（无头行或无 `## My request:`）返回 undefined */
export function parsePasteInput(input: string | undefined | null): PasteAttachment[] | undefined {
    if (!input || !input.startsWith(PASTE_HEADER)) return undefined;
    const lines = input.split('\n');
    const end = lines.indexOf(PASTE_REQUEST);
    if (end < 0) return undefined;
    const out: PasteAttachment[] = [];
    for (const line of lines.slice(1, end)) {
        const m = line.match(PASTE_LINE_RE);
        if (m) out.push({ preview: m[1], path: m[2] });
    }
    return out.length ? out : undefined;
}
