import React, { useState, useMemo, useCallback } from 'react';
import { ToggleIcon } from '../../components/ui/IconButton';
import { Message } from '../../types';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';
import {
    TOOL_NAME_RUN_SHELL,
    TOOL_NAME_SEARCH_CONTENT,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_VIEW_FILE,
} from '../../../../utils/tool';
import { getToolName, getToolTitle, isExploratoryShellCommand, isFindShellCommand, isLsShellCommand, isPwdShellCommand } from '../../utils/groupMessages';
import { formatSearchTitle } from './utils';
import { hasTextSelection } from '../../utils/selection';

interface GroupedToolBlockProps {
    messages: Message[];
    vscode: any;
}

const formatCount = (count: number, singular: string, plural: string): string => {
    return `${count} ${count === 1 ? singular : plural}`;
};

const MAX_VISIBLE_LINES = 2;

interface ReadSummaryFile {
    display: string;
    filePath: string;
    line: number;
    title: string;
}

interface ReadSummaryItem {
    id: string;
    messages: Message[];
    files: ReadSummaryFile[];
}

type ExpandedItem =
    | { kind: 'read-summary'; item: ReadSummaryItem }
    | { kind: 'message'; message: Message };

const getReadFileInfo = (message: Message): ReadSummaryFile | null => {
    const title = getToolTitle(message);
    if (!title) {
        return null;
    }

    let filePath = title;
    let offset: number | null = null;
    let lineRange = '';

    const rangeMatch = title.match(/^(.+):(\d+)-(\d+)$/);
    if (rangeMatch) {
        filePath = rangeMatch[1];
        const startLine = parseInt(rangeMatch[2], 10);
        const endLine = parseInt(rangeMatch[3], 10);
        offset = startLine;
        lineRange = `:${startLine}-${endLine}`;
    } else {
        const lineMatch = title.match(/^(.+):(\d+)$/);
        if (lineMatch) {
            filePath = lineMatch[1];
            const startLine = parseInt(lineMatch[2], 10);
            offset = startLine;
            lineRange = `:${startLine}`;
        }
    }

    const displayFileName = filePath.split(/[/\\]/).pop() || filePath;
    return {
        display: `${displayFileName}${lineRange}`,
        filePath,
        line: offset !== null ? offset + 1 : 1,
        title,
    };
};

export const getGroupTitle = (messages: Message[]): string => {
    return `Explored ${formatCount(messages.length, 'tool', 'tools')}`;
};

export const getReadSummaryItems = (messages: Message[]): ReadSummaryItem[] => {
    const items: ReadSummaryItem[] = [];
    let run: Message[] = [];

    const flushRun = () => {
        if (run.length > 0) {
            const files = run
                .map(getReadFileInfo)
                .filter((file): file is ReadSummaryFile => file !== null);

            if (files.length === run.length) {
                items.push({
                    id: `read-summary-${run[0].id}-${run[run.length - 1].id}`,
                    messages: run,
                    files,
                });
            }
        }
        run = [];
    };

    for (const message of messages) {
        if (getToolName(message) === TOOL_NAME_VIEW_FILE) {
            run.push(message);
            continue;
        }

        flushRun();
    }

    flushRun();
    return items;
};

const isSearchMessage = (message: Message): boolean => {
    const toolName = getToolName(message);
    return toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT;
};

const splitCommand = (command: string): string[] => {
    const matches = command.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
    return matches.map(token => {
        if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
            return token.slice(1, -1);
        }
        return token;
    });
};

const parseLsTarget = (lsCommand: string): string => {
    const tokens = splitCommand(lsCommand.trim());
    if (tokens.length === 0 || tokens[0] !== 'ls') {
        return '';
    }

    let afterOptions = false;
    for (const token of tokens.slice(1)) {
        if (!afterOptions && token === '--') {
            afterOptions = true;
            continue;
        }
        if (!afterOptions && token.startsWith('-') && token !== '-') {
            continue;
        }
        return token;
    }

    return '';
};

const parseCdTarget = (cdCommand: string): string => {
    const tokens = splitCommand(cdCommand.trim());
    if (tokens.length === 0 || tokens[0] !== 'cd') {
        return '';
    }

    for (const token of tokens.slice(1)) {
        if (token.startsWith('-') && token !== '-') {
            continue;
        }
        return token;
    }

    return '';
};

const joinPaths = (base: string, target: string): string => {
    if (!target) {
        return base || '.';
    }
    if (!base || target.startsWith('/') || target.startsWith('~')) {
        return target;
    }
    return `${base.replace(/\/+$/, '')}/${target}`;
};

export const getLsListTarget = (command: string): string => {
    const segments = command.trim().split(/\s+&&\s+/).map(segment => segment.trim()).filter(Boolean);
    let cwd = '';
    let lsTarget = '';

    for (const segment of segments) {
        if (/^cd(?:\s|$)/.test(segment)) {
            cwd = parseCdTarget(segment) || cwd;
        } else if (/^ls(?:\s|$)/.test(segment)) {
            lsTarget = parseLsTarget(segment);
        }
    }

    return joinPaths(cwd, lsTarget);
};

export const getFindTarget = (command: string): string => {
    const tokens = splitCommand(command.trim());
    if (tokens.length === 0 || tokens[0] !== 'find') {
        return '.';
    }

    for (const token of tokens.slice(1)) {
        if (token.startsWith('-') || token === '(' || token === '!' || token === 'not') {
            return '.';
        }
        return token || '.';
    }

    return '.';
};

export const getExpandedItems = (messages: Message[]): ExpandedItem[] => {
    const items: ExpandedItem[] = [];
    let readRun: Message[] = [];

    const flushReadRun = () => {
        if (readRun.length === 0) {
            return;
        }

        const summary = getReadSummaryItems(readRun)[0];
        if (summary) {
            items.push({ kind: 'read-summary', item: summary });
        } else {
            items.push(...readRun.map(message => ({ kind: 'message' as const, message })));
        }

        readRun = [];
    };

    for (const message of messages) {
        if (getToolName(message) === TOOL_NAME_VIEW_FILE) {
            readRun.push(message);
            continue;
        }

        flushReadRun();
        items.push({ kind: 'message', message });
    }

    flushReadRun();
    return items;
};

const CollapsibleResultRow: React.FC<{
    label: string;
    title: string;
    tooltip: string;
    content: unknown;
    summary?: string;
    toolId?: string;
    vscode?: any;
}> = ({ label, title, tooltip, content, summary, toolId = '', vscode }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const command = title ? `${label} ${title}` : label;
    const formattedContent = [
        summary ? `${CONTINUATION_SYMBOL} ${summary}` : '',
        typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content ?? ''),
    ].filter(Boolean).join('\n');
    const contentLines = formattedContent.split('\n').filter(line => line.trim());
    const omittedCount = Math.max(contentLines.length - MAX_VISIBLE_LINES, 0);
    const visibleLines = omittedCount > 0 ? contentLines.slice(-MAX_VISIBLE_LINES) : contentLines;

    const handleViewAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        vscode?.postMessage({
            type: 'openBashOutput',
            content: contentLines.join('\n'),
            command,
            toolId,
        });
    };

    return (
        <div className="chat-block chat-block--borderless">
            <div className="chat-block-header grouped-tool-header" onClick={() => setIsExpanded(prev => !prev)}>
                <div className="chat-block-title">
                    <span className="chat-block-title-label">{label}</span>
                    <span className="grouped-tool-muted-text" title={tooltip}>{title}</span>
                    <div className="grouped-tool-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="chat-block-content grouped-result-content">
                    {omittedCount > 0 && (
                        <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>{`...\u7701\u7565\u4e86 ${omittedCount} \u884c`}</div>
                    )}
                    {visibleLines.join('\n')}
                </div>
            )}
        </div>
    );
};

const SearchItemBlock: React.FC<{ message: Message; vscode: any }> = ({ message, vscode }) => (
    <CollapsibleResultRow
        label="Search"
        title={formatSearchTitle(getToolTitle(message))}
        tooltip={formatSearchTitle(getToolTitle(message))}
        content={message.content?.content}
        summary={message.content?.summary}
        toolId={message.content?.toolId}
        vscode={vscode}
    />
);

export const CommandItemBlock: React.FC<{
    message: Message;
    vscode?: any;
}> = ({ message, vscode }) => {
    const command = getToolTitle(message).trim();
    const isFind = isFindShellCommand(message);
    const isPwd = isPwdShellCommand(message);
    const isExplore = isExploratoryShellCommand(message);

    return (
        <CollapsibleResultRow
            label={isExplore ? 'Inspect' : isPwd ? 'Path' : isFind ? 'Find' : 'List'}
            title={isExplore ? command : isPwd ? 'current directory' : isFind ? getFindTarget(command) : getLsListTarget(command)}
            tooltip={command}
            content={message.content?.content}
            summary={message.content?.summary}
            toolId={message.content?.toolId}
            vscode={vscode}
        />
    );
};

const renderExpandedItem = (
    item: ExpandedItem,
    handleFileOpen: (filePath: string, line: number) => void,
    vscode: any,
): React.ReactNode => {
    if (item.kind === 'message') {
        if (isSearchMessage(item.message)) {
            return <SearchItemBlock key={item.message.id} message={item.message} vscode={vscode} />;
        }
        if (
            item.message.toolName === TOOL_NAME_RUN_SHELL
            && (
                isLsShellCommand(item.message)
                || isFindShellCommand(item.message)
                || isPwdShellCommand(item.message)
                || isExploratoryShellCommand(item.message)
            )
        ) {
            return <CommandItemBlock key={item.message.id} message={item.message} vscode={vscode} />;
        }
        return null;
    }

    return (
        <div className="grouped-read-summary" key={item.item.id}>
            <span className="chat-block-title-label">Read</span>
            <span className="grouped-read-files">
                {item.item.files.map((file, index) => (
                    <React.Fragment key={file.title}>
                        {index > 0 && <span className="grouped-tool-muted-text">,&#160;</span>}
                        <button
                            className="grouped-tool-muted-text grouped-read-file"
                            onClick={() => handleFileOpen(file.filePath, file.line)}
                            title={file.title}
                        >
                            {file.display}
                        </button>
                    </React.Fragment>
                ))}
            </span>
        </div>
    );
};

const GroupedToolBlock: React.FC<GroupedToolBlockProps> = ({ messages, vscode }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const count = useMemo(() => formatCount(messages.length, 'tool', 'tools'), [messages]);

    const expandedItems = useMemo(() => {
        if (!isExpanded) return [];
        return getExpandedItems(messages);
    }, [messages, isExpanded]);

    const handleFileOpen = useCallback((filePath: string, line: number) => {
        if (hasTextSelection()) {
            return;
        }
        vscode.postMessage({
            type: 'openFile',
            filePath,
            line,
        });
    }, [vscode]);

    const handleToggle = () => {
        setIsExpanded(prev => !prev);
    };

    return (
        <div className="chat-block chat-block--borderless grouped-tool-block">
            <div className="chat-block-header grouped-tool-header" onClick={handleToggle}>
                <div className="chat-block-title">
                    <span className="chat-block-title-label"><strong>Explored</strong> <span className="grouped-tool-muted-text">{count}</span></span>
                    <div className="grouped-tool-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="chat-block-content grouped-tool-content">
                    {expandedItems.map(item => renderExpandedItem(item, handleFileOpen, vscode))}
                </div>
            )}
        </div>
    );
};

export default React.memo(GroupedToolBlock, (prev, next) => {
    if (prev.messages.length !== next.messages.length) return false;
    return prev.messages.every((msg, i) => msg === next.messages[i]);
});
