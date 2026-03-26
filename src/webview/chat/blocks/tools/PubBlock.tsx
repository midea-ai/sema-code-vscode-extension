import React, { useState } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { ToolContent } from '../../types';

interface PubBlockProps {
    content: ToolContent;
}

const PubBlock: React.FC<PubBlockProps> = React.memo(({ content }) => {
    const { toolName, title, summary, content: toolContent } = content;

    // 构建格式化标题
    const toolNameMap = {
        'Glob': 'Search',
        'Grep': 'Search'
    } as const;

    // 解析 MCP 工具名称格式：mcp__serviceName__toolName -> serviceName - toolName
    const parseMcpToolName = (name: string): string => {
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

    const [isExpanded, setIsExpanded] = useState(false);  // 默认折叠

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
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
            {isExpanded && contentLines.length > 0 && (
                <div className="pub-block-content">
                    {contentLines.join('\n')}
                </div>
            )}
        </div>
    );
});

PubBlock.displayName = 'PubBlock';

export default PubBlock;