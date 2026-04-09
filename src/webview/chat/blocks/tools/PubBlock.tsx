import React, { useState } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { ToolContent } from '../../types';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';

const MAX_VISIBLE_LINES = 4;

interface PubBlockProps {
    content: ToolContent;
    vscode?: any;
}

const PubBlock: React.FC<PubBlockProps> = React.memo(({ content, vscode }) => {
    const { toolName, title, summary, content: toolContent } = content;

    // 构建格式化标题
    const toolNameMap = {
        'Glob': 'Search',
        'Grep': 'Search'
    } as const;

    // 解析 MCP 工具名称格式：mcp__serviceName__toolName -> serviceName - toolName
    const parseMcpToolName = (name: string): string => {
        if (!name) return '';
        const mcpMatch = name.match(/^mcp__(.+?)__(.+)$/);
        if (mcpMatch) {
            return `${mcpMatch[1]} - ${mcpMatch[2]}`;
        }
        return name;
    };

    const toolValue = toolName === 'AskUserQuestion' ? 'User Response' : (toolNameMap[toolName as keyof typeof toolNameMap] || parseMcpToolName(toolName));
    const displayTitle = toolName === 'AskUserQuestion' ? null : title;

    // 处理内容格式
    const formatContent = () => {
        if (summary) {
            return `${CONTINUATION_SYMBOL} ${summary}\n${toolContent}`;
        }
        return toolContent.toString();
    };

    const formattedContent = formatContent();

    const contentLines = formattedContent.split('\n').filter(line => line.trim());

    const totalLines = contentLines.length;
    const visibleLines = totalLines > MAX_VISIBLE_LINES ? contentLines.slice(-MAX_VISIBLE_LINES) : contentLines;
    const omittedCount = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0;

    // 默认展开的工具列表
    const DEFAULT_EXPANDED_TOOLS = ['TaskStop'];
    const [isExpanded, setIsExpanded] = useState(DEFAULT_EXPANDED_TOOLS.includes(toolName));

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (vscode) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: contentLines.join('\n'),
                command: displayTitle ? `${toolValue} ${displayTitle}` : toolValue,
                toolId: content.toolId || ''
            });
        }
    };

    return (
        <div className="chat-block chat-block--borderless pub-block">
            <div className="chat-block-header pub-block-header" onClick={handleToggle}>
                <div className="chat-block-title pub-block-title">
                    <span className="chat-block-title-label">{toolValue}</span>
                    {displayTitle && <span className="chat-block-title-detail">{displayTitle}</span>}
                    <div className="pub-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && visibleLines.length > 0 && (
                <div className="chat-block-content pub-block-content">
                    {omittedCount > 0 && (
                        <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...省略了 {omittedCount} 行</div>
                    )}
                    {visibleLines.join('\n')}
                </div>
            )}
        </div>
    );
});

PubBlock.displayName = 'PubBlock';

export default PubBlock;