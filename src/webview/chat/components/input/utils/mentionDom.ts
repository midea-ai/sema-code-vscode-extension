import { InputMention } from '../../../types';
import { getLeadingCommand } from './commandUtils';
import { buildMentionChipHtml, refLabel } from '../../../utils/fileRefDisplay';
import { buildSkillLabelHtml, matchSkillPrefix, skillDisplayOf } from '../../../utils/skillDisplay';

export const MENTION_CLASS = 'file-mention';
export const COMMAND_CLASS = 'command-mention';
export const SKILL_CLASS = 'skill-mention';

/** 原子标签（mention 芯片 / 技能标签）：带 data-raw 的不可编辑元素，所有 walker 把它当叶子，逻辑长度 = raw 长度 */
export const isAtomicToken = (node: Node): node is HTMLElement =>
    node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.raw !== undefined;

/**
 * 开头技能标签：`/<映射技能名>` 显示为「图标 + 名字」，data-raw 存 `/<name>`（其后的空格仍是普通文本）
 */
export function createSkillSpan(name: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = SKILL_CLASS;
    span.contentEditable = 'false';
    span.draggable = false;
    span.dataset.skill = name;
    span.dataset.raw = '/' + name;
    span.title = '/' + name;
    const display = skillDisplayOf(name);
    span.innerHTML = display ? buildSkillLabelHtml(display) : '';
    return span;
}

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

/** mention 元素的逻辑长度（= `@path[:a-b]` 字面量长度），所有偏移计算都以此为准，不看可见文本 */
export const mentionRawLength = (el: HTMLElement): number => (el.dataset.raw || '').length;

/**
 * @文件 mention：原子标签（contentEditable=false），data-raw 存逻辑文本 `@path[:a-b]`，
 * 内部显示为「文件图标 + 文件名」芯片。光标只能落在标签前/后，Backspace/Delete 整块删除。
 * draggable=false：不可编辑节点在可编辑宿主里默认可拖，拖放会绕过文本模型直接改 DOM。
 */
export function createMentionSpan(m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = MENTION_CLASS;
    span.contentEditable = 'false';
    span.draggable = false;
    span.dataset.path = m.path;
    if (m.startLine !== undefined) {
        span.dataset.lineStart = String(m.startLine);
        span.dataset.lineEnd = String(m.endLine ?? m.startLine);
    }
    if (m.isDirectory) span.dataset.isDir = '1';
    span.dataset.raw = getMentionExpectedText(span);
    span.title = m.path;
    span.innerHTML = buildMentionChipHtml(m);
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
            const len = mentionRawLength(el);
            const ls = el.dataset.lineStart;
            const le = el.dataset.lineEnd;
            result.push({
                start: offset,
                length: len,
                path: el.dataset.path || '',
                isDirectory: el.dataset.isDir === '1' || undefined,
                startLine: ls ? Number(ls) : undefined,
                endLine: le ? Number(le) : undefined
            });
            offset += len;
        } else if (isAtomicToken(node)) {
            // 其它原子标签（技能标签）：只计长度，不进 mentions
            offset += mentionRawLength(node);
        } else {
            node.childNodes.forEach(walk);
        }
    };
    root.childNodes.forEach(walk);
    return result;
}

/** 技能标签是否完好：不可编辑、data-raw 与技能名一致、名字未被改动 */
function isSkillIntact(span: HTMLElement): boolean {
    if (span.contentEditable !== 'false') return false;
    const name = span.dataset.skill || '';
    const display = skillDisplayOf(name);
    if (!display || span.dataset.raw !== '/' + name) return false;
    return span.querySelector('.skill-label-name')?.textContent === display.name;
}

/** mention 标签是否完好：不可编辑、逻辑文本与 data 一致、芯片名字未被改动 */
function isMentionIntact(span: HTMLElement): boolean {
    if (span.contentEditable !== 'false') return false;
    if (!span.dataset.raw || span.dataset.raw !== getMentionExpectedText(span)) return false;
    const name = span.querySelector('.file-ref-name');
    if (!name) return false;
    const ls = span.dataset.lineStart;
    const le = span.dataset.lineEnd;
    const expected = refLabel(span.dataset.path || '', span.dataset.isDir === '1', ls ? Number(ls) : undefined, le ? Number(le) : undefined);
    return name.textContent === expected;
}

// 扫描所有 mention span：结构被破坏时还原为逻辑文本（高亮失效）；
// 全选删除后 Chromium 偶尔会留下空 <span class="file-mention"></span> 外壳，空壳直接 remove
export function scanAndUnwrapStaleMentions(root: HTMLElement): boolean {
    const spans = Array.from(root.querySelectorAll<HTMLElement>('span.' + MENTION_CLASS));
    let mutated = false;
    for (const span of spans) {
        if (isMentionIntact(span)) continue;
        if (span.dataset.raw) {
            span.replaceWith(document.createTextNode(span.dataset.raw));
        } else {
            span.remove();
        }
        mutated = true;
    }
    // 技能标签：结构被破坏时还原为 `/<name>` 逻辑文本；空壳 remove
    for (const span of Array.from(root.querySelectorAll<HTMLElement>('span.' + SKILL_CLASS))) {
        if (isSkillIntact(span)) continue;
        if (span.dataset.raw) span.replaceWith(document.createTextNode(span.dataset.raw)); else span.remove();
        mutated = true;
    }
    // 快捷指令高亮：被编辑破坏（文本与原命令不一致）即解包
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
    // 开头若是有显示映射的技能且其后已有空格：渲染成「图标 + 名字」原子标签（raw = `/<name>`，空格留作普通文本）；
    // 否则命中已知快捷指令时渲染成文本高亮块
    const sk = matchSkillPrefix(text, true);
    if (sk && (sorted.length === 0 || sorted[0].start >= sk.name.length + 1)) {
        root.appendChild(createSkillSpan(sk.name));
        pos = sk.name.length + 1;
    } else {
        const cmd = getLeadingCommand(text);
        if (cmd && (sorted.length === 0 || sorted[0].start >= cmd.length)) {
            root.appendChild(createCommandSpan(cmd.text));
            pos = cmd.length;
        }
    }
    for (const m of sorted) {
        if (m.start > pos) appendText(text.substring(pos, m.start));
        const span = createMentionSpan(m);
        root.appendChild(span);
        pos = m.start + m.length;
    }
    if (pos < text.length) appendText(text.substring(pos));
}
