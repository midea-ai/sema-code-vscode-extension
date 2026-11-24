import React from 'react';

export interface SegmentedOption<T extends string> {
    value: T;
    label: React.ReactNode;
    title?: string;
}

interface SegmentedControlProps<T extends string> {
    value: T;
    options: SegmentedOption<T>[];
    onChange: (value: T) => void;
    className?: string;
    ariaLabel?: string;
}

/**
 * 配置页的分段切换控件（使用情况页的范围/能力切换、导入面板的范围切换共用）。
 * 外观在 style/section.css 的 .section-segmented 里，与页面骨架一起保证跨页一致。
 */
function SegmentedControl<T extends string>({
    value,
    options,
    onChange,
    className,
    ariaLabel,
}: SegmentedControlProps<T>) {
    return (
        <div className={`section-segmented${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
            {options.map(option => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        title={option.title}
                        className={`section-seg-btn${active ? ' active' : ''}`}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export default SegmentedControl;
