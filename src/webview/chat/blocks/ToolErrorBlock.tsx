import React from 'react';
import { getResponseDot, CONTINUATION_SYMBOL } from '../utils/symbols';

interface ToolErrorBlockProps {
    toolName: string;
    title: string;
    content: string;
}

const ToolErrorBlock: React.FC<ToolErrorBlockProps> = React.memo(({ toolName, title, content }) => {
    const headerText = title && title !== toolName
        ? `${toolName}(${title})`
        : toolName;

    return (
        <div className="chat-block chat-block--borderless ai-resp-block tool-error-block">
            <div className="output-line ai-response-content tool-error-header">
                <span className="response-indicator tool-error-indicator">{getResponseDot()}</span>
                <span className="chat-block-title-label">{toolName}</span>
                {title && title !== toolName && (
                    <span className="chat-block-title-detail">{title}</span>
                )}
            </div>
            {content && (
                <div className="tool-error-content">{CONTINUATION_SYMBOL} {content}</div>
            )}
        </div>
    );
});

ToolErrorBlock.displayName = 'ToolErrorBlock';

export default ToolErrorBlock;
