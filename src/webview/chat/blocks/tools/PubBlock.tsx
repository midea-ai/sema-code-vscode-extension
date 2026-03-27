import React, { useState } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { ToolContent } from '../../types';

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

    const toolValue = toolNameMap[toolName as keyof typeof toolNameMap] || parseMcpToolName(toolName);
    const formattedTitle = toolName === 'AskUserQuestion' ? 'User Response' : `${toolValue}(${title})`;

    // 处理内容格式
    const formatContent = () => {
        if (summary) {
            return `⎿ ${summary}\n${toolContent}`;
        }
        return toolContent.toString();
    };

    const formattedContent = formatContent();

    const contentLines = formattedContent.split('\n').filter(line => line.trim());

    const totalLines = contentLines.length;
    const visibleLines = totalLines > MAX_VISIBLE_LINES ? contentLines.slice(-MAX_VISIBLE_LINES) : contentLines;
    const omittedCount = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0;

    const [isExpanded, setIsExpanded] = useState(false);  // 默认折叠

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (vscode) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: contentLines.join('\n'),
                command: formattedTitle
            });
        }
    };

    return (
        <div className="pub-block">
            <div className="pub-block-header" onClick={handleToggle}>
                <div className="pub-block-title">
                    <span className="pub-title-text">{formattedTitle}</span>
                    <div className="pub-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && visibleLines.length > 0 && (
                <div className="pub-block-content">
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