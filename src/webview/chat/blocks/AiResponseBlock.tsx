// 简化的 AiResponseBlock - 只支持基本Markdown功能
import React, { useEffect, useRef } from 'react';
import { renderMarkdownToHtml, hasMarkdownFormatting } from '../utils/markdown';
import { getResponseDot } from '../utils/permissionUtils';
import '../utils/markdown.css';

interface AiResponseBlockProps {
    content: string;
    isStreaming?: boolean;
    vscode?: any;
}

const AiResponseBlock: React.FC<AiResponseBlockProps> = ({
    content,
    isStreaming = false,
    vscode
}) => {
    const contentRef = useRef<HTMLDivElement>(null);

    // 处理文件路径验证结果
    useEffect(() => {
        if (!contentRef.current || !vscode) return;

        const handleFilePathVerification = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'filePathVerified' && contentRef.current) {
                const { tempId, exists, filePath, lineInfo } = message;
                const element = contentRef.current.querySelector(`[data-temp-id="${tempId}"]`);

                if (element) {
                    if (exists) {
                        // 文件存在，添加文件路径样式和点击功能
                        element.classList.add('file-path-code');
                        element.setAttribute('data-file-path', filePath);
                        if (lineInfo) {
                            element.setAttribute('data-line-info', lineInfo);
                        }
                    }
                    // 移除临时 ID
                    element.removeAttribute('data-temp-id');
                }
            }
        };

        window.addEventListener('message', handleFilePathVerification);

        return () => {
            window.removeEventListener('message', handleFilePathVerification);
        };
    }, [vscode, content]);

    // 处理文件路径内联代码的点击事件
    useEffect(() => {
        if (!contentRef.current || !vscode) return;

        const handleFilePathClick = (event: Event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('file-path-code')) {
                event.preventDefault();

                const filePath = target.getAttribute('data-file-path');
                const lineInfo = target.getAttribute('data-line-info');

                if (filePath) {
                    let startLine = 1;
                    let endLine: number | undefined;

                    // 解析行号信息
                    if (lineInfo) {
                        if (lineInfo.includes('~') || lineInfo.includes('-')) {
                            // 范围格式 "1~9" 或 "1-9"，设置选区
                            const separator = lineInfo.includes('~') ? '~' : '-';
                            const parts = lineInfo.split(separator);
                            startLine = parseInt(parts[0]);
                            endLine = parseInt(parts[1]);
                            if (isNaN(startLine)) startLine = 1;
                            if (isNaN(endLine)) endLine = undefined;
                        } else {
                            // 单行格式 "11"
                            const parsedLine = parseInt(lineInfo);
                            startLine = isNaN(parsedLine) ? 1 : parsedLine;
                        }
                    }

                    // 发送跳转请求给 VS Code
                    vscode.postMessage({
                        type: 'openFile',
                        filePath: filePath,
                        line: startLine,
                        endLine: endLine  // 如果有结束行，后端会设置选区
                    });
                }
            }
        };

        // 添加点击事件监听器
        contentRef.current.addEventListener('click', handleFilePathClick);

        // 清理函数
        return () => {
            if (contentRef.current) {
                contentRef.current.removeEventListener('click', handleFilePathClick);
            }
        };
    }, [vscode, content]);

    // 如果内容为空且不在流式输出状态，不渲染任何内容
    if (!content && !isStreaming) {
        return null;
    }

    // 去除首尾换行符
    const trimmedContent = content.replace(/^\n+|\n+$/g, '');

    // 检查是否需要Markdown渲染
    const needsMarkdown = hasMarkdownFormatting(trimmedContent);

    return (
        <div className="ai-resp-block">
            <div className="output-line ai-response-content" ref={contentRef}>
                <span className="response-indicator">{getResponseDot()}</span>
                {needsMarkdown ? (
                    <div
                        className="markdown-content"
                        dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(trimmedContent, vscode) }}
                    />
                ) : (
                    <span>{trimmedContent}</span>
                )}
                {/* {isStreaming && <span className="streaming-cursor">▋</span>} */}
            </div>
        </div>
    );
};

export default AiResponseBlock;