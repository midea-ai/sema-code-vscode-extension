import { useRef } from 'react';
import { InputMention } from '../../../types';

// 编辑器的一帧完整有效状态：renderEditorContent 可从它无损重建 DOM
export interface EditorSnapshot {
    text: string;
    mentions: InputMention[];
    caret: number;
}

// 连续打字合并进同一帧的时间窗；超过则视为新的一段，落独立帧
const COALESCE_MS = 500;
// 撤销栈上限，超出丢最旧，避免长会话内存无界
const MAX_STACK = 200;

/**
 * 自建撤销/重做栈（指针式单栈）。
 *
 * 为什么不用浏览器原生 contentEditable undo：编辑器大量走 renderEditorContent
 * （textContent='' + 重建子树）改 DOM，会破坏 Chromium 原生撤销栈，且与并行的
 * React 状态(inputValue/mentions)无法保持一致。这里把全部有效状态收敛成 EditorSnapshot，
 * 撤销时整帧重建，DOM 与状态天然同步，跨平台行为一致。
 */
export function useEditorHistory() {
    const stackRef = useRef<EditorSnapshot[]>([]);
    // 当前所见帧在 stack 中的下标
    const indexRef = useRef<number>(-1);
    const lastKindRef = useRef<'type' | 'op' | null>(null);
    const lastTimeRef = useRef<number>(0);

    // mentions 全程按不可变方式使用，但仍浅拷贝数组兜底，防止外部后续 push 污染历史帧
    const clone = (snap: EditorSnapshot): EditorSnapshot => ({
        text: snap.text,
        mentions: snap.mentions.slice(),
        caret: snap.caret
    });

    // 设基线：挂载 / 发送清空 / setText 回填时调用，清空整段历史
    const reset = (snap: EditorSnapshot) => {
        stackRef.current = [clone(snap)];
        indexRef.current = 0;
        lastKindRef.current = null;
        lastTimeRef.current = 0;
    };

    const commit = (snap: EditorSnapshot, kind: 'type' | 'op') => {
        const now = Date.now();
        const idx = indexRef.current;
        // 与栈顶内容一致则跳过，避免无变化的重复落帧（如撤销后 syncFromDom 回灌）
        const top = idx >= 0 ? stackRef.current[idx] : null;
        if (top && top.text === snap.text && top.caret === snap.caret &&
            top.mentions.length === snap.mentions.length) {
            // 文本与光标都没变，基本可判定同一状态；仍更新时间戳维持合并窗口
            lastTimeRef.current = now;
            return;
        }

        const canMerge =
            kind === 'type' &&
            lastKindRef.current === 'type' &&
            now - lastTimeRef.current < COALESCE_MS &&
            idx === stackRef.current.length - 1; // 不在 redo 分支中间

        if (canMerge) {
            stackRef.current[idx] = clone(snap); // 替换栈顶，合并连续打字
        } else {
            // 截断 redo 分支后 push 新帧
            const kept = stackRef.current.slice(0, idx + 1);
            kept.push(clone(snap));
            // 超上限丢最旧
            const overflow = kept.length - MAX_STACK;
            stackRef.current = overflow > 0 ? kept.slice(overflow) : kept;
            indexRef.current = stackRef.current.length - 1;
        }
        lastKindRef.current = kind;
        lastTimeRef.current = now;
    };

    const undo = (): EditorSnapshot | null => {
        if (indexRef.current <= 0) return null;
        indexRef.current -= 1;
        // 撤销/重做后打断合并，下一次打字另起一帧
        lastKindRef.current = null;
        return clone(stackRef.current[indexRef.current]);
    };

    const redo = (): EditorSnapshot | null => {
        if (indexRef.current >= stackRef.current.length - 1) return null;
        indexRef.current += 1;
        lastKindRef.current = null;
        return clone(stackRef.current[indexRef.current]);
    };

    return { reset, commit, undo, redo };
}
