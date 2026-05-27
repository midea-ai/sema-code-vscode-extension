import { BUILTIN_SHORTCUT_COMMANDS, ShortcutCommand } from '../../../../../utils/command';
import { CommandConfig } from '../../../../config/types/command';
import { SkillConfig } from '../../../../config/types/skill';
import { AgentConfig } from '../../../../config/types/agent';

// 存储自定义命令（由后端推送更新）
let customCommands: ShortcutCommand[] = [];

// 存储技能（由后端推送更新）
let skills: ShortcutCommand[] = [];

// 存储子代理（由后端推送更新）
let agents: ShortcutCommand[] = [];

/**
 * 由后端推送自定义命令时调用，更新自定义命令列表
 */
export const setCustomCommands = (commands: CommandConfig[]) => {
    customCommands = commands.map(cmd => ({
        text: cmd.name,
        desc: cmd.description,
        isCustom: true,
        category: 'command'
    }));
};

/**
 * 由后端推送技能时调用，更新技能列表
 */
export const setSkills = (skillList: SkillConfig[]) => {
    skills = skillList.map(skill => ({
        text: skill.name,
        desc: skill.description,
        category: 'skill'
    }));
};

/**
 * 由后端推送子代理时调用，更新子代理列表（过滤内置 agent）
 */
export const setAgents = (agentList: AgentConfig[]) => {
    agents = agentList
        .filter(agent => agent.locate !== 'builtin')
        .map(agent => ({
            text: agent.name,
            desc: agent.description,
            category: 'agent'
        }));
};

/**
 * 获取所有命令（内置 + 自定义 + 技能 + 子代理）
 */
const getAllCommands = (): ShortcutCommand[] => {
    return [
        ...BUILTIN_SHORTCUT_COMMANDS.map(cmd => ({ send: false, category: 'command' as const, ...cmd })),
        ...customCommands,
        ...skills,
        ...agents
    ];
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
 * 命令名或描述包含查询字符串即命中；排序优先级：
 *   命令名前缀 > 描述前缀 > 命令名包含 > 描述包含。
 * 同优先级内：完全匹配 > 名称更短 > 原顺序。
 */
export const filterShortcutCommands = (
    commands: ShortcutCommand[],
    searchQuery: string
): ShortcutCommand[] => {
    if (!searchQuery) {
        return commands;
    }

    const query = searchQuery.toLowerCase();

    type Ranked = { cmd: ShortcutCommand; idx: number; rank: number };
    const matched: Ranked[] = [];

    commands.forEach((cmd, idx) => {
        const text = cmd.text.toLowerCase();
        const desc = (cmd.desc ?? '').toLowerCase();

        let rank: number;
        if (text.startsWith(query)) {
            rank = 0;
        } else if (desc.startsWith(query)) {
            rank = 1;
        } else if (text.includes(query)) {
            rank = 2;
        } else if (desc.includes(query)) {
            rank = 3;
        } else {
            return;
        }
        matched.push({ cmd, idx, rank });
    });

    return matched
        .sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            const aText = a.cmd.text.toLowerCase();
            const bText = b.cmd.text.toLowerCase();
            const aExact = aText === query ? 0 : 1;
            const bExact = bText === query ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            if (aText.length !== bText.length) return aText.length - bText.length;
            return a.idx - b.idx;
        })
        .map(({ cmd }) => cmd);
};

export const getFilteredShortcutCommands = (searchQuery: string) => {
    return filterShortcutCommands(getAllCommands(), searchQuery);
};
