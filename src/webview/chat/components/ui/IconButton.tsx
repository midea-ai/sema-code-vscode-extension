import React from 'react';

interface IconButtonProps {
    onClick?: () => void;
    title?: string;
    children: React.ReactNode;
    className?: string;
}

export const IconButton: React.FC<IconButtonProps> = ({ onClick, title, children, className = '' }) => {
    return (
        <button
            className={`icon-btn ${className}`}
            onClick={onClick}
            title={title}
        >
            {children}
        </button>
    );
};

interface ToggleIconProps {
    isExpanded: boolean;
}

// 面板标题 折叠/展开箭头图标
export const ToggleIcon: React.FC<ToggleIconProps> = ({ isExpanded }) => {
    return (
        <svg
            className={`toggle-icon ${isExpanded ? 'expanded' : ''}`}
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
             <path d="M6 4L10 8L6 12" />
        </svg>
    );
};

// 复制图标
export const CopyIcon: React.FC = () => {
    return (
        <svg 
            className="copy-icon"
            width="12" 
            height="12" 
            viewBox="0 0 16 16" 
            fill="none"
            stroke="currentColor" 
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="5" y="5" width="8" height="8" rx="1" />
            <path d="M3 11V3C3 2.44772 3.44772 2 4 2H11" />
        </svg>
    );
};

// 文件变更面板 全部放弃按钮
export const CancelCircleIcon: React.FC = () => {
    return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
        </svg>
    );
};


// 输入框 删除图标
export const RemoveIcon: React.FC = () => {
    return (
        <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
    );
};

// 输入框 添加文件图标
export const PlusIcon: React.FC = () => {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3.5a.5.5 0 0 1 .5.5v3.5H12a.5.5 0 0 1 0 1H8.5V12a.5.5 0 0 1-1 0V8.5H4a.5.5 0 0 1 0-1h3.5V4a.5.5 0 0 1 .5-.5z" />
        </svg>
    );
};

// 输入框 模型信息 下拉箭头图标
export const ChevronDownIcon: React.FC = () => {
    return (
        <svg className="model-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4,6 8,10 12,6" />
        </svg>
    );
};

// 输入框 模型信息 选中图标、文件变更面板 已采纳图标
export const CheckIcon: React.FC = () => {
    return (
        <svg className="model-check-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3,8 6,11 13,4" />
        </svg>
    );
};

// 输入框 放大按钮
export const ExpandIcon: React.FC = () => {
    return (
        // 放大图标：向外扩展的箭头
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 6 L2 2 L6 2" strokeLinejoin="round" />
            <path d="M14 10 L14 14 L10 14" strokeLinejoin="round" />
        </svg>
    );
};

// 输入框 缩小按钮
export const CollapseIcon: React.FC = () => {
    return (
        // 缩小图标：向内收缩的箭头
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 2 L10 6 L14 6" strokeLinejoin="round" />
            <path d="M6 14 L6 10 L2 10" strokeLinejoin="round" />
        </svg>
    );
};

// 输入框 发送按钮
export const SendIcon: React.FC = () => {
    return (
        // 向上箭头图标
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="12" x2="8" y2="4" />
            <polyline points="4,8 8,4 12,8" />
        </svg>
    );
};

// 输入框 停止按钮
export const StopIcon: React.FC = () => {
    return (
        // 停止图标 - 空心正方形
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="6" height="6" />
        </svg>
    );
};

