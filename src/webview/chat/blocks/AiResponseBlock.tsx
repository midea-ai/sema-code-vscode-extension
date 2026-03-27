// 简化的 AiResponseBlock - 只支持基本Markdown功能
import React, { useEffect, useRef, useMemo } from 'react';
import { renderMarkdownToHtml, hasMarkdownFormatting } from '../utils/markdown';
import { getResponseDot } from '../utils/permissionUtils';
import '../utils/markdown.css';

interface AiResponseBlockProps {
    content: string;
    isStreaming?: boolean;
    vscode?: any;
}

const AiResponseBlock: React.FC<AiResponseBlockProps> = React.memo(({
    content,
    isStreaming = false,
    vscode
}) => {
    const contentRef = useRef<HTMLDivElement>(null);

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

    const trimmedContent = (content || '').replace(/^\n+|\n+$/g, '');
    const needsMarkdown = hasMarkdownFormatting(trimmedContent);

    // 缓存 markdown 渲染结果，避免重复计算
    const htmlContent = useMemo(() => {
        if (!needsMarkdown || !trimmedContent) return null;
        return renderMarkdownToHtml(trimmedContent, vscode);
    }, [trimmedContent, vscode, needsMarkdown]);

    // 如果内容为空且不在流式输出状态，不渲染任何内容
    if (!content && !isStreaming) {
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
                    <span>{trimmedContent}</span>
                )}
                {/* {isStreaming && <span className="streaming-cursor">▋</span>} */}
            </div>
        </div>
    );
}, (prev, next) => {
    if (prev.isStreaming === false && next.isStreaming === false) {
        return prev.content === next.content;
    }
    return prev.content === next.content && prev.isStreaming === next.isStreaming;
});

AiResponseBlock.displayName = 'AiResponseBlock';

export default AiResponseBlock;
