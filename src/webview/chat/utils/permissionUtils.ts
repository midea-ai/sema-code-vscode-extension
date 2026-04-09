import { DiffContent, DiffHunk } from '../types';

/**
 * 判断是否是Notebook类型
 */
export const isNotebookType = (toolName: string): boolean => {
    return toolName === 'NotebookEdit';
};

/**
 * 判断是否是MCP工具类型
 */
export const isMcpToolType = (toolName: string): boolean => {
    return toolName.startsWith('mcp__');
};

/**
 * 判断是否是Skill类型
 */
export const isSkillType = (toolName: string): boolean => {
    return toolName === 'Skill';
};

/**
 * 解析MCP工具名
 */
export const parseMcpToolName = (toolName: string): { mcpName: string; toolName: string } => {
    if (!isMcpToolType(toolName)) {
        return { mcpName: '', toolName: '' };
    }

    const parts = toolName.split('__');
    if (parts.length >= 3) {
        return {
            mcpName: parts[1],
            toolName: parts[2]
        };
    }
    return { mcpName: '', toolName: '' };
};

/**
 * 获取权限类型标题
 */
export const getPermissionTitle = (toolName: string): string => {
    if (toolName === 'Bash') {
        return 'Bash Permission';
    } else if (isSkillType(toolName)) {
        return 'Skill Permission';
    } else if (isMcpToolType(toolName)) {
        return 'MCP Tool Permission';
    } else {
        return 'File Permission';
    }
};

/**
 * 将字符串内容转为 DiffContent 格式
 */
export const stringToDiffContent = (content: string): DiffContent => {
    const lines = content.split('\n');
    return {
        type: 'new',
        patch: [{
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: lines.length,
            lines: lines.map(l => '+' + l)
        }],
        diffText: ''
    };
};
