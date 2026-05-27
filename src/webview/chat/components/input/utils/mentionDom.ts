import { InputMention } from '../../../types';
import { getLeadingCommand } from './commandUtils';

export const MENTION_CLASS = 'file-mention';
export const COMMAND_CLASS = 'command-mention';

// 开头快捷指令高亮块（如 "/review-pr"）。仅作视觉装饰，不参与 mentions 状态；
// data-cmd 存原始命令文本，供 scanAndUnwrapStaleMentions 在被编辑破坏后解包。
export function createCommandSpan(cmdText: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = COMMAND_CLASS;
    span.dataset.cmd = cmdText;
    span.textContent = cmdText;
    return span;
}

export function getMentionExpectedText(span: HTMLElement): string {
    const path = span.dataset.path || '';
    const ls = span.dataset.lineStart;
    const le = span.dataset.lineEnd;
    return '@' + path + (ls ? `:${ls}-${le ?? ls}` : '');
}

export function createMentionSpan(m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = MENTION_CLASS;
    // 不显式设 contentEditable=true：父 div 已是 contenteditable=true，子 span 继承即可。
    // 显式声明会让 Chromium 把它当独立可编辑子区域，Cmd+A+Backspace 后保留空 <span> 外壳、
    // 光标留在里面，继续输入会被吸进 span → 新打的字全部带高亮。
    span.dataset.path = m.path;
    if (m.startLine !== undefined) {
        span.dataset.lineStart = String(m.startLine);
        span.dataset.lineEnd = String(m.endLine ?? m.startLine);
    }
    if (m.isDirectory) span.dataset.isDir = '1';
    span.textContent = '@' + m.path + (m.startLine !== undefined ? `:${m.startLine}-${m.endLine ?? m.startLine}` : '');
    return span;
}

// 收集 DOM 中所有 mention 的位置 / 元数据
export function getMentionsFromDom(root: HTMLElement): InputMention[] {
    const result: InputMention[] = [];
    let offset = 0;
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            offset += (node.nodeValue || '').length;
        } else if (node.nodeName === 'BR') {
            offset += 1;
        } else if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).classList.contains(MENTION_CLASS)
        ) {
            const el = node as HTMLElement;
            const text = el.textContent || '';
            const ls = el.dataset.lineStart;
            const le = el.dataset.lineEnd;
            result.push({
                start: offset,
                length: text.length,
                path: el.dataset.path || '',
                isDirectory: el.dataset.isDir === '1' || undefined,
                startLine: ls ? Number(ls) : undefined,
                endLine: le ? Number(le) : undefined
            });
            offset += text.length;
        } else {
            node.childNodes.forEach(walk);
        }
    };
    root.childNodes.forEach(walk);
    return result;
}

// 扫描所有 mention span：textContent 与 data 不一致时解包为纯文本（高亮失效）
// 全选删除后 Chromium 偶尔会留下空 <span class="file-mention"></span> 外壳；
// 替换成空 textNode 仍可能让 caret 视觉上"贴回" span 末尾，所以空壳直接 remove
export function scanAndUnwrapStaleMentions(root: HTMLElement): boolean {
    const spans = Array.from(root.querySelectorAll<HTMLElement>('span.' + MENTION_CLASS));
    let mutated = false;
    for (const span of spans) {
        if (span.textContent !== getMentionExpectedText(span)) {
            if (span.textContent) {
                span.replaceWith(document.createTextNode(span.textContent));
            } else {
                span.remove();
            }
            mutated = true;
        }
    }
    // 快捷指令高亮：被编辑破坏（文本与原命令不一致）即解包，行为同 mention
    const cmdSpans = Array.from(root.querySelectorAll<HTMLElement>('span.' + COMMAND_CLASS));
    for (const span of cmdSpans) {
        if (span.textContent !== (span.dataset.cmd || '')) {
            if (span.textContent) {
                span.replaceWith(document.createTextNode(span.textContent));
            } else {
                span.remove();
            }
            mutated = true;
        }
    }
    return mutated;
}

// 将编辑器内容渲染为「text + mentions」的 DOM 表达
export function renderEditorContent(root: HTMLElement, text: string, mentions: InputMention[]): void {
    root.textContent = '';
    const sorted = [...mentions].sort((a, b) => a.start - b.start);
    let pos = 0;
    const appendText = (s: string) => {
        if (!s) return;
        // 把 \n 转成 <br>，让换行显示
        const parts = s.split('\n');
        for (let i = 0; i < parts.length; i++) {
            if (parts[i]) root.appendChild(document.createTextNode(parts[i]));
            if (i < parts.length - 1) root.appendChild(document.createElement('br'));
        }
    };
    // 开头若命中快捷指令，先渲染成高亮块（与 @文件 同款视觉）
    const cmd = getLeadingCommand(text);
    if (cmd && (sorted.length === 0 || sorted[0].start >= cmd.length)) {
        root.appendChild(createCommandSpan(cmd.text));
        pos = cmd.length;
    }
    for (const m of sorted) {
        if (m.start > pos) appendText(text.substring(pos, m.start));
        const span = createMentionSpan(m);
        root.appendChild(span);
        pos = m.start + m.length;
    }
    if (pos < text.length) appendText(text.substring(pos));
}
