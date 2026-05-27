import React, { useState, useRef, useLayoutEffect, useCallback } from 'react';

// 折叠态最大高度（px），需与 code.css 中 .collapsible-diff.collapsed 的 max-height 同步
const COLLAPSED_MAX_PX = 140;

interface CollapsibleContentProps {
    children: React.ReactNode;
}

/**
 * 通用内容折叠容器：内容超长时折叠到固定高度，底部渐隐 + 左下角「展开/收起」，替代内部滚动。
 * 与 CollapsibleDiff 同一套折叠机制，复用 .collapsible-diff / .collapsible-diff-toggle 样式，
 * 区别仅在于这里包裹任意 children（如 markdown），而非写死的 UpdateCodeDiff。
 */
const CollapsibleContent: React.FC<CollapsibleContentProps> = React.memo(({ children }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const measure = () => {
            setIsOverflowing(el.scrollHeight > COLLAPSED_MAX_PX + 1);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded(prev => !prev);
    }, []);

    return (
        <>
            <div
                ref={ref}
                className={`collapsible-diff${isOverflowing && !isExpanded ? ' collapsed' : ''}`}
            >
                {children}
            </div>
            {isOverflowing && (
                <button type="button" className="collapsible-diff-toggle" onClick={handleToggle}>
                    {isExpanded ? '收起' : '展开'}
                </button>
            )}
        </>
    );
});

CollapsibleContent.displayName = 'CollapsibleContent';

export default CollapsibleContent;
