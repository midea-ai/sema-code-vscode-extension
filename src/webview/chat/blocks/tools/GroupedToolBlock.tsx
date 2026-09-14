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
import { SHELL_SEGMENT_SEPARATOR, getMcpServerName, getShellExploreKind, getToolName, getToolTitle, isShellRunMessage } from '../../utils/groupMessages';
import { formatSearchTitle } from './utils';
import { hasTextSelection } from '../../utils/selection';
import PubBlock from './PubBlock';
import BashBlock from './BashBlock';
import { useT } from '../../../common/i18n/react';

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
    const mcpServerName = messages.length > 0 ? getMcpServerName(messages[0]) : null;
    if (mcpServerName) {
        return `Called ${mcpServerName} ${formatCount(messages.length, 'time', 'times')}`;
    }
    if (messages.length > 0 && isShellRunMessage(messages[0])) {
        return `Ran ${formatCount(messages.length, 'command', 'commands')}`;
    }
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

/** 去掉管道及其右侧，只保留主命令部分 */
const stripPipe = (command: string): string => command.split(/\s*\|\s*/)[0] || '';

/** ls/tree 中带独立参数值的选项（如 tree -L 2、ls -I pattern），解析目标路径时要连同下一个 token 一起跳过 */
const LS_OPTIONS_WITH_VALUE = new Set(['-L', '-P', '-I', '-o', '-w', '-T', '--filelimit', '--charset']);

const parseLsTarget = (lsCommand: string): string => {
    const tokens = splitCommand(stripPipe(lsCommand.trim()));
    if (tokens.length === 0 || (tokens[0] !== 'ls' && tokens[0] !== 'tree')) {
        return '';
    }

    let afterOptions = false;
    const rest = tokens.slice(1);
    for (let i = 0; i < rest.length; i++) {
        const token = rest[i];
        if (!afterOptions && token === '--') {
            afterOptions = true;
            continue;
        }
        if (!afterOptions && token.startsWith('-') && token !== '-') {
            if (LS_OPTIONS_WITH_VALUE.has(token)) {
                i += 1;
            }
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
    const segments = command.trim().split(SHELL_SEGMENT_SEPARATOR).map(segment => segment.trim()).filter(Boolean);
    let cwd = '';
    let lsTarget = '';

    for (const segment of segments) {
        if (/^cd(?:\s|$)/.test(segment)) {
            cwd = parseCdTarget(segment) || cwd;
        } else if (/^(?:ls|tree)(?:\s|$)/.test(segment)) {
            lsTarget = parseLsTarget(segment);
        }
    }

    return joinPaths(cwd, lsTarget);
};

export const getFindTarget = (command: string): string => {
    const segments = command.trim().split(SHELL_SEGMENT_SEPARATOR).map(segment => segment.trim()).filter(Boolean);
    const findSegment = segments.find(segment => /^find(?:\s|$)/.test(segment)) || '';
    const tokens = splitCommand(stripPipe(findSegment));
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
    const t = useT();
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
                        <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>{t('chat.omittedLines', { count: omittedCount })}</div>
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
    const kind = getShellExploreKind(message);
    const isFind = kind === 'find';
    const isPwd = kind === 'path';
    const isExplore = kind === 'explore';

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
        if (item.message.toolName === TOOL_NAME_RUN_SHELL && getShellExploreKind(item.message) !== null) {
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

/** 同一 MCP 服务的连续调用组：标题为 Called <服务名> N times，展开后逐条复用 PubBlock */
const GroupedMcpToolBlock: React.FC<GroupedToolBlockProps & { serverName: string }> = ({ messages, serverName, vscode }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const count = useMemo(() => formatCount(messages.length, 'time', 'times'), [messages]);

    return (
        <div className="chat-block chat-block--borderless grouped-tool-block">
            <div className="chat-block-header grouped-tool-header grouped-mcp-header" onClick={() => setIsExpanded(prev => !prev)}>
                <div className="chat-block-title">
                    <span className="chat-block-title-label">
                        <span className="grouped-tool-muted-text">Called</span> {serverName} <span className="grouped-tool-muted-text">{count}</span>
                    </span>
                    <div className="grouped-tool-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="chat-block-content grouped-tool-content">
                    {messages.map(message => (
                        <PubBlock key={message.id} content={message.content} messageId={message.id} vscode={vscode} />
                    ))}
                </div>
            )}
        </div>
    );
};

/** 连续终端命令组：标题为 Ran N commands，展开后逐条复用 BashBlock */
const GroupedShellToolBlock: React.FC<GroupedToolBlockProps> = ({ messages, vscode }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const count = useMemo(() => formatCount(messages.length, 'command', 'commands'), [messages]);

    return (
        <div className="chat-block chat-block--borderless grouped-tool-block">
            <div className="chat-block-header grouped-tool-header" onClick={() => setIsExpanded(prev => !prev)}>
                <div className="chat-block-title">
                    <span className="chat-block-title-label"><strong>Ran</strong> <span className="grouped-tool-muted-text">{count}</span></span>
                    <div className="grouped-tool-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                </div>
            </div>
            {isExpanded && (
                <div className="chat-block-content grouped-tool-content">
                    {messages.map(message => (
                        <BashBlock key={message.id} content={message.content} messageId={message.id} vscode={vscode} />
                    ))}
                </div>
            )}
        </div>
    );
};

const GroupedExploreToolBlock: React.FC<GroupedToolBlockProps> = ({ messages, vscode }) => {
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

/** 按组内首条消息判定分组类型：同一 MCP 服务的连续调用走 MCP 组，连续终端命令走终端组，其余走探索组 */
const GroupedToolBlock: React.FC<GroupedToolBlockProps> = ({ messages, vscode }) => {
    const mcpServerName = messages.length > 0 ? getMcpServerName(messages[0]) : null;
    if (mcpServerName) {
        return <GroupedMcpToolBlock messages={messages} serverName={mcpServerName} vscode={vscode} />;
    }
    if (messages.length > 0 && isShellRunMessage(messages[0])) {
        return <GroupedShellToolBlock messages={messages} vscode={vscode} />;
    }
    return <GroupedExploreToolBlock messages={messages} vscode={vscode} />;
};

export default React.memo(GroupedToolBlock, (prev, next) => {
    if (prev.messages.length !== next.messages.length) return false;
    return prev.messages.every((msg, i) => msg === next.messages[i]);
});
