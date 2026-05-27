import React, { useState, useMemo, useEffect, useRef, useContext } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { SessionContext } from '../../SessionContext';
import BaseBashContent from '../../components/ui/BaseBashContent';
import { ToolContent } from '../../types';
import { streamingStore } from '../../utils/StreamingStore';

const MAX_VISIBLE_LINES = 2;

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
    const sessionId = useContext(SessionContext);
    const [isExpanded, setIsExpanded] = useState(true);
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
        if (toolContent.completed !== false) {
            streamContentRef.current = '';
            setStreamContent('');
        }
    }, [toolContent.completed]);

    // streaming 中用本地累积的 content，完成后用 props
    const displayContent = (toolContent.completed === false && streamContent)
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
    const isStreaming = toolContent.completed === false;

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (command) {
            navigator.clipboard.writeText(command);
        }
    };

    // 「省略了 N 行」→ 仅打开纯执行结果（无命令、无开头 #）
    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (vscode) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: outputText,
                command: '',
                toolId: toolContent.toolId || ''
            });
        }
    };

    // 命令过长 → 仅打开完整命令（无执行结果、无开头 #），单独 tab 避免与结果互相覆盖
    const handleOpenCommand = () => {
        if (vscode && command) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: command,
                command: '',
                toolId: toolContent.toolId ? `${toolContent.toolId}-cmd` : ''
            });
        }
    };

    return (
        <div className="chat-block bash-block">
            <div className="chat-block-header bash-block-header" onClick={handleToggle}>
                <div className="chat-block-title bash-block-title">
                    <span className="chat-block-title-label">Shell</span>
                    {isStreaming && <span className="bash-streaming-dot" />}
                    <div className="bash-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
                {command && (
                    <div className="bash-copy-btn" onClick={handleCopy}>复制</div>
                )}
            </div>
            {isExpanded && (
                <div className="chat-block-content bash-block-content">
                    {command && (
                        <BaseBashContent command={command} onOpenFull={handleOpenCommand} />
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