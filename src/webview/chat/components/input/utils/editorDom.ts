import { isAtomicToken, mentionRawLength } from './mentionDom';

// mention 芯片 / 技能标签都是原子节点（带 data-raw）：所有 walker 把它当叶子，逻辑长度 = data-raw 长度，绝不下钻到内部
const isMention = isAtomicToken;

export function getNodeTextLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').length;
    if (node.nodeName === 'BR') return 1;
    if (isMention(node)) return mentionRawLength(node);
    let len = 0;
    node.childNodes.forEach(c => { len += getNodeTextLength(c); });
    return len;
}

export function getEditorText(root: HTMLElement): string {
    let text = '';
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue || '';
        else if (node.nodeName === 'BR') text += '\n';
        else if (isMention(node)) text += node.dataset.raw || '';
        else node.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    return text;
}

/**
 * 把 (container, offset) 这个 DOM 点换算成逻辑字符偏移。
 * 点落在 mention 内部（鼠标拖选 / 双击芯片文字会出现）时按 bias 吸附：start → 标签前，end → 标签后，
 * 让"部分覆盖"等价于整块选中；折叠光标用 start 吸附到标签前。
 */
function pointToOffset(root: HTMLElement, container: Node, containerOffset: number, bias: 'start' | 'end'): number | null {
    let offset = 0;
    let found = false;
    const walk = (node: Node): void => {
        if (found) return;
        if (isMention(node)) {
            const len = mentionRawLength(node);
            if (node === container) {
                // 选区锚在标签元素本身：offset 0 视为标签前，否则标签后
                if (containerOffset > 0) offset += len;
            } else if (node.contains(container)) {
                if (bias === 'end') offset += len;
            } else {
                offset += len;
                return;
            }
            found = true;
            return;
        }
        if (node === container) {
            if (container.nodeType === Node.TEXT_NODE) {
                offset += containerOffset;
            } else {
                for (let i = 0; i < containerOffset; i++) {
                    offset += getNodeTextLength(node.childNodes[i]);
                }
            }
            found = true;
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            offset += (node.nodeValue || '').length;
        } else if (node.nodeName === 'BR') {
            offset += 1;
        } else {
            for (const c of Array.from(node.childNodes)) {
                if (found) break;
                walk(c);
            }
        }
    };
    walk(root);
    return found ? offset : null;
}

export function getCaretOffset(root: HTMLElement): number | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    return pointToOffset(root, range.startContainer, range.startOffset, 'start');
}

// 读取当前选区的绝对字符区间 [start, end)。与 getCaretOffset 同一套偏移口径，
// 但同时解析选区终点——粘贴/插入时用来「先删选区再插入」，避免选中内容没被替换。
export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const start = pointToOffset(root, range.startContainer, range.startOffset, 'start');
    const end = pointToOffset(root, range.endContainer, range.endOffset, 'end');
    if (start === null || end === null) return null;
    // Range 的 start/end 已按文档序规范化；仍兜底一次
    return start <= end ? { start, end } : { start: end, end: start };
}

export function setCaretOffset(root: HTMLElement, offset: number): void {
    const range = document.createRange();
    let remaining = Math.max(0, offset);
    let placed = false;
    const walk = (node: Node): boolean => {
        if (node.nodeType === Node.TEXT_NODE) {
            const len = (node.nodeValue || '').length;
            if (remaining <= len) {
                range.setStart(node, remaining);
                placed = true;
                return true;
            }
            remaining -= len;
            return false;
        }
        if (node.nodeName === 'BR') {
            if (remaining === 0) {
                range.setStartBefore(node);
                placed = true;
                return true;
            }
            remaining -= 1;
            return false;
        }
        if (isMention(node)) {
            const len = mentionRawLength(node);
            // 光标只落在标签前/后，绝不进入内部；正好等于 len 时继续走到后续节点（优先落到下一文本节点 offset 0）
            if (remaining === 0) {
                range.setStartBefore(node);
                placed = true;
                return true;
            }
            if (remaining < len) {
                if (remaining * 2 < len) range.setStartBefore(node);
                else range.setStartAfter(node);
                placed = true;
                return true;
            }
            remaining -= len;
            return false;
        }
        for (const c of Array.from(node.childNodes)) {
            if (walk(c)) return true;
        }
        return false;
    };
    walk(root);
    if (!placed) {
        range.selectNodeContents(root);
        range.collapse(false);
    } else {
        range.collapse(true);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

// 在指定字符偏移处插入一个 DOM 节点（不会插入到 mention span 内部，而是切到其前/后）
export function insertNodeAtOffset(root: HTMLElement, offset: number, node: Node): void {
    let remaining = Math.max(0, offset);
    const walk = (parent: Node): boolean => {
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                const len = (child.nodeValue || '').length;
                if (remaining <= len) {
                    if (remaining === 0) parent.insertBefore(node, child);
                    else if (remaining === len) parent.insertBefore(node, child.nextSibling);
                    else {
                        const after = (child as Text).splitText(remaining);
                        parent.insertBefore(node, after);
                    }
                    return true;
                }
                remaining -= len;
            } else if (child.nodeName === 'BR') {
                if (remaining === 0) { parent.insertBefore(node, child); return true; }
                remaining -= 1;
            } else if (isMention(child)) {
                const len = mentionRawLength(child);
                if (remaining <= 0) { parent.insertBefore(node, child); return true; }
                if (remaining < len) {
                    if (remaining * 2 < len) parent.insertBefore(node, child);
                    else parent.insertBefore(node, child.nextSibling);
                    return true;
                }
                if (remaining === len) { parent.insertBefore(node, child.nextSibling); return true; }
                remaining -= len;
            } else {
                if (walk(child)) return true;
            }
        }
        return false;
    };
    if (!walk(root)) root.appendChild(node);
}
