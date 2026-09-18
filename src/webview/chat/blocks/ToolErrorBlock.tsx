import React, { useState } from 'react';
import { ToggleIcon } from '../components/ui/IconButton';
import { getResponseDot } from '../utils/symbols';
import { useT } from '../../common/i18n/react';

const MAX_VISIBLE_LINES = 2;

interface ToolErrorBlockProps {
    toolName: string;
    title: string;
    content: string;
    vscode?: any;
}

/** 工具执行错误：默认折叠成一行（红点 + 工具名 + title），展开后与 PubBlock 同样只留末尾两行，其余点击到输出面板查看 */
const ToolErrorBlock: React.FC<ToolErrorBlockProps> = React.memo(({ toolName, title, content, vscode }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);

    const showTitle = !!title && title !== toolName;
    const contentLines = (content || '').split('\n').filter(line => line.trim());
    const omittedCount = Math.max(contentLines.length - MAX_VISIBLE_LINES, 0);
    const visibleLines = omittedCount > 0 ? contentLines.slice(-MAX_VISIBLE_LINES) : contentLines;

    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        vscode?.postMessage({
            type: 'openBashOutput',
            content: contentLines.join('\n'),
            command: showTitle ? `${toolName} ${title}` : toolName,
            toolId: '',
        });
    };

    return (
        <div className="chat-block chat-block--borderless pub-block tool-error-block">
            <div className="chat-block-header pub-block-header tool-error-header" onClick={() => setIsExpanded(prev => !prev)}>
                <div className="chat-block-title pub-block-title">
                    <span className="response-indicator tool-error-indicator">{getResponseDot()}</span>
                    <span className="chat-block-title-label">{toolName}</span>
                    {showTitle && <span className="chat-block-title-detail">{title}</span>}
                    <div className="pub-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && contentLines.length > 0 && (
                <div className="chat-block-content pub-block-content">
                    {omittedCount > 0 && (
                        <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>{t('chat.omittedLines', { count: omittedCount })}</div>
                    )}
                    {visibleLines.map((line, i) => (
                        <div key={i} className="bash-output-line">{line}</div>
                    ))}
                </div>
            )}
        </div>
    );
});

ToolErrorBlock.displayName = 'ToolErrorBlock';

export default ToolErrorBlock;
