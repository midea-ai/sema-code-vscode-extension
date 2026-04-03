import React, { useState, useEffect, useRef } from 'react';
import { ToggleIcon } from '../components/ui/IconButton';
import { streamingStore } from '../utils/StreamingStore';

interface ThoughtBlockProps {
    content: string;  // thinking 内容
    messageId: string;
    isThinking: boolean;  // 是否正在 thinking 阶段
}

const ThoughtBlock: React.FC<ThoughtBlockProps> = React.memo(({
    content,
    messageId,
    isThinking
}) => {
    // 默认折叠状态
    const [isExpanded, setIsExpanded] = useState(false);
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

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

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
            {isExpanded && (streamReasoning ?? content) && (
                <div className="thought-block-content">
                    <div className="thought-content">
                        {streamReasoning ?? content}
                    </div>
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