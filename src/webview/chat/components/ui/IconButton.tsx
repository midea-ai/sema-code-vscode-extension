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

// 时钟图标（用户输入来源标签：定时任务）
export const ClockIcon: React.FC = () => {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4.5V8l2.5 1.5" />
        </svg>
    );
};

// 地球图标（模型配置提醒块的语言选择入口）
export const GlobeIcon: React.FC = () => {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="8" cy="8" r="6" />
            <path d="M2 8h12" />
            <path d="M8 2c1.8 1.8 2.7 3.8 2.7 6S9.8 12.2 8 14c-1.8-1.8-2.7-3.8-2.7-6S6.2 3.8 8 2z" />
        </svg>
    );
};

// 滑块/设置图标（模型配置提醒块左侧）
export const SlidersIcon: React.FC = () => {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M2 5h5M11 5h3M2 11h3M9 11h5" />
            <circle cx="9" cy="5" r="1.8" />
            <circle cx="7" cy="11" r="1.8" />
        </svg>
    );
};

// 用户输入块 Fork / 撤销图标（git-fork 样式）
export const ForkIcon: React.FC = () => {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="4" cy="13" r="1.5" />
            <circle cx="12" cy="3" r="1.5" />
            <path d="M4 4.5v7" />
            <path d="M12 4.5c0 3.5-8 1.5-8 5" />
        </svg>
    );
};

// AI 回复「分支到新聊天」图标（git-branch 样式，与 ForkIcon 区分）
export const BranchIcon: React.FC = () => {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="4" cy="13" r="1.5" />
            <circle cx="12" cy="6" r="1.5" />
            <path d="M4 4.5v7" />
            <path d="M12 7.5c0 2.5-8 1-8 4" />
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

