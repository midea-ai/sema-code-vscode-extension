import { Message } from '../types';
import {
    TOOL_NAME_CREATE_CRON,
    TOOL_NAME_DEL_CRON,
    TOOL_NAME_FETCH_URL,
    TOOL_NAME_LIST_CRONS,
    TOOL_NAME_PATCH_FILE,
    TOOL_NAME_PEEK_BG_JOB,
    TOOL_NAME_RUN_SHELL,
    TOOL_NAME_SEARCH_CONTENT,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_STOP_BG_JOB,
    TOOL_NAME_VIEW_FILE,
    TOOL_NAME_WRITE_FILE,
} from '../../../utils/tool';
import { isMcpToolType, parseMcpToolName } from './permissionUtils';

export type RenderItem =
    | { kind: 'message'; message: Message; originalIndex: number }
    | { kind: 'group'; id: string; messages: Message[]; originalStartIndex: number };

interface GroupMessagesOptions {
    streamingToolId?: string | null;
    showThinkingText?: boolean;
    /** 列表末尾之后是否已有其它渲染内容（如下一轮用户输入），为 true 时段尾的工具也并入组 */
    tailClosed?: boolean;
}

interface RunItem {
    message: Message;
    index: number;
}

const GROUPABLE_TOOL_NAMES = new Set([
    TOOL_NAME_VIEW_FILE,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_SEARCH_CONTENT,
]);

export const FETCH_TOOL_NAMES = new Set([TOOL_NAME_FETCH_URL]);
export const JOB_TOOL_NAMES = new Set([TOOL_NAME_PEEK_BG_JOB, TOOL_NAME_STOP_BG_JOB]);
export const CRON_TOOL_NAMES = new Set([TOOL_NAME_CREATE_CRON, TOOL_NAME_DEL_CRON, TOOL_NAME_LIST_CRONS]);

/** 走默认 PubBlock 渲染但可并入组的工具：抓网页、后台任务查看/停止、定时任务管理 */
const PUB_GROUPABLE_TOOL_NAMES = new Set([...FETCH_TOOL_NAMES, ...JOB_TOOL_NAMES, ...CRON_TOOL_NAMES]);

export const getToolName = (message: Message): string => {
    return message.toolName || message.content?.toolName || '';
};

export const getToolTitle = (message: Message): string => {
    return message.content?.title || '';
};

/** 命令段分隔符：&&、||、; 一视同仁，每一段都要单独通过只读检查 */
export const SHELL_SEGMENT_SEPARATOR = /\s*(?:&&|\|\||;)\s*/;

/** 管道右侧允许出现的纯过滤命令，出现其它命令（如 xargs、tee）即不算探索 */
const READ_ONLY_PIPE_FILTERS = new Set([
    'head', 'tail', 'grep', 'egrep', 'fgrep', 'wc', 'sort', 'uniq', 'cut', 'tr', 'cat', 'column', 'nl',
]);

export type ShellExploreKind = 'list' | 'find' | 'path';

const isCdSegment = (segment: string): boolean => /^cd(?:\s|$)/.test(segment);

const isReadOnlyPipeFilter = (segment: string): boolean => {
    const command = segment.trim().split(/\s+/)[0] || '';
    return READ_ONLY_PIPE_FILTERS.has(command);
};

/** 单个命令段（不含 && / || / ;）的探索类型：ls/tree → list，find → find，pwd → path；含写入副作用则为 null */
const getShellSegmentKind = (segment: string): ShellExploreKind | null => {
    // 输出重定向会写文件，不算只读；丢弃到 /dev/null 或合并到 stdout 的 2>&1 不写文件，先剔除再判断
    if (/>/.test(segment.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, ''))) {
        return null;
    }

    const [head = '', ...pipes] = segment.split(/\s*\|\s*/);
    if (!pipes.every(isReadOnlyPipeFilter)) {
        return null;
    }

    const command = head.trim();
    if (/^(?:ls|tree)(?:\s|$)/.test(command)) {
        return 'list';
    }
    if (/^find(?:\s|$)/.test(command)) {
        // -delete/-exec 等会执行动作或写文件，不算只读
        return /(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)(?:\s|$)/.test(command) ? null : 'find';
    }
    if (/^pwd(?:\s+-(?:L|P))*$/.test(command)) {
        return 'path';
    }
    return null;
};

/**
 * 终端命令的探索类型。整条命令按 && / || / ; 切段，cd 段视为中性跳过，
 * 其余每一段都必须是只读的 ls/tree、find、pwd（可接只读过滤管道），否则不算探索。
 * 只有一个有效段时返回该段类型，多段返回 'explore'。
 */
export const getShellExploreKind = (message: Message): ShellExploreKind | 'explore' | null => {
    const segments = getToolTitle(message).trim()
        .split(SHELL_SEGMENT_SEPARATOR)
        .map(segment => segment.trim())
        .filter(segment => segment && !isCdSegment(segment));

    if (segments.length === 0) {
        return null;
    }

    const kinds: (ShellExploreKind | null)[] = [];
    for (const segment of segments) {
        const kind = getShellSegmentKind(segment);
        if (kind === null) {
            return null;
        }
        kinds.push(kind);
    }

    return kinds.length === 1 ? kinds[0] : 'explore';
};

export const getGroupableToolKind = (message: Message): string | null => {
    const toolName = getToolName(message);
    if (toolName === TOOL_NAME_VIEW_FILE) {
        return 'read';
    }
    if (toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT) {
        return 'search';
    }
    if (toolName === TOOL_NAME_RUN_SHELL) {
        return getShellExploreKind(message);
    }
    return null;
};

/** 消息所属 MCP 服务名；非 MCP 工具返回 null */
export const getMcpServerName = (message: Message): string | null => {
    if (message.type !== 'tool') {
        return null;
    }

    const toolName = getToolName(message);
    if (!isMcpToolType(toolName)) {
        return null;
    }

    return parseMcpToolName(toolName).mcpName || null;
};

/** 工具执行报错（system/tool_error）：任何工具的报错都可并入混合工具组，但不计入组头文案与成组门槛 */
export const isToolErrorMessage = (message: Message): boolean => {
    return message.type === 'system' && message.content?.type === 'tool_error';
};

/** 非探索类的终端命令（ls/find/pwd 等归探索组，不算在内） */
export const isShellRunMessage = (message: Message): boolean => {
    return message.type === 'tool'
        && getToolName(message) === TOOL_NAME_RUN_SHELL
        && getGroupableToolKind(message) === null;
};

/** 新增/编辑 memory 目录下 md 文件的工具消息（如 .../memory/foo.md、.../memory/MEMORY.md） */
export const isMemoryEditMessage = (message: Message): boolean => {
    if (message.type !== 'tool') {
        return false;
    }

    const toolName = getToolName(message);
    if (toolName !== TOOL_NAME_WRITE_FILE && toolName !== TOOL_NAME_PATCH_FILE) {
        return false;
    }

    const segments = getToolTitle(message).trim().split(/[/\\]/).filter(Boolean);
    if (segments.length < 2) {
        return false;
    }

    const fileName = segments[segments.length - 1];
    const parentDir = segments[segments.length - 2];
    return /\.md$/i.test(fileName) && parentDir === 'memory';
};

/**
 * 可并入混合工具组的消息：探索类（Read/Search/只读命令）、其余终端命令、MCP 调用，
 * 抓网页、后台任务查看/停止、定时任务管理、memory 写入，以及任何工具的执行报错。
 * 相邻的可并入消息不分种类进同一段；文件编辑、Skill、子代理、提问等其它工具与可见正文一样作为段边界。
 */
export const isGroupableToolMessage = (message: Message): boolean => {
    if (isToolErrorMessage(message) || isMemoryEditMessage(message)) {
        return true;
    }

    if (message.type !== 'tool') {
        return false;
    }

    if (getMcpServerName(message)) {
        return true;
    }

    const toolName = getToolName(message);
    return GROUPABLE_TOOL_NAMES.has(toolName) || PUB_GROUPABLE_TOOL_NAMES.has(toolName) || toolName === TOOL_NAME_RUN_SHELL;
};

const isStreamingToolMessage = (message: Message, streamingToolId?: string | null): boolean => {
    return message.content?.completed === false || (!!streamingToolId && message.id === streamingToolId);
};

const hasVisibleAssistantBody = (message: Message, showThinkingText: boolean): boolean => {
    const content = message.content?.content;
    const reasoning = message.reasoning;
    const hasContent = !!(content && content.trim().length > 0);
    const hasVisibleReasoning = showThinkingText && !!(reasoning && reasoning.trim().length > 0);
    return hasContent || hasVisibleReasoning;
};

const isInvisibleCompletedAssistantMessage = (
    message: Message,
    showThinkingText = true,
): boolean => {
    if (message.type !== 'assistant' || message.content?.completed === false) {
        return false;
    }

    return !hasVisibleAssistantBody(message, showThinkingText);
};

/**
 * 流式中、尚无可见正文/思考的 assistant 消息：还不算「后面已有渲染内容」。
 * 若它最终无正文结束并接着新的终端命令，终端组应继续累积，避免先折叠再展开的闪动。
 */
const isPendingEmptyAssistantMessage = (
    message: Message,
    showThinkingText = true,
): boolean => {
    if (message.type !== 'assistant' || message.content?.completed !== false) {
        return false;
    }

    return !hasVisibleAssistantBody(message, showThinkingText);
};

const toMessageItems = (run: RunItem[]): RenderItem[] => {
    return run.map(({ message, index }) => ({
        kind: 'message' as const,
        message,
        originalIndex: index,
    }));
};

const toGroupItem = (run: RunItem[]): RenderItem => ({
    kind: 'group',
    id: `tool-group-${run[0].message.id}`,
    messages: run.map(({ message }) => message),
    originalStartIndex: run[0].index,
});

/**
 * 把一段可并入的工具消息输出为渲染项。
 * closed 表示段之后是否已有其它渲染内容。未封口（或末条仍在流式）时段尾一条作为「尾巴」原样单独渲染，
 * 便于查看运行中的输出，其余并入组；段一封口尾巴随之并入。并入的部分中非报错消息 ≥2 条才出组头，否则逐条渲染。
 * memory 写入不做尾巴、1 条也折叠、流式中也直接进组，避免先展开 diff 再折叠的闪动。
 * 组 id 只取首条消息 id，尾巴并入时组件实例不重建，已展开状态得以保留。
 */
const flushRun = (
    items: RenderItem[],
    run: RunItem[],
    closed: boolean,
    streamingToolId?: string | null,
): void => {
    if (run.length === 0) {
        return;
    }

    const last = run[run.length - 1];
    const keepTail = (!closed || isStreamingToolMessage(last.message, streamingToolId))
        && !isMemoryEditMessage(last.message);
    const head = keepTail ? run.slice(0, -1) : run;

    const toolCount = head.filter(({ message }) => !isToolErrorMessage(message)).length;
    if (toolCount >= 2 || head.some(({ message }) => isMemoryEditMessage(message))) {
        items.push(toGroupItem(head));
    } else {
        items.push(...toMessageItems(head));
    }

    if (keepTail) {
        items.push(...toMessageItems([last]));
    }
};

export const groupMessages = (
    messages: Message[],
    options: GroupMessagesOptions = {},
): RenderItem[] => {
    const items: RenderItem[] = [];
    let run: RunItem[] = [];

    messages.forEach((message, index) => {
        if (isGroupableToolMessage(message)) {
            run.push({ message, index });
            return;
        }

        if (isInvisibleCompletedAssistantMessage(message, options.showThinkingText)) {
            return;
        }

        const closed = !isPendingEmptyAssistantMessage(message, options.showThinkingText);
        flushRun(items, run, closed, options.streamingToolId);
        run = [];
        items.push({ kind: 'message', message, originalIndex: index });
    });

    flushRun(items, run, !!options.tailClosed, options.streamingToolId);

    return items;
};
