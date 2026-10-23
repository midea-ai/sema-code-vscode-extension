import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BrainIcon, ClockIcon, FileTextIcon, GlobeIcon, ImageIcon, PlugIcon, PuzzleIcon, QuestionBubbleIcon, TerminalIcon, WrenchIcon, XIcon } from '../../components/ui/IconButton';
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
    isAskFormPanelMessage,
    isAskToolMessage,
    isGenImageMessage,
    isMemoryEditMessage,
    isPermissionPanelMessage,
    isShellRunMessage,
    isSkillMessage,
    isToolErrorMessage,
} from '../../utils/groupMessages';
import GeneratedImageBlock from './GeneratedImageBlock';
import PermissionContent from '../../components/permission/PermissionContent';
import { AskFormValues, PickOptionRequestData, formatAskFormAnswers } from '../../components/ui/AskFormDialog';
import { isMcpToolType, parseMcpToolName } from '../../utils/permissionUtils';
import { langMap } from '../../utils/fileLangTypeMap';
import { hasTextSelection } from '../../utils/selection';
import { getSearchRowMeta, resolveSkillFilePath } from './utils';
import { baseName, displayPath } from '../../utils/pathDisplay';
import { processTerminalOutput } from './BashBlock';
import ToolRowHeader, { SearchRowHeader } from './ToolRowHeader';
import CollapsibleDiff from '../../components/ui/CollapsibleDiff';
import CollapsibleContent from '../../components/ui/CollapsibleContent';
import { useT } from '../../../common/i18n/react';
import type { I18nKey } from '../../../common/i18n/react';

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
    /** 组内相邻的多次 generate_image 调用合并成一行缩略图 */
    | { kind: 'gen-image'; id: string; messages: Message[] }
    /** 组内相邻的同服务 MCP 调用（≥2 次）合并成「调用了 xx n 次」二级可展开行 */
    | { kind: 'mcp-run'; id: string; server: string; messages: Message[] }
    | { kind: 'message'; message: Message };

/** 成功的 Read 消息；Read 的执行报错与读文件的权限面板 content.toolName 也是 view_file，需排除，不并入合并行 */
const isReadMessage = (message: Message): boolean => {
    return message.type === 'tool' && getToolName(message) === TOOL_NAME_VIEW_FILE;
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

    const displayFileName = baseName(filePath);
    return {
        display: `${displayFileName}${lineRange}`,
        filePath,
        line: offset !== null ? offset + 1 : 1,
        title: displayPath(filePath) + lineRange,
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

/**
 * 组内展开项：连续 Read 合并为一行，连续生成图片合并为一行缩略图，
 * 连续同服务 MCP 调用 ≥2 次合并为「调用了 xx n 次」二级行（1 次仍单行；报错打断合并），其余（含执行报错）逐条
 */
export const getExpandedItems = (messages: Message[]): ExpandedItem[] => {
    const items: ExpandedItem[] = [];
    let readRun: Message[] = [];
    let genImageRun: Message[] = [];
    let mcpRun: Message[] = [];
    let mcpServer = '';

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

    const flushGenImageRun = () => {
        if (genImageRun.length === 0) {
            return;
        }
        items.push({ kind: 'gen-image', id: `gen-image-${genImageRun[0].id}`, messages: genImageRun });
        genImageRun = [];
    };

    const flushMcpRun = () => {
        if (mcpRun.length >= 2) {
            items.push({ kind: 'mcp-run', id: `mcp-run-${mcpRun[0].id}`, server: mcpServer, messages: mcpRun });
        } else if (mcpRun.length === 1) {
            items.push({ kind: 'message', message: mcpRun[0] });
        }
        mcpRun = [];
    };

    for (const message of messages) {
        if (isReadMessage(message)) {
            flushGenImageRun();
            flushMcpRun();
            readRun.push(message);
            continue;
        }
        if (isGenImageMessage(message)) {
            flushReadRun();
            flushMcpRun();
            genImageRun.push(message);
            continue;
        }

        const server = getMcpServerName(message);
        if (server) {
            flushReadRun();
            flushGenImageRun();
            if (mcpRun.length > 0 && server !== mcpServer) {
                flushMcpRun();
            }
            mcpServer = server;
            mcpRun.push(message);
            continue;
        }

        flushReadRun();
        flushGenImageRun();
        flushMcpRun();
        items.push({ kind: 'message', message });
    }

    flushReadRun();
    flushGenImageRun();
    flushMcpRun();
    return items;
};

// ==================== 类别与组头 ====================

type GroupCategoryKind =
    | 'explore' | 'ran' | 'mcp' | 'fetch' | 'job' | 'cron' | 'memory' | 'image'
    | 'skill' | 'ask';

interface GroupCategory {
    key: string;
    kind: GroupCategoryKind;
    /** 仅 mcp：服务名 */
    server?: string;
    count: number;
}

/** 生成图片调用在组头计数里的权重：已完成按成图张数，生成中算 1，出错或中断无成图算 0（不出现在组头） */
const getGenImageWeight = (message: Message): number => {
    const content = message.content;
    if (content?.completed === false) {
        return 1;
    }
    const images = content?.content?.images;
    return Array.isArray(images) ? images.length : 0;
};

/**
 * 非 MCP 消息的类别：提问（面板或记录）、技能、memory 写入、生成图片、非只读命令、
 * 抓网页、后台任务、定时任务，其余（Read/Search/只读命令）为探索
 */
const getCategoryKind = (message: Message): GroupCategoryKind => {
    if (isAskFormPanelMessage(message) || isAskToolMessage(message)) {
        return 'ask';
    }
    if (isSkillMessage(message)) {
        return 'skill';
    }
    if (isMemoryEditMessage(message)) {
        return 'memory';
    }
    if (isGenImageMessage(message)) {
        return 'image';
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

/**
 * 类别优先级（高 → 低）：组图标取组内命中的最高一档，组头文案各类别也按此排序，
 * 同一组合不论组内先后顺序都显示成同样的样子；MCP 多个服务同属一档，服务之间按首次出现顺序
 */
const GROUP_KIND_PRIORITY: GroupCategoryKind[] = ['ran', 'mcp', 'image', 'skill', 'explore', 'fetch', 'ask', 'memory', 'cron', 'job'];

const kindRank = (kind: GroupCategoryKind): number => GROUP_KIND_PRIORITY.indexOf(kind);

/**
 * 组内消息按类别计数，结果按 GROUP_KIND_PRIORITY 排序；MCP 按服务名分别计数；生成图片按张数计；
 * 执行报错与权限面板（拒绝/中断）都不计入，只在组内展示
 */
export const getGroupCategories = (messages: Message[]): GroupCategory[] => {
    const categories: GroupCategory[] = [];
    const byKey = new Map<string, GroupCategory>();

    for (const message of messages) {
        if (isToolErrorMessage(message) || isPermissionPanelMessage(message)) {
            continue;
        }
        const server = getMcpServerName(message);
        const kind = server ? 'mcp' : getCategoryKind(message);
        const key = server ? `mcp:${server}` : kind;
        const weight = kind === 'image' ? getGenImageWeight(message) : 1;
        if (weight === 0) {
            continue;
        }

        let category = byKey.get(key);
        if (!category) {
            category = { key, kind, server: server || undefined, count: 0 };
            byKey.set(key, category);
            categories.push(category);
        }
        category.count += weight;
    }

    // sort 稳定：同档（多个 MCP 服务）保持首次出现顺序
    return categories.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
};

/** 类别文案 key：many 为通用句式（中文不分单复数），one 为英文单数 */
const GROUP_TEXT_KEYS: Record<GroupCategoryKind, { many: I18nKey; one: I18nKey }> = {
    ran: { many: 'tool.group.ran', one: 'tool.group.ran.one' },
    mcp: { many: 'tool.group.mcp', one: 'tool.group.mcp.one' },
    image: { many: 'tool.group.image', one: 'tool.group.image.one' },
    skill: { many: 'tool.group.skill', one: 'tool.group.skill.one' },
    explore: { many: 'tool.group.explore', one: 'tool.group.explore.one' },
    fetch: { many: 'tool.group.fetch', one: 'tool.group.fetch.one' },
    ask: { many: 'tool.group.ask', one: 'tool.group.ask.one' },
    memory: { many: 'tool.group.memory', one: 'tool.group.memory.one' },
    cron: { many: 'tool.group.cron', one: 'tool.group.cron.one' },
    job: { many: 'tool.group.job', one: 'tool.group.job.one' },
};

/** 类别文案：如「执行 2 条命令」「调用 figma 3 次」/ Ran 2 commands、Called figma 3 times */
const getCategoryText = (category: GroupCategory, t: Translate): string => {
    const keys = GROUP_TEXT_KEYS[category.kind];
    return t(category.count === 1 ? keys.one : keys.many, { name: category.server || '', count: category.count });
};

/**
 * 组头标题：各类别（已按优先级排序）用语言分隔符拼接，如「执行 4 条命令、探索 6 个工具」；
 * 组内全是不计数的消息（中断/出错无成图的生图调用、报错、权限面板）时用兜底文案「调用工具」
 */
export const getGroupTitle = (categories: GroupCategory[], t: Translate): string => {
    return categories.map(category => getCategoryText(category, t)).join(t('tool.group.sep')) || t('tool.group.fallback');
};

/** 各类别的组头图标（与组内对应行的图标一致） */
const GROUP_KIND_ICONS: Record<GroupCategoryKind, React.ReactNode> = {
    ran: <TerminalIcon />,
    mcp: <PlugIcon />,
    image: <ImageIcon />,
    skill: <PuzzleIcon />,
    explore: <FileTextIcon />,
    fetch: <GlobeIcon />,
    ask: <QuestionBubbleIcon />,
    memory: <BrainIcon />,
    cron: <ClockIcon />,
    job: <WrenchIcon />,
};

/** 组头图标：取优先级最高的类别；无类别时用通用工具图标兜底，保证组头永远有图标、文字起点对齐 */
const getGroupIcon = (categories: GroupCategory[]): React.ReactNode => {
    return categories.length > 0 ? GROUP_KIND_ICONS[categories[0].kind] : <WrenchIcon />;
};

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
            verb={message.content?.interrupted ? t('tool.ranInterrupted') : t('tool.ran')}
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

/**
 * 连续同服务 MCP 调用合并行：「调用 xx n 次 ›」，默认折叠，展开后逐条列出各次调用行（再点开看参数与结果）。
 * 组内二级行与组外单独渲染共用；展开体复用组内容的缩进样式。
 */
export const McpRunBlock: React.FC<{ server: string; messages: Message[] }> = ({ server, messages }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="chat-block chat-block--borderless">
            <ToolRowHeader
                icon={<PlugIcon />}
                verb={t('tool.calledTimes', { name: server, count: messages.length })}
                expandable
                isExpanded={isExpanded}
                onClick={() => setIsExpanded(prev => !prev)}
            />
            {isExpanded && (
                <div className="chat-block-content grouped-tool-content">
                    {messages.map(message => <McpItemBlock key={message.id} message={message} />)}
                </div>
            )}
        </div>
    );
};

/** 抓网页 / 后台任务 / 定时任务行的图标与动词 */
const getPubRowMeta = (toolName: string, t: Translate, interrupted?: boolean): { icon: React.ReactNode; verb: string } | null => {
    if (toolName === TOOL_NAME_FETCH_URL) {
        return { icon: <GlobeIcon />, verb: interrupted ? t('tool.fetchInterrupted') : t('tool.fetched') };
    }
    if (toolName === TOOL_NAME_PEEK_BG_JOB) {
        return { icon: <WrenchIcon />, verb: interrupted ? t('tool.jobPeekInterrupted') : t('tool.jobPeek') };
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
    // 抓网页被用户中断：只显示「抓取已中断 + URL」行头，没有可展开的内容
    if (getToolName(message) === TOOL_NAME_FETCH_URL && message.content?.interrupted) {
        return (
            <div className="chat-block chat-block--borderless">
                <ToolRowHeader icon={meta.icon} verb={meta.verb} target={title} targetTitle={title} />
            </div>
        );
    }
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

// ==================== 技能 / 提问 / 权限面板行 ====================

/** 技能行：只有行头不展开，标题与整行可点直接打开 SKILL.md（与单条 PubBlock 一致） */
const SkillItemBlock: React.FC<{ message: Message; vscode?: any }> = ({ message, vscode }) => {
    const t = useT();
    const title = getToolTitle(message);
    const skillFilePath = resolveSkillFilePath(title, message.content?.summary);
    const handleOpenSkill = skillFilePath
        ? () => {
            if (hasTextSelection() || !vscode) return;
            vscode.postMessage({ type: 'openFile', filePath: skillFilePath, line: 1 });
        }
        : undefined;

    return (
        <div className="chat-block chat-block--borderless">
            <ToolRowHeader
                icon={<WrenchIcon />}
                verb={t('tool.skill')}
                target={title}
                targetTitle={skillFilePath || title}
                onTargetClick={handleOpenSkill}
                onClick={handleOpenSkill}
            />
        </div>
    );
};

/** ask_form 调用记录行「用户已回应」：展开为工具返回的回答文本（即用户提交的「- 题目: 回答」列表） */
const AskToolItemBlock: React.FC<{ message: Message }> = ({ message }) => {
    const t = useT();
    return (
        <GroupedResultRow
            icon={<QuestionBubbleIcon />}
            verb={t('tool.ask')}
            content={message.content?.content}
            summary={message.content?.summary}
        />
    );
};

/**
 * 旧会话里已落盘的用户回应表单面板行（组内与落单单条共用；新会话提交后不再回插面板）：
 * 只有动词不带目标，展开为「- 题目: 回答」列表，未答的题标 (skipped)
 */
export const AskFormPanelRow: React.FC<{ message: Message }> = ({ message }) => {
    const t = useT();
    const data = message.content?.data as PickOptionRequestData | undefined;
    const questions = data?.questions || [];
    const values = (message.content?.values || {}) as AskFormValues;
    return (
        <GroupedResultRow
            icon={<QuestionBubbleIcon />}
            verb={t('tool.ask')}
            content={formatAskFormAnswers(questions, values)}
        />
    );
};

/** 权限拒绝 / 中断面板行（组内与落单单条共用）：只有动词不带目标，展开复用权限弹窗的内容区（命令 / 文件 diff，含用户拒绝时的留言） */
export const PermissionPanelRow: React.FC<{ message: Message; vscode?: any }> = ({ message, vscode }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);
    const { toolName = '', title = '', content = '', action, refuseMessage } = message.content || {};
    const interrupted = action === 'interrupted';

    return (
        <div className="chat-block chat-block--borderless">
            <ToolRowHeader
                icon={<XIcon />}
                verb={interrupted ? t('tool.permissionInterrupted') : t('tool.permissionRefused')}
                expandable
                isExpanded={isExpanded}
                onClick={() => setIsExpanded(prev => !prev)}
            />
            {isExpanded && (
                <div className="chat-block-content grouped-result-body">
                    <div className="bash-permission-content permission-content-dimmed">
                        <PermissionContent toolName={toolName} title={title} content={content} vscode={vscode} />
                        {refuseMessage && (
                            <div className="bash-permission-refuse-message">
                                <strong>User said：</strong>{refuseMessage}
                            </div>
                        )}
                    </div>
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
    if (item.kind === 'gen-image') {
        return <GeneratedImageBlock key={item.id} contents={item.messages.map(m => m.content)} vscode={vscode} />;
    }
    if (item.kind === 'mcp-run') {
        return <McpRunBlock key={item.id} server={item.server} messages={item.messages} />;
    }

    const { message } = item;
    // 面板不是工具消息，content.toolName 是被拒 / 被问的工具名，须先于按工具名的分派
    if (isPermissionPanelMessage(message)) {
        return <PermissionPanelRow key={message.id} message={message} vscode={vscode} />;
    }
    if (isAskFormPanelMessage(message)) {
        return <AskFormPanelRow key={message.id} message={message} />;
    }

    const toolName = getToolName(message);
    if (isSkillMessage(message)) {
        return <SkillItemBlock key={message.id} message={message} vscode={vscode} />;
    }
    if (isAskToolMessage(message)) {
        return <AskToolItemBlock key={message.id} message={message} />;
    }
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
    const pubMeta = getPubRowMeta(toolName, t, message.content?.interrupted === true);
    if (pubMeta) {
        return <PubItemBlock key={message.id} message={message} meta={pubMeta} />;
    }
    return null;
};

// ==================== 混合工具组 ====================

/**
 * 混合工具组：组头与组内行同构，「图标 标题 ›」，图标取优先级最高的类别，标题按类别优先级拼接（见 getGroupTitle），
 * 箭头折叠时 hover 才出现；展开后每项统一为「图标 动词 目标 ›」行，同一缩进，点击行才展示完整文本与结果。
 * 组内 memory 写入折叠时 EditBlock 不挂载，由组块代为上报文件变更。
 */
const GroupedToolBlock: React.FC<GroupedToolBlockProps> = ({ messages, vscode, onFileChange }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(false);

    const categories = useMemo(() => getGroupCategories(messages), [messages]);
    const titleText = useMemo(() => getGroupTitle(categories, t), [categories, t]);
    const icon = useMemo(() => getGroupIcon(categories), [categories]);

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
            <ToolRowHeader
                icon={icon}
                verb={titleText}
                title={titleText}
                expandable
                isExpanded={isExpanded}
                onClick={() => setIsExpanded(prev => !prev)}
            />
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
