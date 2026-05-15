export type AgentMode = 'Agent' | 'Plan' | 'Design';

export interface VscodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

declare global {
    interface Window {
        acquireVsCodeApi(): VscodeApi;
        hljs?: any;
    }
}

export interface TokenInfo {
    useTokens: number;          // 当前会话已使用的token数
    maxTokens: number;          // 模型最大token限制
    promptTokens: number;       // 模型最大token限制
}


export interface FileItem {
    path: string;
    isDirectory: boolean;
    isOpen?: boolean; // 是否为已打开的文件
}

export interface FileChange {
    fileName: string;
    fullPath: string;
    additions: number;
    removals: number;
    type: 'write' | 'edit';
    minLine: number;
    isNotebook?: boolean;
}

export interface AppProps {
    vscode: VscodeApi;
}

export interface SelectedFile {
    path: string;
    name: string;
    isDirectory: boolean;
    startLine?: number;
    endLine?: number;
}

// 输入框中 @文件 的高亮区间。start/length 基于纯文本字符偏移。
export interface InputMention {
    start: number;
    length: number;
    path: string;
    isDirectory?: boolean;
    startLine?: number;
    endLine?: number;
}

export interface InputHistoryItem {
    text: string;
    files: SelectedFile[];
    mentions: InputMention[];
    ts: number;
}

export interface TodoItem {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed';
    progressText: string;
}

export interface FileReferenceInfo {
    type: 'file' | 'dir';
    name: string;
    content: string;
}

export interface Message {
    id: string;
    type: 'user' | 'assistant' | 'tool' | 'system' | 'permission_request' | 'askForm';
    content: any;
    toolName?: string;
    toolArgs?: any;
    reasoning?: string;  // 用于存储思考过程（thinking）
}

// Diff Hunk 类型（来自 diff 库）
export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
}

// 新的 Diff Content 格式
export interface DiffContent {
    type: 'diff' | 'new';  
    patch: DiffHunk[];
    diffText: string;
}

export interface ToolContent {
    toolId?: string;
    toolName: string;
    title: string;
    summary?: string;
    content: string | DiffContent;  // 支持字符串（旧格式）或 DiffContent 对象（新格式）
    completed?: boolean;  // false 表示流式中间态，undefined/true 表示完成
}
