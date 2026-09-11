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

const stripLeadingCdSegments = (command: string): string => {
    const segments = command.split(/\s+&&\s+/).map(segment => segment.trim()).filter(Boolean);
    let index = 0;
    while (index < segments.length - 1 && /^cd(?:\s|$)/.test(segments[index])) {
        index += 1;
    }
    return segments.slice(index).join(' && ');
};

export const isLsShellCommand = (message: Message): boolean => {
    const command = stripLeadingCdSegments(getToolTitle(message).trim());
    return /^ls(?:\s|$)/.test(command);
};

export const isFindShellCommand = (message: Message): boolean => {
    const command = getToolTitle(message).trim();
    if (!/^find(?:\s|$)/.test(command)) {
        return false;
    }

    return !/(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(command);
};

export const isPwdShellCommand = (message: Message): boolean => {
    const command = getToolTitle(message).trim();
    return /^pwd(?:\s+-(?:L|P))*\s*$/.test(command);
};

export const isExploratoryShellCommand = (message: Message): boolean => {
    const command = getToolTitle(message).trim();
    const segments = command.split(/\s+&&\s+/).map(segment => segment.trim()).filter(Boolean);

    if (segments.length < 2) {
        return false;
    }

    return segments.every(segment => {
        const segmentMessage = {
            ...message,
            content: {
                ...message.content,
                title: segment,
            },
        };

        return isLsShellCommand(segmentMessage)
            || isFindShellCommand(segmentMessage)
            || isPwdShellCommand(segmentMessage);
    });
};

export const getGroupableToolKind = (message: Message): string | null => {
    const toolName = getToolName(message);
    if (toolName === TOOL_NAME_VIEW_FILE) {
        return 'read';
    }
    if (toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT) {
        return 'search';
    }
    if (toolName === TOOL_NAME_RUN_SHELL && isLsShellCommand(message)) {
        return 'list';
    }
    if (toolName === TOOL_NAME_RUN_SHELL && isFindShellCommand(message)) {
        return 'find';
    }
    if (toolName === TOOL_NAME_RUN_SHELL && isPwdShellCommand(message)) {
        return 'path';
    }
    if (toolName === TOOL_NAME_RUN_SHELL && isExploratoryShellCommand(message)) {
        return 'explore';
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
