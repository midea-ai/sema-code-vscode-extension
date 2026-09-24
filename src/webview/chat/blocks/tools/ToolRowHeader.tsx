import React from 'react';
import { SearchIcon, ToggleIcon } from '../../components/ui/IconButton';
import { SearchRowMeta } from './utils';

interface ToolRowHeaderProps {
    /** 左侧 14px 图标位；streaming 时显示流式点 */
    icon: React.ReactNode;
    streaming?: boolean;
    /** 动词（已运行 / 已读取 / 探索了 N 个工具 …），不换行不截断 */
    verb: React.ReactNode;
    /** 目标（文件名 / 命令 / 参数），默认单行省略；wrap 时允许换行（Read 合并行） */
    target?: React.ReactNode;
    targetTitle?: string;
    wrap?: boolean;
    /** 目标可点（打开文件）：链接样式，点击不冒泡到行 */
    onTargetClick?: (e: React.MouseEvent) => void;
    /** 目标之后的附加内容（+n -m 统计等） */
    extra?: React.ReactNode;
    /** 可展开：显示箭头，折叠时 hover 才出现，展开时常显 */
    expandable?: boolean;
    isExpanded?: boolean;
    /** 整行点击（展开 / 打开文件） */
    onClick?: (e: React.MouseEvent) => void;
    /** 行 hover 提示（完整命令等） */
    title?: string;
    /** 右侧插槽（复制按钮等） */
    right?: React.ReactNode;
    className?: string;
}

/**
 * 工具行统一行头：[图标] [动词] [目标] [附加] [箭头]。
 * 组头、组内行、单条 Read / Shell / Pub / BackgroundJob 块共用，保证图标列与文字起点对齐。
 */
const ToolRowHeader: React.FC<ToolRowHeaderProps> = ({
    icon,
    streaming = false,
    verb,
    target,
    targetTitle,
    wrap = false,
    onTargetClick,
    extra,
    expandable = false,
    isExpanded = false,
    onClick,
    title,
    right,
    className = '',
}) => {
    const headerClass = [
        'chat-block-header',
        'tool-row-header',
        (expandable || onClick) ? 'tool-row-header--clickable' : '',
        className,
    ].filter(Boolean).join(' ');

    const hasTarget = target !== undefined && target !== null && target !== '';
    // 无目标时动词就是整行内容（搜索句子等），允许收缩并省略，避免越界被裁掉
    const verbClass = hasTarget ? 'tool-row-verb' : 'tool-row-verb tool-row-verb--fill';

    const targetClass = [
        'tool-row-target',
        wrap ? 'tool-row-target--wrap' : '',
        onTargetClick ? 'tool-row-target--link' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={headerClass} onClick={onClick} title={title}>
            <div className="chat-block-title tool-row-title">
                <span className="tool-row-icon">
                    {streaming ? <span className="bash-streaming-dot" /> : icon}
                </span>
                <span className={verbClass}>{verb}</span>
                {hasTarget && (
                    <span
                        className={targetClass}
                        title={targetTitle}
                        onClick={onTargetClick ? (e) => { e.stopPropagation(); onTargetClick(e); } : undefined}
                    >
                        {target}
                    </span>
                )}
                {extra}
                {expandable && (
                    <div className={`tool-row-toggle${isExpanded ? ' tool-row-toggle--visible' : ''}`}>
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                )}
            </div>
            {right}
        </div>
    );
};

/** 搜索行行头（组内与单条共用）：图标 已搜索 “关键词” 在 目录 (glob)，不可展开 */
export const SearchRowHeader: React.FC<{ meta: SearchRowMeta; streaming?: boolean }> = ({ meta, streaming = false }) => (
    <ToolRowHeader
        icon={<SearchIcon />}
        streaming={streaming}
        verb={meta.verb}
        target={meta.target}
        title={meta.title}
        extra={meta.location ? <span className="tool-row-location">{meta.location}</span> : undefined}
    />
);

export default ToolRowHeader;
