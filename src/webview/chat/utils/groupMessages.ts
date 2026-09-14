import { Message } from '../types';
import {
    TOOL_NAME_RUN_SHELL,
    TOOL_NAME_SEARCH_CONTENT,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_VIEW_FILE,
} from '../../../utils/tool';
import { isMcpToolType, parseMcpToolName } from './permissionUtils';

export type RenderItem =
    | { kind: 'message'; message: Message; originalIndex: number }
    | { kind: 'group'; id: string; messages: Message[]; originalStartIndex: number };

interface GroupMessagesOptions {
    streamingToolId?: string | null;
    showThinkingText?: boolean;
    /** 列表末尾之后是否已有其它渲染内容（如下一轮用户输入），为 true 时末尾的终端命令也可折叠 */
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
    // 输出重定向会写文件，不算只读
    if (/>/.test(segment)) {
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

/** 非探索类的终端命令（ls/find/pwd 等归探索组，不算在内） */
export const isShellRunMessage = (message: Message): boolean => {
    return message.type === 'tool'
        && getToolName(message) === TOOL_NAME_RUN_SHELL
        && getGroupableToolKind(message) === null;
};

const SHELL_RUN_KEY = 'shell';

/**
 * 可分组消息的 run key：相邻消息 key 相同才会合并进同一组。
 * 探索类工具统一为 'explore'，MCP 工具按服务名区分为 'mcp:<服务名>'，其余终端命令为 'shell'。
 */
const getRunKey = (message: Message): string | null => {
    if (message.type !== 'tool') {
        return null;
    }

    const mcpServerName = getMcpServerName(message);
    if (mcpServerName) {
        return `mcp:${mcpServerName}`;
    }

    const toolName = getToolName(message);
    if (GROUPABLE_TOOL_NAMES.has(toolName) || getGroupableToolKind(message) !== null) {
        return 'explore';
    }

    if (isShellRunMessage(message)) {
        return SHELL_RUN_KEY;
    }

    return null;
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

/**
 * @param closed run 之后是否已有其它渲染内容。终端组只在 closed 时折叠：
 * 末尾还可能继续追加的终端命令逐条展示，数量不再变化后才收成 Ran N commands
 */
const flushRun = (
    items: RenderItem[],
    run: RunItem[],
    runKey: string | null,
    closed: boolean,
    streamingToolId?: string | null,
): void => {
    if (run.length === 0) {
        return;
    }

    const hasStreamingTool = run.some(({ message }) => isStreamingToolMessage(message, streamingToolId));
    if (run.length < 2 || hasStreamingTool || (runKey === SHELL_RUN_KEY && !closed)) {
        items.push(...toMessageItems(run));
        return;
    }

    const first = run[0].message;
    const last = run[run.length - 1].message;
    items.push({
        kind: 'group',
        id: `tool-group-${first.id}-${last.id}`,
        messages: run.map(({ message }) => message),
        originalStartIndex: run[0].index,
    });
};

export const groupMessages = (
    messages: Message[],
    options: GroupMessagesOptions = {},
): RenderItem[] => {
    const items: RenderItem[] = [];
    let run: RunItem[] = [];
    let runKey: string | null = null;

    messages.forEach((message, index) => {
        const key = getRunKey(message);
        if (key !== null) {
            // 相邻但 key 不同（如 explore → mcp:xxx，或不同 MCP 服务）时先切段
            if (runKey !== null && runKey !== key) {
                flushRun(items, run, runKey, true, options.streamingToolId);
                run = [];
            }
            runKey = key;
            run.push({ message, index });
            return;
        }

        if (isInvisibleCompletedAssistantMessage(message, options.showThinkingText)) {
            return;
        }

        const closed = !isPendingEmptyAssistantMessage(message, options.showThinkingText);
        flushRun(items, run, runKey, closed, options.streamingToolId);
        run = [];
        runKey = null;
        items.push({ kind: 'message', message, originalIndex: index });
    });

    flushRun(items, run, runKey, !!options.tailClosed, options.streamingToolId);

    return items;
};
