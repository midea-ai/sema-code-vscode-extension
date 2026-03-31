import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import BaseBashContent from '../../components/ui/BaseBashContent';
import { ToolContent } from '../../types';
import { streamingStore } from '../../utils/StreamingStore';

const MAX_VISIBLE_LINES = 4;

interface BashBlockProps {
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
                // \r\n：Windows 换行
                resultLines.push(currentLineChars.join(''));
                currentLineChars = [];
                pos = 0;
                i++;
            } else {
                // 单独 \r：光标回到行首，不清除内容，后续字符覆盖
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

const BashBlock: React.FC<BashBlockProps> = ({ content: toolContent, messageId, vscode }) => {
    // console.log('BashBlock:', JSON.stringify(toolContent));
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
        if (toolContent.completed) {
            streamContentRef.current = '';
            setStreamContent('');
        }
    }, [toolContent.completed]);

    // streaming 中用本地累积的 content，完成后用 props
    const displayContent = (!toolContent.completed && streamContent)
        ? { ...toolContent, content: (toolContent.content || '') + streamContent }
        : toolContent;

    // 解析结构化数据，依赖字符串值而非对象引用，避免多余重算
    const parsedContent = useMemo(() => {
        const { title, content } = displayContent;

        let command = title;
        // content 包含输出内容
        let outputLines: string[] = [];
        if (content && typeof content === 'string') {
            outputLines = processTerminalOutput(content).filter(line => line.trim());
        }

        const totalLines = outputLines.length;
        const visibleLines = totalLines > MAX_VISIBLE_LINES ? outputLines.slice(-MAX_VISIBLE_LINES) : outputLines;
        const omittedCount = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0;

        return { command, outputLines, visibleLines, omittedCount, outputText: outputLines.join('\n') };
    }, [displayContent.content, displayContent.title]);

    const { command, outputLines, visibleLines, omittedCount, outputText } = parsedContent;
    const isStreaming = !toolContent.completed;

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (vscode) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: outputText,
                command: command || '',
                toolId: toolContent.toolId || ''
            });
        }
    };

    return (
        <div className="bash-block">
            <div className="bash-block-header" onClick={handleToggle}>
                <div className="bash-block-title">
                    <span className="bash-title-text">Bash</span>
                    {isStreaming && <span className="bash-streaming-dot" />}
                    <div className="bash-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="bash-block-content">
                    {command && (
                        <BaseBashContent command={command} />
                    )}
                    {visibleLines.length > 0 && (
                        <>
                            {omittedCount > 0 && (
                                <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...省略了 {omittedCount} 行</div>
                            )}
                            <pre className="bash-output">{visibleLines.join('\n')}</pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(BashBlock);