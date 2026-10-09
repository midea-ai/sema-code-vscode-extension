import { DiffContent, DiffHunk } from '../types';
import { TOOL_NAME_EDIT_NOTEBOOK, TOOL_NAME_SKILL, TOOL_NAME_RUN_SHELL, TOOL_NAME_FETCH_URL, TOOL_NAME_VIEW_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE } from '../../../utils/tool';

/**
 * 判断是否是Notebook类型
 */
export const isNotebookType = (toolName: string): boolean => {
    return toolName === TOOL_NAME_EDIT_NOTEBOOK;
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
    return toolName === TOOL_NAME_SKILL;
};

/**
 * 判断是否是文件类工具（读/写/补丁/notebook）
 */
export const isFileToolType = (toolName: string): boolean => {
    return toolName === TOOL_NAME_VIEW_FILE
        || toolName === TOOL_NAME_WRITE_FILE
        || toolName === TOOL_NAME_PATCH_FILE
        || isNotebookType(toolName);
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
    if (toolName === TOOL_NAME_RUN_SHELL) {
        return 'Shell Permission';
    } else if (toolName === TOOL_NAME_FETCH_URL) {
        return 'Network Permission';
    } else if (isSkillType(toolName)) {
        return 'Skill Permission';
    } else if (isMcpToolType(toolName)) {
        return 'MCP Tool Permission';
    } else if (isFileToolType(toolName)) {
        return 'File Permission';
    } else {
        // 未知工具兜底：不再冒充文件操作
        return 'Tool Permission';
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
