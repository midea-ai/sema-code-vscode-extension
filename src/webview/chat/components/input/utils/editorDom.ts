import { MENTION_CLASS } from './mentionDom';

export function getNodeTextLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').length;
    if (node.nodeName === 'BR') return 1;
    let len = 0;
    node.childNodes.forEach(c => { len += getNodeTextLength(c); });
    return len;
}

export function getEditorText(root: HTMLElement): string {
    let text = '';
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue || '';
        else if (node.nodeName === 'BR') text += '\n';
        else node.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    return text;
}

export function getCaretOffset(root: HTMLElement): number | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const target = range.startContainer;
    const targetOffset = range.startOffset;
    let offset = 0;
    let found = false;
    const walk = (node: Node): void => {
        if (found) return;
        if (node === target) {
            if (target.nodeType === Node.TEXT_NODE) {
                offset += targetOffset;
            } else {
                for (let i = 0; i < targetOffset; i++) {
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

// 读取当前选区的绝对字符区间 [start, end)。与 getCaretOffset 同一套偏移口径，
// 但同时解析选区终点——粘贴/插入时用来「先删选区再插入」，避免选中内容没被替换。
export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const toOffset = (target: Node, targetOffset: number): number | null => {
        let offset = 0;
        let found = false;
        const walk = (node: Node): void => {
            if (found) return;
            if (node === target) {
                if (target.nodeType === Node.TEXT_NODE) {
                    offset += targetOffset;
                } else {
                    for (let i = 0; i < targetOffset; i++) {
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
    };
    const start = toOffset(range.startContainer, range.startOffset);
    const end = toOffset(range.endContainer, range.endOffset);
    if (start === null || end === null) return null;
    // 选区方向可能是「从后往前」拖出来的，规范化为 start ≤ end
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
            } else if (
                child.nodeType === Node.ELEMENT_NODE &&
                (child as HTMLElement).classList.contains(MENTION_CLASS)
            ) {
                const len = (child.textContent || '').length;
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
