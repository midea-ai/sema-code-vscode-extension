import React, { useRef, useState } from 'react';

type DropPosition = 'before' | 'after';
/** 落点：某行的上/下半区，或整个可拖区域的头部 / 尾部 */
type DropTarget = { name: string; position: DropPosition } | 'start' | 'end' | null;

/**
 * 表格行拖拽排序（对话模型 / 图像模型列表共用）。
 * 用 mousedown + window 上的 mousemove / mouseup 实现，不用原生 HTML5 拖拽：
 * 原生拖拽在 webview 里拖出容器会触发浏览器的「拖拽自动滚动」，松手后还会继续把页面往下拉。
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

    const startDrag = (event: React.MouseEvent<HTMLTableRowElement>, name: string) => {
        // 只响应左键；行内按钮（编辑 / 删除）上按下不当作拖拽
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        let started = false;

        const cleanup = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.documentElement.removeEventListener('mouseleave', onLeave);
            document.body.classList.remove('row-dragging-active');
            setDraggingName(null);
            setDropTarget(null);
        };

        const onMove = (e: MouseEvent) => {
            if (!started) {
                // 位移超过阈值才算拖拽，避免点击时轻微抖动触发换序
                if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) return;
                started = true;
                setDraggingName(name);
                document.body.classList.add('row-dragging-active');
            }
            setDropTarget(resolveTarget(e.clientX, e.clientY));
        };

        const onUp = (e: MouseEvent) => {
            const target = started ? resolveTarget(e.clientX, e.clientY) : null;
            cleanup();
            if (target) commitAt(name, target);
        };

        // 指针移出 webview 时收不到 mouseup，直接取消，避免卡在拖拽状态
        const onLeave = () => cleanup();

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        document.documentElement.addEventListener('mouseleave', onLeave);
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
