import React from 'react';
import { getResponseDot } from '../utils/permissionUtils';

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
        <div className="tool-error-block">
            <div className="tool-error-header">
                <span className="response-indicator tool-error-indicator">{getResponseDot()}</span>
                <span className="tool-error-name">{headerText}</span>
            </div>
            {content && (
                <div className="tool-error-content">⎿ {content}</div>
            )}
        </div>
    );
});

ToolErrorBlock.displayName = 'ToolErrorBlock';

export default ToolErrorBlock;
