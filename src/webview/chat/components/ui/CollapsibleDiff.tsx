import React, { useState, useRef, useLayoutEffect, useCallback } from 'react';
import UpdateCodeDiff from './UpdateCodeDiff';
import { DiffContent } from '../../types';

// 折叠态最大高度（px），需与 code.css 中 .collapsible-diff.collapsed 的 max-height 同步
const COLLAPSED_MAX_PX = 140;

interface CollapsibleDiffProps {
    diffContent: DiffContent;
    language: string;
}

/**
 * 代码 diff 折叠容器：内容超长时不再内部滚动，改为底部渐隐 + 左下角「展开/收起」。
 * 参考 UserInputBlock 的折叠测量方式（scrollHeight 不受 max-height/overflow 影响）。
 */
const CollapsibleDiff: React.FC<CollapsibleDiffProps> = React.memo(({ diffContent, language }) => {
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
    }, [diffContent]);

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
                <UpdateCodeDiff diffContent={diffContent} language={language} />
            </div>
            {isOverflowing && (
                <button type="button" className="collapsible-diff-toggle" onClick={handleToggle}>
                    {isExpanded ? '收起' : '展开'}
                </button>
            )}
        </>
    );
});

CollapsibleDiff.displayName = 'CollapsibleDiff';

export default CollapsibleDiff;
