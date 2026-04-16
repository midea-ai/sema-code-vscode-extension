import React, { useState, useEffect, useRef } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { ToolContent } from '../../types';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';
import { streamingStore } from '../../utils/StreamingStore';

const MAX_VISIBLE_LINES = 4;

interface PubBlockProps {
    content: ToolContent;
    messageId: string;
    vscode?: any;
}

const PubBlock: React.FC<PubBlockProps> = React.memo(({ content, messageId, vscode }) => {
    const streamContentRef = useRef('');
    const [streamContent, setStreamContent] = useState('');

    useEffect(() => {
        const unsub = streamingStore.subscribeTool(messageId, (delta: string) => {
            streamContentRef.current += delta;
            setStreamContent(streamContentRef.current);
        });
        return () => {
            unsub();
            streamContentRef.current = '';
        };
    }, [messageId]);

    // 完成后清除本地 streaming 状态，回归 props 的最终内容
    useEffect(() => {
        if (content.completed !== false) {
            streamContentRef.current = '';
            setStreamContent('');
        }
    }, [content.completed]);

    // streaming 中用本地累积的 content，完成后用 props
    const displayToolContent = (content.completed === false && streamContent)
        ? { ...content, content: (content.content || '') + streamContent }
        : content;

    const { toolName, title, summary, content: toolContent } = displayToolContent;

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

    // 默认展开的工具列表，流式中也自动展开
    const DEFAULT_EXPANDED_TOOLS = ['TaskStop'];
    const [isExpanded, setIsExpanded] = useState(DEFAULT_EXPANDED_TOOLS.includes(toolName) || content.completed === false);

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