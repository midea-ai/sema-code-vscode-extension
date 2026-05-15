import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { ToolContent } from '../../types';
import { streamingStore } from '../../utils/StreamingStore';

const MAX_VISIBLE_LINES = 4;

interface BackgroundJobBlockProps {
    content: ToolContent;
    messageId: string;
    vscode?: any;
}

// 模拟终端 \r 行为：\r 将光标移到行首，后续字符覆盖原内容
const processTerminalOutput = (text: string): string[] => {
    const resultLines: string[] = [];
    let currentLineChars: string[] = [];
    let pos = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\r') {
            if (i + 1 < text.length && text[i + 1] === '\n') {
                resultLines.push(currentLineChars.join(''));
                currentLineChars = [];
                pos = 0;
                i++;
            } else {
                pos = 0;
            }
        } else if (char === '\n') {
            resultLines.push(currentLineChars.join(''));
            currentLineChars = [];
            pos = 0;
        } else {
            currentLineChars[pos] = char;
            pos++;
        }
    }

    const lastLine = currentLineChars.join('');
    if (lastLine) {
        resultLines.push(lastLine);
    }

    return resultLines;
};

const BackgroundJobBlock: React.FC<BackgroundJobBlockProps> = ({ content: toolContent, messageId, vscode }) => {
    const [isExpanded, setIsExpanded] = useState(true);
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
        if (toolContent.completed !== false) {
            streamContentRef.current = '';
            setStreamContent('');
        }
    }, [toolContent.completed]);

    // streaming 中用本地累积的 content，完成后用 props
    const displayContent = (toolContent.completed === false && streamContent)
        ? { ...toolContent, content: (toolContent.content || '') + streamContent }
        : toolContent;

    const parsedContent = useMemo(() => {
        const { title, content } = displayContent;

        let outputLines: string[] = [];
        if (content && typeof content === 'string') {
            outputLines = processTerminalOutput(content).filter(line => line.trim());
        }

        const totalLines = outputLines.length;
        const visibleLines = totalLines > MAX_VISIBLE_LINES ? outputLines.slice(-MAX_VISIBLE_LINES) : outputLines;
        const omittedCount = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0;

        return { title, outputLines, visibleLines, omittedCount, outputText: outputLines.join('\n') };
    }, [displayContent.content, displayContent.title]);

    const { title, outputLines, visibleLines, omittedCount, outputText } = parsedContent;
    const isStreaming = toolContent.completed === false;

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (vscode) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: outputText,
                command: title || '',
                toolId: toolContent.toolId || ''
            });
        }
    };

    return (
        <div className="chat-block chat-block--borderless bash-block">
            <div className="chat-block-header bash-block-header" onClick={handleToggle}>
                <div className="chat-block-title bash-block-title">
                    <span className="chat-block-title-label">BackgroundJob</span>
                    {title && <span className="chat-block-title-detail">{title}</span>}
                    {isStreaming && <span className="bash-streaming-dot" />}
                    <div className="bash-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="chat-block-content bash-block-content">
                    {visibleLines.length > 0 && (
                        <>
                            {omittedCount > 0 && (
                                <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...省略了 {omittedCount} 行</div>
                            )}
                            <pre className="bash-output pub-block-content">{visibleLines.join('\n')}</pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(BackgroundJobBlock);
