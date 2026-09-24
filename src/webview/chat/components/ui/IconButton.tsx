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

interface ToolIconProps {
    size?: number;
}

const toolIconAttrs = (size: number) => ({
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
});

// 终端图标（工具行：命令）
export const TerminalIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M3 4l4 4-4 4" />
        <path d="M8 12h5" />
    </svg>
);

// 叉号图标（工具行：执行失败）
export const XIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
);

// 文档图标（工具行：读取 / 写入文件）
export const FileTextIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" />
        <path d="M9 1.5V5h3.5" />
        <path d="M6 8.5h4M6 11h4" />
    </svg>
);

// 铅笔图标（工具行：编辑文件）
export const PencilIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M11.5 2.5l2 2L5.5 12.5l-3 1 1-3z" />
        <path d="M10 4l2 2" />
    </svg>
);

// 放大镜图标（工具行：搜索）
export const SearchIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
    </svg>
);

// 扳手图标（工具行：后台任务 / 未知工具）
export const WrenchIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M10.5 2a3.5 3.5 0 0 0-3.2 4.9L2 12.2 3.8 14l5.3-5.3A3.5 3.5 0 0 0 14 5.5l-2.2 1.3-1.6-1.6L11.5 3z" />
    </svg>
);

// 插头图标（工具行：MCP 调用）
export const PlugIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M6 2v3M10 2v3" />
        <path d="M4 5h8v2.5a4 4 0 0 1-8 0z" />
        <path d="M8 11.5V14" />
    </svg>
);

// 问号气泡图标（工具行：向用户提问）
export const QuestionBubbleIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)}>
        <path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H7l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5z" />
        <path d="M6.5 5.2a1.6 1.6 0 1 1 2.2 1.5c-.5.2-.7.5-.7 1" />
        <path d="M8 9.2h.01" />
    </svg>
);

// 大脑图标（工具行：memory 写入）：取自 lucide brain，24 视口，线宽按 16 视口的 1.4 等比换算为 2.1
export const BrainIcon: React.FC<ToolIconProps> = ({ size = 14 }) => (
    <svg {...toolIconAttrs(size)} viewBox="0 0 24 24" strokeWidth={2.1}>
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.967-.516" />
        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
);

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

