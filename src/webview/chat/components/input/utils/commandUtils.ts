import { BUILTIN_SHORTCUT_COMMANDS, ShortcutCommand } from '../../../../../utils/command';
import { CommandConfig } from '../../../../config/types/command';

// 存储自定义命令（由后端推送更新）
let customCommands: ShortcutCommand[] = [];

/**
 * 由后端推送自定义命令时调用，更新自定义命令列表
 */
export const setCustomCommands = (commands: CommandConfig[]) => {
    customCommands = commands.map(cmd => ({
        text: cmd.name,
        desc: cmd.description,
        isCustom: true
    }));
};

/**
 * 获取所有命令（内置 + 自定义）
 */
const getAllCommands = (): ShortcutCommand[] => {
    return [...BUILTIN_SHORTCUT_COMMANDS.map(cmd => ({ send: false, ...cmd })), ...customCommands];
};

/**
 * 获取所有需要高亮的命令列表
 */
export const getHighlightCommands = () => {
    return getAllCommands().map(command => '/' + command.text);
};

/**
 * 检查文本是否包含高亮命令
 */
export const getHighlightedCommand = (text: string) => {
    const trimmedText = text.trim();
    const highlightCommands = getHighlightCommands();
    const matchedCommand = highlightCommands.find(cmd => trimmedText.startsWith(cmd));

    if (matchedCommand) {
        const startPos = text.indexOf(matchedCommand);
        const endPos = startPos + matchedCommand.length;

        return {
            command: matchedCommand,
            startPos: startPos >= 0 ? startPos : 0,
            endPos: endPos
        };
    }

    return null;
};

/**
 * 检查输入文本是否与某个命令完全匹配
 */
export const isExactCommandMatch = (text: string): boolean => {
    const trimmedText = text.trim();
    return getHighlightCommands().includes(trimmedText);
};

/**
 * 根据搜索查询过滤快捷命令
 */
export const getFilteredShortcutCommands = (searchQuery: string) => {
    const allCommands = getAllCommands();

    if (!searchQuery) {
        return allCommands;
    }

    return allCommands.filter(cmd =>
        cmd.text.toLowerCase().startsWith(searchQuery.toLowerCase())
    );
};
