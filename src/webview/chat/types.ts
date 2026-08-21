export type AgentMode = 'Agent' | 'Plan' | 'Design';

/** 会话权限自由度档位（与 sema-core 的 PermissionLevel 对齐）：
 *  Ask=每次都询问；AutoEdit=项目内编辑自动放行；AutoRun=安全动作自动放行；
 *  Bypass=放行所有工具调用、跳过全部安全检查（危险） */
export type PermissionLevel = 'Ask' | 'AutoEdit' | 'AutoRun' | 'Bypass';

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

/** tab 栏中的会话元信息 */
export interface SessionMeta {
    id: string;
    title: string;
    processing: boolean;
    /** 是否有待处理的权限/表单弹窗（等待用户响应） */
    waiting: boolean;
    /** 是否为 claw 远程会话（tab 用紫色标识） */
    isClaw?: boolean;
}

export interface SelectedFile {
    path: string;
    name: string;
    isDirectory: boolean;
    startLine?: number;
    endLine?: number;
}

// 发送给 sema-core 的图片附件（= core 的 InputImageAttachment）
export interface ImageAttachment {
    type: 'image';
    data: string;        // 纯 base64（无 data:...;base64, 前缀）
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
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

// 用户输入来源（与 sema-core InputSource 镜像）
export type InputSource = 'user' | 'cron';

export interface Message {
    id: string;
    /** fork 句柄（== 后端 input:processing 的 inputId）；仅本会话内由用户输入创建的消息才有 */
    uuid?: string;
    type: 'user' | 'assistant' | 'tool' | 'system' | 'permission_request' | 'askForm';
    content: any;
    toolName?: string;
    toolArgs?: any;
    reasoning?: string;  // 用于存储思考过程（thinking）
    attachments?: ImageAttachment[];  // 用户消息携带的图片（来自 core input:processing 回吐）
    source?: InputSource;             // 输入来源；'cron' 等非 user 来源在气泡上方显示标签
}

// ─── Fork / 撤销（与 sema-core types/fork 镜像，前端独立定义） ──────────────────
export type ForkFileEffect = 'modify' | 'recreate' | 'delete';

export interface ForkFileChange {
    filePath: string;       // 绝对路径
    displayPath: string;    // 相对工作目录的展示路径
    effect: ForkFileEffect;
    additions: number;
    removals: number;
    binary?: boolean;       // 二进制文件：不展示增删行
}

export interface ForkPreview {
    messageUuid: string;
    canRestoreFiles: boolean;   // false → 无快照锚点，仅可撤销对话
    files: ForkFileChange[];
}

export type ForkResult =
    | { ok: true; sessionId: string; restoredFiles: string[] }
    | { ok: false; error: string };

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
    autoAllowedContent?: string;  // AutoRun 档位下模型自动放行时的提示文字
}
