import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ToggleIcon } from '../components/ui/IconButton';
import { streamingStore } from '../utils/StreamingStore';

const MAX_VISIBLE_LINES = 4;

interface ThoughtBlockProps {
    content: string;  // thinking 内容
    messageId: string;
    isThinking: boolean;  // 是否正在 thinking 阶段
    vscode?: any;
}

const ThoughtBlock: React.FC<ThoughtBlockProps> = React.memo(({
    content,
    messageId,
    isThinking,
    vscode
}) => {
    // 默认折叠状态
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflow, setIsOverflow] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const streamReasoningRef = useRef('');
    const [streamReasoning, setStreamReasoning] = useState<string | undefined>(undefined);

    useEffect(() => {
        const unsub = streamingStore.subscribeText(messageId, (data) => {
            if (data.reasoningDelta !== undefined) {
                streamReasoningRef.current += data.reasoningDelta;
                setStreamReasoning(streamReasoningRef.current);
            }
        });
        return () => {
            unsub();
            streamReasoningRef.current = '';
        };
    }, [messageId]);

    // 思考结束时清除流式状态，回归 props 内容
    useEffect(() => {
        if (!isThinking) {
            streamReasoningRef.current = '';
            setStreamReasoning(undefined);
        }
    }, [isThinking]);

    const displayText = streamReasoning ?? content;

    // 检测内容是否溢出（视觉行数超过 4 行）
    useEffect(() => {
        const el = contentRef.current;
        if (el) {
            setIsOverflow(el.scrollHeight > el.clientHeight);
        }
    }, [displayText, isExpanded]);

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleViewAll = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (vscode && displayText) {
            vscode.postMessage({
                type: 'openBashOutput',
                content: displayText,
                command: 'Thought',
                toolId: messageId
            });
        }
    }, [vscode, displayText, messageId]);

    return (
        <div className="thought-block">
            <div
                className="thought-block-header"
                onClick={handleToggle}
            >
                <div className="thought-block-title">
                    <span className="thought-title-text">
                        {isThinking ? 'Thinking...' : 'Thought'}
                    </span>
                    <div className="thought-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && displayText && (
                <div className="thought-block-content">
                    <div
                        ref={contentRef}
                        className="thought-content thought-content-clamped"
                    >
                        {displayText}
                    </div>
                    {isOverflow && (
                        <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...查看全部</div>
                    )}
                </div>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.isThinking === nextProps.isThinking &&
           prevProps.content === nextProps.content &&
           prevProps.messageId === nextProps.messageId;
});

ThoughtBlock.displayName = 'ThoughtBlock';

export default ThoughtBlock;