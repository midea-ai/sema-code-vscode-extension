import React, { useLayoutEffect, useRef, useState } from 'react';

interface ClampDescriptionProps {
    /** 描述文本 */
    text: string;
    /** 外层容器类名（含 padding / 字号等描述样式） */
    className: string;
    /** 是否已展开 */
    expanded: boolean;
    onToggle: () => void;
    moreLabel: string;
    collapseLabel: string;
}

const CLAMP_LINES = 2;

/**
 * 用一个隐藏的探针节点按真实排版二分：找出「截断文本 + … + 更多」能塞进 2 行的最大字符数。
 * 这样省略号和「更多」都在第二行末尾自然接排，不需要 line-clamp 或渐变遮罩。
 */
const findCut = (host: HTMLElement, text: string, moreLabel: string): number => {
    const cs = getComputedStyle(host);
    const width = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (width <= 0) return text.length;

    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
    probe.style.width = `${width - 1}px`;
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontSize = cs.fontSize;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontStyle = cs.fontStyle;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.style.wordSpacing = cs.wordSpacing;
    probe.style.lineHeight = cs.lineHeight;
    probe.style.wordBreak = cs.wordBreak;
    probe.style.overflowWrap = cs.overflowWrap;
    probe.style.whiteSpace = cs.whiteSpace;

    const slice = document.createElement('span');
    const more = document.createElement('span');
    more.className = 'description-toggle';
    more.textContent = moreLabel;
    probe.append(slice, more);
    document.body.appendChild(probe);

    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const maxHeight = lineHeight * CLAMP_LINES + 1;
    const fits = () => probe.getBoundingClientRect().height <= maxHeight;

    let cut: number;
    slice.textContent = text;
    more.style.display = 'none';
    if (fits()) {
        cut = text.length;
    } else {
        more.style.display = '';
        more.textContent = moreLabel;
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            slice.textContent = `${text.slice(0, mid)}…`;
            if (fits()) low = mid; else high = mid - 1;
        }
        cut = low;
        // 不要把 emoji 之类的代理对切成两半
        const code = text.charCodeAt(cut - 1);
        if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }

    probe.remove();
    return cut;
};

const ClampDescription: React.FC<ClampDescriptionProps> = ({ text, className, expanded, onToggle, moreLabel, collapseLabel }) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const widthRef = useRef(0);
    const [cut, setCut] = useState(text.length);

    // 按容器宽度重算截断位置；只在宽度变化时重测，避免测量结果引起循环
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const measure = () => {
            widthRef.current = host.clientWidth;
            const next = findCut(host, text, moreLabel);
            setCut(prev => (prev === next ? prev : next));
        };

        measure();
        const observer = new ResizeObserver(() => {
            if (Math.abs(host.clientWidth - widthRef.current) < 1) return;
            measure();
        });
        observer.observe(host);
        return () => observer.disconnect();
    }, [text, moreLabel]);

    const truncated = cut < text.length;
    const shown = expanded || !truncated ? text : `${text.slice(0, cut).trimEnd()}…`;

    return (
        <div ref={hostRef} className={className}>
            {shown}
            {truncated && (
                <span className="description-toggle" onClick={onToggle}>
                    {expanded ? collapseLabel : moreLabel}
                </span>
            )}
        </div>
    );
};

export default ClampDescription;
