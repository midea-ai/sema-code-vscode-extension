import React, { useState, useEffect, useRef } from 'react';

export interface IconSelectOption {
    value: string;
    label: string;
    /** 选项前的图标，如 <ProviderLogo provider={key} className="icon-select-logo" /> */
    icon?: React.ReactNode;
    /** 禁用该选项（可见但不可选） */
    disabled?: boolean;
}

interface IconSelectProps {
    id?: string;
    value: string;
    options: IconSelectOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
    /** value 匹配不到选项时按钮上显示的文案 */
    placeholder?: string;
}

/** 选项数超过该值时，下拉面板顶部显示搜索框 */
const SEARCH_THRESHOLD = 10;

/**
 * 自定义下拉选择器：选项支持图标与禁用态，弹层样式完全受控
 * （原生 select 的弹层由系统渲染，无法定制且不跟随主题）
 * 外观对齐全局 select 样式，见 styles.css 中 .icon-select 相关规则
 */
const IconSelect: React.FC<IconSelectProps> = ({ id, value, options, onChange, disabled, placeholder }) => {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    // 点击组件外部时收起
    useEffect(() => {
        if (!open) return;
        const onClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    const current = options.find(opt => opt.value === value);

    const searchable = options.length > SEARCH_THRESHOLD;
    const keyword = filter.trim().toLowerCase();
    const visibleOptions = searchable && keyword
        ? options.filter(opt =>
            opt.label.toLowerCase().includes(keyword) ||
            opt.value.toLowerCase().includes(keyword))
        : options;

    const selectOption = (opt: IconSelectOption) => {
        if (opt.disabled) return;
        onChange(opt.value);
        setOpen(false);
    };

    const toggleOpen = () => {
        setOpen(v => {
            if (!v) setFilter('');
            return !v;
        });
    };

    return (
        <div className="icon-select-wrapper" ref={wrapperRef}>
            <button
                type="button"
                id={id}
                className="icon-select"
                disabled={disabled}
                onClick={toggleOpen}
            >
                {current?.icon}
                <span className="icon-select-name">{current?.label ?? (value || placeholder || '')}</span>
            </button>
            {open && (
                <div className="icon-select-menu">
                    {searchable && (
                        <div className="icon-select-search">
                            <input
                                type="text"
                                autoFocus
                                value={filter}
                                placeholder="搜索..."
                                onChange={(e) => setFilter(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setOpen(false);
                                    } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const first = visibleOptions.find(opt => !opt.disabled);
                                        if (first) selectOption(first);
                                    }
                                }}
                            />
                        </div>
                    )}
                    {visibleOptions.length === 0 && (
                        <div className="icon-select-empty">无匹配选项</div>
                    )}
                    {visibleOptions.map(opt => (
                        <div
                            key={opt.value}
                            className={`icon-select-item ${opt.value === value ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
                            onClick={() => selectOption(opt)}
                        >
                            {opt.icon}
                            <span className="icon-select-item-label">{opt.label}</span>
                            {opt.value === value && (
                                <svg className="icon-select-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 8.5l3.5 3.5L13 5" />
                                </svg>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default IconSelect;
