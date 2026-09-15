/**
 * 「导入」页共享类型：纯数据，无 fs / vscode 依赖，VSCode 宿主与 JB webview 两端共用。
 * 导入只有三种动作：复制文件（Skill 目录、Agent / Command / 规则 md）、MCP 提取 JSON 后调 core add、Hook 合并进 hooks.json。
 */

import type { MCPServerConfig } from '../types/mcp';

export type ImportSource = 'claude' | 'codex' | 'cursor';
export type ImportCategory = 'mcp' | 'skill' | 'agent' | 'command' | 'hook' | 'rule';
export type ImportScope = 'project' | 'user';

export const IMPORT_SOURCES: ImportSource[] = ['claude', 'codex', 'cursor'];
export const IMPORT_CATEGORIES: ImportCategory[] = ['mcp', 'skill', 'agent', 'command', 'hook', 'rule'];

/** 宿主提供的最小文件系统接口：VSCode 用 Node fs，JB 经 callEditor('fileOps') 下沉到 Kotlin */
export interface ImportFs {
    exists(path: string): Promise<boolean>;
    /** UTF-8 读文本；文件不存在或不可读时抛错 */
    readFile(path: string): Promise<string>;
    /** 目录不存在时返回空数组 */
    readDir(path: string): Promise<{ name: string; isDir: boolean }[]>;
    /** 自动创建父目录 */
    writeFile(path: string, content: string): Promise<void>;
    /** 递归复制目录，自动创建父目录（目标已存在时由调用方先判定，不在此覆盖） */
    copyDir(src: string, dst: string): Promise<void>;
}

/** 路径根：home 必有；project 无工作区时为空；sep 为宿主路径分隔符 */
export interface ImportRoots {
    home: string;
    project?: string;
    sep: string;
}

/** 写入侧依赖的 sema-core 公开 API 子集（VSCode 用 coreManager，JB 用 RemoteCore） */
export interface ImportCore {
    addMCPServer(config: any): Promise<any>;
    getMCPServerInfo(): Promise<any[]>;
    getSkillsInfo(refresh?: boolean): Promise<any>;
    getAgentsInfo(refresh?: boolean): Promise<any>;
    getCommandsInfo(refresh?: boolean): Promise<any>;
    getHooksInfo(refresh?: boolean): Promise<any>;
    getRuleInfo(refresh?: boolean): Promise<any>;
}

export type ImportPayload =
    /** 原样复制：Skill 整目录、Agent / Command / 规则 md */
    | { kind: 'copy'; src: string; dst: string; dir: boolean }
    /** 提取后调 core addMCPServer（scope 执行时按条目 scope 补上） */
    | { kind: 'mcp'; config: Omit<MCPServerConfig, 'scope'> }
    /** 合并进目标 hooks.json */
    | { kind: 'hook'; event: string; matcher?: string; command: string; timeout?: number; dstFile: string };

export interface ImportItem {
    /** 稳定 id：category:scope:name，UI 勾选与执行回传都靠它 */
    id: string;
    category: ImportCategory;
    scope: ImportScope;
    name: string;
    detail?: string;
    sourcePath: string;
    /** 目标位置已存在同名项：UI 标「已存在」、默认不勾且不可勾 */
    exists: boolean;
    payload: ImportPayload;
}

/** 类别预览：不支持或没找到的类别 items 为空，面板直接不显示 */
export interface CategoryPreview {
    category: ImportCategory;
    sourcePaths: string[];
    items: ImportItem[];
}

export interface ImportPreview {
    source: ImportSource;
    hasProject: boolean;
    categories: CategoryPreview[];
}

/** 来源探测结果：只判断配置目录是否存在，不预读内容 */
export interface SourceStatus {
    source: ImportSource;
    detected: boolean;
}

export interface ImportResult {
    imported: number;
    skipped: number;
    failed: number;
}
