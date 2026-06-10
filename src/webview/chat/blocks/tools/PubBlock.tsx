import React, { useState, useEffect, useRef, useContext } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { SessionContext } from '../../SessionContext';
import { ToolContent } from '../../types';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';
import { streamingStore } from '../../utils/StreamingStore';
import { TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_STOP_BG_JOB, TOOL_NAME_PICK_OPTION } from '../../../../utils/tool';

const MAX_VISIBLE_LINES = 2;

interface PubBlockProps {
    content: ToolContent;
    messageId: string;
    vscode?: any;
}

const PubBlock: React.FC<PubBlockProps> = React.memo(({ content, messageId, vscode }) => {
    const sessionId = useContext(SessionContext);
    const streamContentRef = useRef('');
    const [streamContent, setStreamContent] = useState('');

    useEffect(() => {
        const unsub = streamingStore.subscribeTool(sessionId, messageId, (delta: string) => {
            streamContentRef.current += delta;
            setStreamContent(streamContentRef.current);
        });
        return () => {
            unsub();
            streamContentRef.current = '';
        };
    }, [messageId, sessionId]);

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
        [TOOL_NAME_SEARCH_FILES]: 'Search',
        [TOOL_NAME_SEARCH_CONTENT]: 'Search',
        [TOOL_NAME_STOP_BG_JOB]: 'StopBackgroundJob'
    } as const;

    // 解析工具名称：MCP 格式保留 serviceName - toolName，其他工具转为大驼峰
    const formatToolName = (name: string): string => {
        if (!name) return '';
        const mcpMatch = name.match(/^mcp__(.+?)__(.+)$/);
        if (mcpMatch) {
            return `${mcpMatch[1]} - ${mcpMatch[2]}`;
        }
        return name
            .split(/[_\s]+/)
            .filter(Boolean)
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');
    };

    const toolValue = toolName === TOOL_NAME_PICK_OPTION ? 'User Response' : (toolNameMap[toolName as keyof typeof toolNameMap] || formatToolName(toolName));
    const displayTitle = toolName === TOOL_NAME_PICK_OPTION ? null : title;

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
    const DEFAULT_EXPANDED_TOOLS = [TOOL_NAME_STOP_BG_JOB];
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
            {isExpanded && (
                <div className="chat-block-content pub-block-content">
                    {visibleLines.length > 0 && (
                        <>
                            {omittedCount > 0 && (
                                <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...省略了 {omittedCount} 行</div>
                            )}
                            {visibleLines.map((line, i) => (
                                <div key={i} className="bash-output-line">{line}</div>
                            ))}
                        </>
                    )}
                    {content.autoAllowedContent && (
                        <div className="auto-allowed-info">{CONTINUATION_SYMBOL} {content.autoAllowedContent}</div>
                    )}
                </div>
            )}
        </div>
    );
});

PubBlock.displayName = 'PubBlock';

export default PubBlock;