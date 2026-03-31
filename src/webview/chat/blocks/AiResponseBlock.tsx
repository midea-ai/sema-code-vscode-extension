// 简化的 AiResponseBlock - 只支持基本Markdown功能
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { renderMarkdownToHtml, hasMarkdownFormatting } from '../utils/markdown';
import { getResponseDot } from '../utils/permissionUtils';
import { streamingStore } from '../utils/StreamingStore';
import '../utils/markdown.css';

interface AiResponseBlockProps {
    content: string;
    messageId: string;
    isStreaming?: boolean;
    vscode?: any;
}

const AiResponseBlock: React.FC<AiResponseBlockProps> = React.memo(({
    content,
    messageId,
    isStreaming = false,
    vscode
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    // 流式累积文本（ref 存最新值，state 驱动渲染）
    const streamBufferRef = useRef<string>('');
    const [streamContent, setStreamContent] = useState<string>('');

    // 合并文件路径验证和点击事件监听，只依赖 vscode
    useEffect(() => {
        if (!contentRef.current || !vscode) return;

        const handleFilePathVerification = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'filePathVerified' && contentRef.current) {
                const { tempId, exists, filePath, lineInfo } = message;
                const element = contentRef.current.querySelector(`[data-temp-id="${tempId}"]`);

                if (element) {
                    if (exists) {
                        element.classList.add('file-path-code');
                        element.setAttribute('data-file-path', filePath);
                        if (lineInfo) {
                            element.setAttribute('data-line-info', lineInfo);
                        }
                    }
                    element.removeAttribute('data-temp-id');
                }
            }
        };

        const handleFilePathClick = (event: Event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('file-path-code')) {
                event.preventDefault();

                const filePath = target.getAttribute('data-file-path');
                const lineInfo = target.getAttribute('data-line-info');

                if (filePath) {
                    let startLine = 1;
                    let endLine: number | undefined;

                    if (lineInfo) {
                        if (lineInfo.includes('~') || lineInfo.includes('-')) {
                            const separator = lineInfo.includes('~') ? '~' : '-';
                            const parts = lineInfo.split(separator);
                            startLine = parseInt(parts[0]);
                            endLine = parseInt(parts[1]);
                            if (isNaN(startLine)) startLine = 1;
                            if (isNaN(endLine)) endLine = undefined;
                        } else {
                            const parsedLine = parseInt(lineInfo);
                            startLine = isNaN(parsedLine) ? 1 : parsedLine;
                        }
                    }

                    vscode.postMessage({
                        type: 'openFile',
                        filePath: filePath,
                        line: startLine,
                        endLine: endLine
                    });
                }
            }
        };

        contentRef.current.addEventListener('click', handleFilePathClick);
        window.addEventListener('message', handleFilePathVerification);

        return () => {
            contentRef.current?.removeEventListener('click', handleFilePathClick);
            window.removeEventListener('message', handleFilePathVerification);
        };
    }, [vscode]);

    // 流式模式：订阅 streamingStore，累积 delta 到 buffer，分段触发 markdown 渲染
    useEffect(() => {
        if (!isStreaming) {
            // 流式结束时重置 buffer
            streamBufferRef.current = '';
            setStreamContent('');
            return;
        }
        streamBufferRef.current = '';
        setStreamContent('');

        const unsub = streamingStore.subscribeText(messageId, (data) => {
            if (data.contentDelta) {
                streamBufferRef.current += data.contentDelta;
                setStreamContent(streamBufferRef.current);
            }
        });
        return unsub;
    }, [isStreaming, messageId]);

    // 决定当前要渲染的文本：流式阶段用累积的 streamContent，否则用 props.content
    const displayText = isStreaming ? streamContent : (content || '');
    const trimmedContent = displayText.replace(/^\n+|\n+$/g, '');
    const needsMarkdown = hasMarkdownFormatting(trimmedContent);

    const htmlContent = useMemo(() => {
        if (!needsMarkdown || !trimmedContent) return null;
        // 流式阶段不传 vscode，避免对未完成内容发起文件路径验证请求
        return renderMarkdownToHtml(trimmedContent, isStreaming ? undefined : vscode);
    }, [trimmedContent, vscode, needsMarkdown, isStreaming]);

    // 如果内容为空且不在流式输出状态，不渲染任何内容
    if (!trimmedContent && !isStreaming) {
        return null;
    }

    return (
        <div className="ai-resp-block">
            <div className="output-line ai-response-content" ref={contentRef}>
                <span className="response-indicator">{getResponseDot()}</span>
                {needsMarkdown ? (
                    <div
                        className="markdown-content"
                        dangerouslySetInnerHTML={{ __html: htmlContent! }}
                    />
                ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{trimmedContent}</span>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    // streaming 状态变化时必须重渲染
    if (prev.isStreaming !== next.isStreaming) return false;
    // 非流式：比较 content
    if (!next.isStreaming) {
        return prev.content === next.content
            && prev.messageId === next.messageId;
    }
    // 流式中：由内部 state 驱动渲染，props 不变则跳过
    return prev.messageId === next.messageId;
});

AiResponseBlock.displayName = 'AiResponseBlock';

export default AiResponseBlock;
