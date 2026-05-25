import { Message } from '../types';
import {
    TOOL_NAME_RUN_SHELL,
    TOOL_NAME_SEARCH_CONTENT,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_VIEW_FILE,
} from '../../../utils/tool';

export type RenderItem =
    | { kind: 'message'; message: Message; originalIndex: number }
    | { kind: 'group'; id: string; messages: Message[]; originalStartIndex: number };

interface GroupMessagesOptions {
    streamingToolId?: string | null;
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

export const isLsShellCommand = (message: Message): boolean => {
    const command = getToolTitle(message).trim();
    return /^ls(?:\s|$)/.test(command);
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
    return null;
};

const isGroupableToolMessage = (message: Message): boolean => {
    if (message.type !== 'tool') {
        return false;
    }

    const toolName = getToolName(message);
    return GROUPABLE_TOOL_NAMES.has(toolName) || getGroupableToolKind(message) === 'list';
};

const isStreamingToolMessage = (message: Message, streamingToolId?: string | null): boolean => {
    return message.content?.completed === false || (!!streamingToolId && message.id === streamingToolId);
};

const isInvisibleCompletedAssistantMessage = (message: Message): boolean => {
    if (message.type !== 'assistant' || message.content?.completed === false) {
        return false;
    }

    const content = message.content?.content;
    const reasoning = message.reasoning;
    return (!content || content.trim().length === 0) && (!reasoning || reasoning.trim().length === 0);
};

const toMessageItems = (run: RunItem[]): RenderItem[] => {
    return run.map(({ message, index }) => ({
        kind: 'message' as const,
        message,
        originalIndex: index,
    }));
};

const flushRun = (
    items: RenderItem[],
    run: RunItem[],
    streamingToolId?: string | null,
): void => {
    if (run.length === 0) {
        return;
    }

    const hasStreamingTool = run.some(({ message }) => isStreamingToolMessage(message, streamingToolId));
    if (run.length < 2 || hasStreamingTool) {
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

    messages.forEach((message, index) => {
        if (isGroupableToolMessage(message)) {
            run.push({ message, index });
            return;
        }

        if (isInvisibleCompletedAssistantMessage(message)) {
            return;
        }

        flushRun(items, run, options.streamingToolId);
        run = [];
        items.push({ kind: 'message', message, originalIndex: index });
    });

    flushRun(items, run, options.streamingToolId);

    return items;
};
