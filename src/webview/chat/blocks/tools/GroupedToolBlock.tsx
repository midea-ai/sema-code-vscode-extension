import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BrainIcon, ClockIcon, FileTextIcon, GlobeIcon, PlugIcon, TerminalIcon, ToggleIcon, WrenchIcon, XIcon } from '../../components/ui/IconButton';
import { FileChange, Message } from '../../types';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';
import { countDiffChanges } from '../../utils/diffParser';
import {
    TOOL_NAME_CREATE_CRON,
    TOOL_NAME_DEL_CRON,
    TOOL_NAME_EDIT_NOTEBOOK,
    TOOL_NAME_FETCH_URL,
    TOOL_NAME_LIST_CRONS,
    TOOL_NAME_PATCH_FILE,
    TOOL_NAME_PEEK_BG_JOB,
    TOOL_NAME_PICK_OPTION,
    TOOL_NAME_RUN_SHELL,
    TOOL_NAME_SEARCH_CONTENT,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_SKILL,
    TOOL_NAME_STOP_BG_JOB,
    TOOL_NAME_SUB_AGENT,
    TOOL_NAME_VIEW_FILE,
    TOOL_NAME_WRITE_FILE,
} from '../../../../utils/tool';
import {
    CRON_TOOL_NAMES,
    FETCH_TOOL_NAMES,
    JOB_TOOL_NAMES,
    getMcpServerName,
    getToolName,
    getToolTitle,
    isMemoryEditMessage,
    isShellRunMessage,
    isToolErrorMessage,
} from '../../utils/groupMessages';
import { isMcpToolType, parseMcpToolName } from '../../utils/permissionUtils';
import { langMap } from '../../utils/fileLangTypeMap';
import { hasTextSelection } from '../../utils/selection';
import { getSearchRowMeta } from './utils';
import { processTerminalOutput } from './BashBlock';
import ToolRowHeader, { SearchRowHeader } from './ToolRowHeader';
import CollapsibleDiff from '../../components/ui/CollapsibleDiff';
import CollapsibleContent from '../../components/ui/CollapsibleContent';
import { useT } from '../../../common/i18n/react';

type Translate = ReturnType<typeof useT>;

interface GroupedToolBlockProps {
    messages: Message[];
    vscode: any;
    /** 组内 memory 写入折叠时 EditBlock 不挂载，由组块代为上报文件变更，与单条渲染时行为一致 */
    onFileChange?: (change: FileChange) => void;
}

/** 输出正文只保留末尾这么多字符，避免超长输出拖慢渲染 */
const MAX_OUTPUT_CHARS = 20000;

/** 完整文本超过该长度时，即使与行目标相同也在展开体里再显示一遍（行目标是单行省略的） */
const FULL_TEXT_REPEAT_THRESHOLD = 60;

// ==================== Read 合并行 ====================

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

/** 成功的 Read 消息；Read 的执行报错 content.toolName 也是 view_file，需排除，不并入合并行 */
const isReadMessage = (message: Message): boolean => {
    return !isToolErrorMessage(message) && getToolName(message) === TOOL_NAME_VIEW_FILE;
};

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
        if (isReadMessage(message)) {
            run.push(message);
            continue;
        }

        flushRun();
    }

    flushRun();
    return items;
};

/** 组内展开项：连续 Read 合并为一行，其余（含执行报错）逐条 */
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
        if (isReadMessage(message)) {
            readRun.push(message);
            continue;
        }

        flushReadRun();
        items.push({ kind: 'message', message });
    }

    flushReadRun();
    return items;
};

// ==================== 类别与组头 ====================

type GroupCategoryKind = 'explore' | 'ran' | 'mcp' | 'fetch' | 'job' | 'cron' | 'memory';

interface GroupCategory {
    key: string;
    kind: GroupCategoryKind;
    /** 仅 mcp：服务名 */
    server?: string;
    count: number;
}

/** 非 MCP 消息的类别：memory 写入、非只读命令、抓网页、后台任务、定时任务，其余（Read/Search/只读命令）为探索 */
const getCategoryKind = (message: Message): GroupCategoryKind => {
    if (isMemoryEditMessage(message)) {
        return 'memory';
    }
    if (isShellRunMessage(message)) {
        return 'ran';
    }
    const toolName = getToolName(message);
    if (FETCH_TOOL_NAMES.has(toolName)) {
        return 'fetch';
    }
    if (JOB_TOOL_NAMES.has(toolName)) {
        return 'job';
    }
    if (CRON_TOOL_NAMES.has(toolName)) {
        return 'cron';
    }
    return 'explore';
};

/** 组内消息按类别计数，类别按首次出现顺序排列；MCP 按服务名分别计数；执行报错不计入 */
export const getGroupCategories = (messages: Message[]): GroupCategory[] => {
    const categories: GroupCategory[] = [];
    const byKey = new Map<string, GroupCategory>();

    for (const message of messages) {
        if (isToolErrorMessage(message)) {
            continue;
        }
        const server = getMcpServerName(message);
        const kind = server ? 'mcp' : getCategoryKind(message);
        const key = server ? `mcp:${server}` : kind;

        let category = byKey.get(key);
        if (!category) {
            category = { key, kind, server: server || undefined, count: 0 };
            byKey.set(key, category);
            categories.push(category);
        }
        category.count += 1;
    }

    return categories;
};

const formatCount = (count: number, singular: string, plural: string): string => {
    return `${count} ${count === 1 ? singular : plural}`;
};

/** 类别文案（组头固定英文）：动词 + 主语（仅 MCP 服务名）+ 计数，如 Called figma 3 times */
const getCategoryText = (category: GroupCategory): { verb: string; subject: string; count: string } => {
    switch (category.kind) {
        case 'mcp':
            return { verb: 'Called', subject: category.server || '', count: formatCount(category.count, 'time', 'times') };
        case 'ran':
            return { verb: 'Ran', subject: '', count: formatCount(category.count, 'command', 'commands') };
        case 'fetch':
            return { verb: 'Fetched', subject: '', count: formatCount(category.count, 'url', 'urls') };
        case 'job':
            return { verb: 'Managed', subject: '', count: formatCount(category.count, 'job', 'jobs') };
        case 'cron':
            return { verb: 'Managed', subject: '', count: formatCount(category.count, 'cron', 'crons') };
        case 'memory':
            return { verb: 'Wrote', subject: '', count: formatCount(category.count, 'memory', 'memories') };
        default:
            return { verb: 'Explored', subject: '', count: formatCount(category.count, 'tool', 'tools') };
    }
};

/** 组头标题：各类别按首次出现顺序拼接，首个动词大写，其余小写，如 Explored 6 tools, ran 4 commands */
export const getGroupTitle = (messages: Message[]): string => {
    return getGroupCategories(messages).map((category, index) => {
        const { verb, subject, count } = getCategoryText(category);
        return [index === 0 ? verb : verb.toLowerCase(), subject, count].filter(Boolean).join(' ');
    }).join(', ');
};

/** 组头（无图标）：首个动词加粗，计数与后续类别弱化色，箭头常显 */
const GroupHeader: React.FC<{
    titleText: string;
    isExpanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}> = ({ titleText, isExpanded, onToggle, children }) => (
    <div className="chat-block-header grouped-tool-header" onClick={onToggle}>
        <div className="chat-block-title">
            <span className="chat-block-title-label" title={titleText}>{children}</span>
            <div className="grouped-tool-toggle-btn">
                <ToggleIcon isExpanded={isExpanded} />
            </div>
        </div>
    </div>
);

// ==================== 结果行 ====================

/** 结果文本：字符串按终端 \r 规则处理并去空行，对象转 JSON；有 summary 时作为首行；只保留末尾 MAX_OUTPUT_CHARS */
const formatResultOutput = (content: unknown, summary?: string): string => {
    const body = typeof content === 'string'
        ? processTerminalOutput(content).filter(line => line.trim()).join('\n')
        : content == null ? '' : JSON.stringify(content, null, 2);
    const text = [summary ? `${CONTINUATION_SYMBOL} ${summary}` : '', body].filter(Boolean).join('\n');
    return text.length > MAX_OUTPUT_CHARS ? text.slice(-MAX_OUTPUT_CHARS) : text;
};

/**
 * 组内统一结果行：行头 [图标 动词 目标 ›]，点开后先显示完整文本（命令 / 参数；与行目标相同且不长时不重复），
 * 下方输出框复用 CollapsibleContent：过长时底部渐隐，左下角展开/收起；无输出显示占位。
 */
const GroupedResultRow: React.FC<{
    icon: React.ReactNode;
    verb: string;
    target?: string;
    /** 展开后显示的完整文本 */
    full?: string;
    content: unknown;
    summary?: string;
    /** 行头附加类名（执行失败行标红） */
    className?: string;
}> = ({ icon, verb, target, full, content, summary, className }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);
    const output = useMemo(() => formatResultOutput(content, summary), [content, summary]);
    const showFull = !!full && (full !== target || full.length > FULL_TEXT_REPEAT_THRESHOLD);

    return (
        <div className="chat-block chat-block--borderless">
            <ToolRowHeader
                icon={icon}
                verb={verb}
                target={target}
                targetTitle={full || target}
                expandable
                isExpanded={isExpanded}
                onClick={() => setIsExpanded(prev => !prev)}
                className={className}
            />
            {isExpanded && (
                <div className="chat-block-content grouped-result-body">
                    {showFull && <div className="grouped-result-full">{full}</div>}
                    {output ? (
                        <div className="grouped-result-output">
                            <CollapsibleContent>
                                <pre>{output}</pre>
                            </CollapsibleContent>
                        </div>
                    ) : (
                        <div className="grouped-result-empty">{t('tool.noOutput')}</div>
                    )}
                </div>
            )}
        </div>
    );
};

/** 执行失败行动词：按工具种类取「xx失败」，MCP 与未知工具为「调用 {name} 失败」 */
const getToolErrorVerb = (toolName: string, t: Translate): string => {
    if (isMcpToolType(toolName)) {
        return t('tool.failed.call', { name: parseMcpToolName(toolName).mcpName || toolName });
    }
    switch (toolName) {
        case TOOL_NAME_RUN_SHELL:
            return t('tool.failed.shell');
        case TOOL_NAME_WRITE_FILE:
        case TOOL_NAME_PATCH_FILE:
        case TOOL_NAME_EDIT_NOTEBOOK:
            return t('tool.failed.edit');
        case TOOL_NAME_VIEW_FILE:
            return t('tool.failed.read');
        case TOOL_NAME_SEARCH_FILES:
        case TOOL_NAME_SEARCH_CONTENT:
            return t('tool.failed.search');
        case TOOL_NAME_FETCH_URL:
            return t('tool.failed.fetch');
        case TOOL_NAME_SUB_AGENT:
            return t('tool.failed.agent');
        case TOOL_NAME_SKILL:
            return t('tool.failed.skill');
        case TOOL_NAME_PICK_OPTION:
            return t('tool.failed.ask');
        case TOOL_NAME_PEEK_BG_JOB:
            return t('tool.failed.jobPeek');
        case TOOL_NAME_STOP_BG_JOB:
            return t('tool.failed.jobStop');
        case TOOL_NAME_CREATE_CRON:
        case TOOL_NAME_DEL_CRON:
        case TOOL_NAME_LIST_CRONS:
            return t('tool.failed.cron');
        default:
            return t('tool.failed.call', { name: toolName || 'tool' });
    }
};

/**
 * 工具执行失败行（组内与单条 ToolErrorBlock 共用）：红色叉号 + 「xx失败」 + 标题，
 * 展开后输出框显示报错信息；标题与工具名相同时不重复显示
 */
export const ToolErrorRow: React.FC<{ toolName: string; title: string; content: string }> = ({ toolName, title, content }) => {
    const t = useT();
    const target = title && title !== toolName ? title : undefined;
    return (
        <GroupedResultRow
            className="tool-row-header--error"
            icon={<XIcon />}
            verb={getToolErrorVerb(toolName, t)}
            target={target}
            full={target}
            content={content}
        />
    );
};

/** 搜索行：只显示行头，不展开结果 */
const SearchItemBlock: React.FC<{ message: Message }> = ({ message }) => {
    const t = useT();
    const meta = getSearchRowMeta(getToolName(message), getToolTitle(message), t);
    return (
        <div className="chat-block chat-block--borderless">
            <SearchRowHeader meta={meta} />
        </div>
    );
};

/** 终端命令行（只读与否都一样）：目标优先用描述，无描述用命令；展开后显示完整命令与输出 */
const ShellItemBlock: React.FC<{ message: Message }> = ({ message }) => {
    const t = useT();
    const command = getToolTitle(message).trim();
    const summary = message.content?.summary;
    return (
        <GroupedResultRow
            icon={<TerminalIcon />}
            verb={t('tool.ran')}
            target={summary || command}
            full={command}
            content={message.content?.content}
        />
    );
};

/** MCP 调用行：动词带服务名，目标只有工具名；展开体为参数纯文本与返回结果（与终端行同一套） */
const McpItemBlock: React.FC<{ message: Message }> = ({ message }) => {
    const t = useT();
    const { mcpName, toolName } = parseMcpToolName(getToolName(message));
    const params = getToolTitle(message);

    return (
        <GroupedResultRow
            icon={<PlugIcon />}
            verb={t('tool.called', { name: mcpName })}
            target={toolName}
            full={params}
            content={message.content?.content}
            summary={message.content?.summary}
        />
    );
};

/** 抓网页 / 后台任务 / 定时任务行的图标与动词 */
const getPubRowMeta = (toolName: string, t: Translate): { icon: React.ReactNode; verb: string } | null => {
    if (toolName === TOOL_NAME_FETCH_URL) {
        return { icon: <GlobeIcon />, verb: t('tool.fetched') };
    }
    if (toolName === TOOL_NAME_PEEK_BG_JOB) {
        return { icon: <WrenchIcon />, verb: t('tool.jobPeek') };
    }
    if (toolName === TOOL_NAME_STOP_BG_JOB) {
        return { icon: <WrenchIcon />, verb: t('tool.jobStop') };
    }
    if (toolName === TOOL_NAME_CREATE_CRON) {
        return { icon: <ClockIcon />, verb: t('tool.cronCreate') };
    }
    if (toolName === TOOL_NAME_DEL_CRON) {
        return { icon: <ClockIcon />, verb: t('tool.cronDelete') };
    }
    if (toolName === TOOL_NAME_LIST_CRONS) {
        return { icon: <ClockIcon />, verb: t('tool.cronList') };
    }
    return null;
};

const PubItemBlock: React.FC<{ message: Message; meta: { icon: React.ReactNode; verb: string } }> = ({ message, meta }) => {
    const title = getToolTitle(message);
    return (
        <GroupedResultRow
            icon={meta.icon}
            verb={meta.verb}
            target={title}
            full={title}
            content={message.content?.content}
            summary={message.content?.summary}
        />
    );
};

const ReadSummaryRow: React.FC<{
    item: ReadSummaryItem;
    onFileOpen: (filePath: string, line: number) => void;
}> = ({ item, onFileOpen }) => {
    const t = useT();
    return (
        <div className="chat-block chat-block--borderless">
            <ToolRowHeader
                icon={<FileTextIcon />}
                verb={t('tool.read')}
                wrap
                target={(
                    <span className="grouped-read-files">
                        {item.files.map((file, index) => (
                            <React.Fragment key={file.title}>
                                {index > 0 && <span className="grouped-tool-muted-text">,&#160;</span>}
                                <button
                                    className="grouped-tool-muted-text grouped-read-file"
                                    onClick={() => onFileOpen(file.filePath, file.line)}
                                    title={file.title}
                                >
                                    {file.display}
                                </button>
                            </React.Fragment>
                        ))}
                    </span>
                )}
            />
        </div>
    );
};

// ==================== memory 写入行 ====================

/** 与 EditBlock.reportFileChange 口径一致；组默认折叠、EditBlock 不挂载，需由组块自行上报 */
const getMemoryFileChange = (message: Message): FileChange | null => {
    const fileName = getToolTitle(message);
    const diffContent = message.content?.content;
    if (!fileName || typeof diffContent !== 'object' || diffContent === null
        || (diffContent.type !== 'diff' && diffContent.type !== 'new')) {
        return null;
    }

    const { addedCount, removedCount } = countDiffChanges(diffContent);
    return {
        fileName: fileName.split(/[/\\]/).pop() || fileName,
        fullPath: fileName,
        type: getToolName(message) === TOOL_NAME_WRITE_FILE ? 'write' : 'edit',
        isNotebook: false,
        additions: addedCount,
        removals: removedCount,
        minLine: diffContent.patch?.[0]?.oldStart || 1,
    };
};

/** memory 写入行：已写入 + 文件名 + 增删行数；文件名可点打开文件对比（与 EditBlock 一致），展开为 diff，点击 diff 同样打开对比 */
const MemoryItemBlock: React.FC<{ message: Message; vscode?: any }> = ({ message, vscode }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);
    const change = getMemoryFileChange(message);
    const diffContent = message.content?.content;
    const fileName = getToolTitle(message);
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const language = langMap[ext] || 'plaintext';

    const handleShowDiff = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (hasTextSelection() || !fileName) {
            return;
        }
        vscode?.postMessage({ type: 'showFileDiff', filePath: fileName, minLine: change?.minLine ?? 1 });
    };

    return (
        <div className="chat-block chat-block--borderless">
            <ToolRowHeader
                icon={<BrainIcon />}
                verb={t('tool.wrote')}
                target={change?.fileName || fileName}
                targetTitle={fileName}
                onTargetClick={handleShowDiff}
                extra={change && (
                    <span className="edit-stats">
                        {change.additions > 0 && <span className="additions">+{change.additions}</span>}
                        {change.removals > 0 && <span className="removals">-{change.removals}</span>}
                    </span>
                )}
                expandable
                isExpanded={isExpanded}
                onClick={() => setIsExpanded(prev => !prev)}
            />
            {isExpanded && change && (
                <div className="chat-block-content grouped-diff-content" onClick={handleShowDiff}>
                    <CollapsibleDiff diffContent={diffContent} language={language} />
                </div>
            )}
        </div>
    );
};

const renderExpandedItem = (
    item: ExpandedItem,
    onFileOpen: (filePath: string, line: number) => void,
    vscode: any,
    t: Translate,
): React.ReactNode => {
    if (item.kind === 'read-summary') {
        return <ReadSummaryRow key={item.item.id} item={item.item} onFileOpen={onFileOpen} />;
    }

    const { message } = item;
    const toolName = getToolName(message);
    if (isMemoryEditMessage(message)) {
        return <MemoryItemBlock key={message.id} message={message} vscode={vscode} />;
    }
    if (isToolErrorMessage(message)) {
        return (
            <ToolErrorRow
                key={message.id}
                toolName={toolName}
                title={message.content?.title || ''}
                content={message.content?.content || ''}
            />
        );
    }
    if (toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT) {
        return <SearchItemBlock key={message.id} message={message} />;
    }
    if (getMcpServerName(message)) {
        return <McpItemBlock key={message.id} message={message} />;
    }
    if (toolName === TOOL_NAME_RUN_SHELL) {
        return <ShellItemBlock key={message.id} message={message} />;
    }
    const pubMeta = getPubRowMeta(toolName, t);
    if (pubMeta) {
        return <PubItemBlock key={message.id} message={message} meta={pubMeta} />;
    }
    return null;
};

// ==================== 混合工具组 ====================

/**
 * 混合工具组：组头按类别拼接标题（见 getGroupTitle）；
 * 展开后每项统一为「图标 动词 目标 ›」行，同一缩进，点击行才展示完整文本与结果。
 * 组内 memory 写入折叠时 EditBlock 不挂载，由组块代为上报文件变更。
 */
const GroupedToolBlock: React.FC<GroupedToolBlockProps> = ({ messages, vscode, onFileChange }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);

    const categories = useMemo(() => getGroupCategories(messages), [messages]);
    const titleText = useMemo(() => getGroupTitle(messages), [messages]);

    useEffect(() => {
        if (!onFileChange) {
            return;
        }
        messages.forEach(message => {
            if (!isMemoryEditMessage(message)) {
                return;
            }
            const change = getMemoryFileChange(message);
            if (change) {
                onFileChange(change);
            }
        });
    }, [messages, onFileChange]);

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

    return (
        <div className="chat-block chat-block--borderless grouped-tool-block">
            <GroupHeader titleText={titleText} isExpanded={isExpanded} onToggle={() => setIsExpanded(prev => !prev)}>
                {categories.map((category, index) => {
                    const { verb, subject, count } = getCategoryText(category);
                    return (
                        <React.Fragment key={category.key}>
                            {index > 0 && <span className="grouped-tool-muted-text">, </span>}
                            {index === 0
                                ? <strong>{verb}</strong>
                                : <span className="grouped-tool-muted-text">{verb.toLowerCase()}</span>}
                            {subject && <> {subject}</>}
                            {' '}<span className="grouped-tool-muted-text">{count}</span>
                        </React.Fragment>
                    );
                })}
            </GroupHeader>
            {isExpanded && (
                <div className="chat-block-content grouped-tool-content">
                    {expandedItems.map(item => renderExpandedItem(item, handleFileOpen, vscode, t))}
                </div>
            )}
        </div>
    );
};

export default React.memo(GroupedToolBlock, (prev, next) => {
    if (prev.onFileChange !== next.onFileChange) return false;
    if (prev.messages.length !== next.messages.length) return false;
    return prev.messages.every((msg, i) => msg === next.messages[i]);
});
