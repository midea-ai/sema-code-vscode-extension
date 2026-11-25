import React, { useRef, useState } from 'react';

/** 按住不动多久进入拖拽（ms）：够长以区分「按下就拖选文字」，够短以免拖拽手感发钝 */
const DRAG_HOLD_MS = 180;

type DropPosition = 'before' | 'after';
/** 落点：某行的上/下半区，或整个可拖区域的头部 / 尾部 */
type DropTarget = { name: string; position: DropPosition } | 'start' | 'end' | null;

/**
 * 表格行拖拽排序（对话模型 / 图像模型列表共用）。
 * 用 mousedown + window 上的 mousemove / mouseup 实现，不用原生 HTML5 拖拽：
 * 原生拖拽在 webview 里拖出容器会触发浏览器的「拖拽自动滚动」，松手后还会继续把页面往下拉。
 * 长按 DRAG_HOLD_MS 才进入拖拽：mousedown 不拦默认行为，行内文字可以正常选词复制。
 * pinned 行固定在最前且不可拖动；落点在目标行上下半区，指针在表格下方即落到末尾，上方即落到开头。
 */
export function useRowDragOrder(
    names: string[],
    pinned: string[],
    onCommit: (order: string[]) => void
) {
    const [draggingName, setDraggingName] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget>(null);
    const tableRef = useRef<HTMLTableElement>(null);

    /** 可拖动的部分：除 pinned 之外的模型 */
    const tail = names.filter(name => !pinned.includes(name));

    /** 按指针位置算落点：表格之外按头 / 尾，行内按上下半区，pinned 行不接受落点 */
    const resolveTarget = (clientX: number, clientY: number): DropTarget => {
        const table = tableRef.current;
        const rect = table?.getBoundingClientRect();
        if (!table || !rect) return null;
        if (clientY > rect.bottom) return 'end';
        if (clientY < rect.top) return 'start';
        const row = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('tr[data-drag-name]');
        const name = row?.dataset.dragName;
        if (row && name && !pinned.includes(name)) {
            const rowRect = row.getBoundingClientRect();
            return { name, position: clientY < rowRect.top + rowRect.height / 2 ? 'before' : 'after' };
        }
        // 指针在表头等非行的区域：第一个可拖动行之上按开头处理
        const firstRow = table.querySelector<HTMLElement>('tr[data-drag-name]');
        if (firstRow && clientY < firstRow.getBoundingClientRect().top) return 'start';
        return null;
    };

    /** 把 moving 插到落点，pinned 保持置顶后提交 */
    const commitAt = (moving: string, target: DropTarget) => {
        if (!target) return;
        const next = tail.filter(name => name !== moving);
        if (target === 'end') {
            next.push(moving);
        } else if (target === 'start') {
            next.unshift(moving);
        } else {
            const index = next.indexOf(target.name);
            if (index === -1) return;
            next.splice(target.position === 'after' ? index + 1 : index, 0, moving);
        }
        onCommit([...names.filter(name => pinned.includes(name)), ...next]);
    };

    /**
     * mousedown 里不调 preventDefault：那会阻止浏览器建立文本选区，模型名就选不中、复制不了。
     * 改为按住不动 DRAG_HOLD_MS 后才进入拖拽（此时清掉已有选区并全局禁选）；
     * 长按未到期就移动超过阈值，判定为选词 / 误触，本次直接放弃拖拽。
     */
    const startDrag = (event: React.MouseEvent<HTMLTableRowElement>, name: string) => {
        // 只响应左键；行内按钮（编辑 / 删除）上按下不当作拖拽
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        const startX = event.clientX;
        const startY = event.clientY;
        let started = false;
        let moved = false;
        let holdTimer = 0;

        const cleanup = () => {
            window.clearTimeout(holdTimer);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.documentElement.removeEventListener('mouseleave', onLeave);
            document.body.classList.remove('row-dragging-active');
            setDraggingName(null);
            setDropTarget(null);
        };

        /** 长按到期：用户已经在选词就不抢手势，否则进入拖拽状态 */
        const beginDrag = () => {
            if (window.getSelection()?.toString()) return;
            started = true;
            setDraggingName(name);
            document.body.classList.add('row-dragging-active');
            window.getSelection()?.removeAllRanges();
        };

        const onMove = (e: MouseEvent) => {
            if (!started) {
                // 长按未到期就开始移动：交给浏览器选词，结束本次拖拽尝试
                if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) return;
                cleanup();
                return;
            }
            moved = true;
            setDropTarget(resolveTarget(e.clientX, e.clientY));
        };

        const onUp = (e: MouseEvent) => {
            // 长按后没移动就松手：不提交，避免把行原样插回原位
            const target = started && moved ? resolveTarget(e.clientX, e.clientY) : null;
            cleanup();
            if (target) commitAt(name, target);
        };

        // 指针移出 webview 时收不到 mouseup，直接取消，避免卡在拖拽状态
        const onLeave = () => cleanup();

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        document.documentElement.addEventListener('mouseleave', onLeave);
        holdTimer = window.setTimeout(beginDrag, DRAG_HOLD_MS);
    };

    const rowProps = (name: string, enabled: boolean) => {
        const draggable = enabled && !pinned.includes(name);
        // 拖到表格下方 / 上方时，用最后一行 / 第一行给出插入位提示
        const edge = dropTarget === 'end' && name === tail[tail.length - 1]
            ? 'after'
            : dropTarget === 'start' && name === tail[0] ? 'before' : null;
        const over = dropTarget && typeof dropTarget === 'object' && dropTarget.name === name
            ? dropTarget.position
            : edge;
        return {
            'data-drag-name': draggable ? name : undefined,
            className: [
                draggable ? 'model-row-draggable' : '',
                draggingName === name ? 'model-row-dragging' : '',
                over ? `model-row-drag-${over}` : '',
            ].filter(Boolean).join(' '),
            onMouseDown: draggable ? (event: React.MouseEvent<HTMLTableRowElement>) => startDrag(event, name) : undefined,
        };
    };

    return { tableRef, rowProps };
}
