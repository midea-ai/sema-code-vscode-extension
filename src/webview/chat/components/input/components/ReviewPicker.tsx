import React, { useEffect, useRef } from 'react';

export interface ReviewPickerItem {
    key: string;
    /** 标签前缀（如「[未提交]」），用主题高亮色 */
    tag?: string;
    label: string;
    /** 右侧灰字说明；空串不渲染（提交列表只显示标题） */
    desc: string;
    /** 不可选（如没有未提交的改动）：置灰，回车 / 点击无效 */
    disabled?: boolean;
}

export interface ReviewPickerProps {
    show: boolean;
    title: string;
    items: ReviewPickerItem[];
    /** items 为空时显示的一行提示（加载中 / 没有匹配的提交） */
    emptyText: string;
    /** 当前选中项，调用方保证落在 items 范围内 */
    selectedIndex: number;
    onSelect: (index: number) => void;
    panelRef: React.RefObject<HTMLDivElement>;
}

/**
 * /review 的范围面板：第一步选「未提交的改动 / 某次提交」，第二步选具体提交。
 * 弹窗与行样式复用斜杠面板的 .shortcut-panel-*；状态与键盘导航在 useReviewPicker，这里只管渲染与点击。
 */
const ReviewPicker: React.FC<ReviewPickerProps> = ({ show, title, items, emptyText, selectedIndex, onSelect, panelRef }) => {
    const selectedItemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex, items.length]);

    if (!show) return null;

    return (
        // mousedown 不让焦点离开输入框：选完提交步骤后还要继续在输入框里打字过滤
        <div className="shortcut-panel-popup" ref={panelRef} onMouseDown={e => e.preventDefault()}>
            <div className="shortcut-panel-section-title">{title}</div>
            {items.length === 0 ? (
                <div className="review-picker-empty">{emptyText}</div>
            ) : items.map((item, idx) => (
                <div
                    key={item.key}
                    ref={idx === selectedIndex ? selectedItemRef : null}
                    className={`shortcut-panel-item review-picker-item ${idx === selectedIndex ? 'selected' : ''} ${item.disabled ? 'disabled' : ''}`}
                    onClick={() => onSelect(idx)}
                >
                    <span className="shortcut-command" title={(item.tag ?? '') + item.label}>
                        {item.tag && <span className="review-picker-tag">{item.tag}</span>}
                        {item.label}
                    </span>
                    {item.desc && <span className="shortcut-desc">{item.desc}</span>}
                </div>
            ))}
        </div>
    );
};

export default ReviewPicker;
