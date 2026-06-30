// 简化的 AiResponseBlock - 只支持基本Markdown功能
import React, { useContext, useEffect, useRef, useState, useMemo } from 'react';
import { renderMarkdownToHtml, hasMarkdownFormatting } from '../utils/markdown';
import { getResponseDot } from '../utils/symbols';
import { streamingStore } from '../utils/StreamingStore';
import { SessionContext } from '../SessionContext';
import { CopyIcon, CheckIcon } from '../components/ui/IconButton';
import '../style/markdown.css';

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
    const sessionId = useContext(SessionContext);
    const contentRef = useRef<HTMLDivElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    // 流式累积文本（ref 存最新值，state 驱动渲染）
    const streamBufferRef = useRef<string>('');
    const [streamContent, setStreamContent] = useState<string>('');
    // 点击块时切换显示底部 actions（复制等）
    const [showActions, setShowActions] = useState(false);

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
            } else if (message.type === 'imagePathResolved' && contentRef.current) {
                const { tempId, exists, src } = message;
                const element = contentRef.current.querySelector(`img[data-img-temp-id="${tempId}"]`);
                if (element) {
                    if (exists && src) {
                        element.setAttribute('src', src);
                        element.removeAttribute('data-img-temp-id');
                    } else {
                        // 本地图片不存在：退回展示原始 markdown 文本（保留 alt 与 path 信息）
                        const original = element.getAttribute('data-md-original') || '';
                        const textNode = document.createTextNode(original);
                        element.parentNode?.replaceChild(textNode, element);
                    }
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
                return;
            }
            if (target.tagName === 'IMG') {
                const imgPath = target.getAttribute('data-img-path');
                const imgUrl = target.getAttribute('data-img-url');
                if (imgPath) {
                    event.preventDefault();
                    vscode.postMessage({ type: 'openFile', filePath: imgPath, line: 1 });
                    return;
                } else if (imgUrl) {
                    event.preventDefault();
                    vscode.postMessage({ type: 'openExternal', url: imgUrl });
                    return;
                }
            }
            if (target.tagName === 'A' && target.classList.contains('md-url-link')) {
                event.preventDefault();
                const url = target.getAttribute('data-url');
                if (url) {
                    vscode.postMessage({ type: 'openExternal', url });
                }
                return;
            }
            // 用户正在选择文字时不切换 actions
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) return;
            setShowActions(prev => !prev);
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

        const unsub = streamingStore.subscribeText(sessionId, messageId, (data) => {
            if (data.contentDelta) {
                streamBufferRef.current += data.contentDelta;
                setStreamContent(streamBufferRef.current);
            }
        });
        return unsub;
    }, [isStreaming, messageId, sessionId]);

    // 决定当前要渲染的文本：流式阶段优先用累积的 streamContent；
    // 若 streamContent 为空（例如会话切换导致 streamingStore.clear 后切回，buffer 已丢），
    // 退回到 props.content 作为种子，避免只渲染出 ⏺ 而正文空白。
    const displayText = isStreaming ? (streamContent || content || '') : (content || '');
    const trimmedContent = displayText.replace(/^\n+|\n+$/g, '');
    const needsMarkdown = hasMarkdownFormatting(trimmedContent);

    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef<number | null>(null);
    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        const text = trimmedContent;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
            copyTimerRef.current = window.setTimeout(() => {
                setShowActions(false);
                setCopied(false);
            }, 1000);
        }).catch(() => { /* ignore */ });
    };
    useEffect(() => () => {
        if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    }, []);

    const htmlContent = useMemo(() => {
        if (!needsMarkdown || !trimmedContent) return null;
        // 流式阶段不传 vscode，避免对未完成内容发起文件路径验证请求
        return renderMarkdownToHtml(trimmedContent, isStreaming ? undefined : vscode);
    }, [trimmedContent, vscode, needsMarkdown, isStreaming]);

    // 如果内容为空且不在流式输出状态，不渲染任何内容
    if (!trimmedContent && !isStreaming) {
        return null;
    }

    const canShowActions = !isStreaming && !!trimmedContent && showActions;

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
            {canShowActions && (
                <div className="ai-resp-actions" ref={actionsRef}>
                    <button
                        className="ai-resp-action-btn"
                        title={copied ? '已复制' : '复制原始内容'}
                        onClick={handleCopy}
                    >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                        <span className="ai-resp-action-label">{copied ? '已复制' : '复制'}</span>
                    </button>
                </div>
            )}
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
