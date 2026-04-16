/**
 * Mock messages for preview/debug mode.
 * Covers all message types and block components for style alignment.
 *
 * Usage:
 *   PREVIEW_COMPONENTS = null          → 显示所有组件
 *   PREVIEW_COMPONENTS = ['Edit','Bash'] → 只显示指定组件
 *   PREVIEW_COMPONENTS = []            → 关闭预览（正常模式）
 */
import { Message } from '../types';

/** 手动切换预览范围：null = 全部，['xx'] = 指定组件，[] = 关闭 */
export const PREVIEW_COMPONENTS: string[] | null = [];

let id = 0;
const nextId = () => `mock-${++id}`;

export const mockMessageMap: Record<string, Message[]> = {
    UserInput: [
        {
            id: nextId(),
            type: 'user',
            content: '帮我看一下 src/utils/config.ts 这个文件的逻辑，然后优化一下性能',
        },
    ],

    FileReference: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'file_reference',
                content: ['src/utils/config.ts', 'src/utils/configCache.ts', 'src/app/index.ts'],
            },
        },
    ],

    AssistantThinking: [
        {
            id: nextId(),
            type: 'assistant',
            content: { content: '', completed: false },
            reasoning: '让我先读取这个文件，了解它的结构和逻辑，然后分析性能瓶颈。\n\n我需要关注以下几点：\n1. 是否有不必要的重复计算\n2. 数据结构是否合理\n3. 是否有可以缓存的结果',
        },
    ],

    Read: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Read',
            content: {
                toolId: 'read-1',
                toolName: 'Read',
                title: 'src/utils/config.ts:1-30',
                content: '',
            },
        },
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Read',
            content: {
                toolId: 'read-2',
                toolName: 'Read',
                title: '/Users/user/outside-project/image.jpg',
                content: '',
            },
        },
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Read',
            content: {
                toolId: 'read-3',
                toolName: 'Read',
                title: 'notebooks/analysis.ipynb:1-10',
                content: '# Notebook cell contents...',
            },
        },
    ],

    Glob: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Glob',
            content: {
                toolId: 'glob-1',
                toolName: 'Glob',
                title: 'src/**/*.config.ts',
                summary: '3 files found',
                content: 'src/utils/config.ts\nsrc/app/app.config.ts\nsrc/test/test.config.ts',
            },
        },
    ],

    Grep: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Grep',
            content: {
                toolId: 'grep-1',
                toolName: 'Grep',
                title: 'getConfig',
                summary: '5 files matched',
                content: 'src/utils/config.ts:12: export function getConfig()\nsrc/app/index.ts:5: import { getConfig } from "../utils/config"\nsrc/app/index.ts:18: const cfg = getConfig()\nsrc/test/config.test.ts:8: getConfig()\nsrc/test/config.test.ts:15: getConfig("custom.json")',
            },
        },
    ],

    McpTool: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'mcp__github__search_repositories',
            content: {
                toolId: 'mcp-1',
                toolName: 'mcp__github__search_repositories',
                title: 'query: sema-code language:typescript',
                summary: '2 repositories found',
                content: 'sema-code/vscode-extension ⭐ 128\nsema-code/cli ⭐ 56',
            },
        },
    ],

    TaskStop: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'TaskStop',
            content: {
                toolId: 'task-stop-1',
                toolName: 'TaskStop',
                title: 'a3f2b1c0',
                content: 'npm run dev · stopped',
            },
        },
    ],

    TaskOutput: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'TaskOutput',
            content: {
                toolId: 'task-output-1',
                toolName: 'TaskOutput',
                title: 'a3f2b1c0',
                content: '[12:00:01] Starting compilation...\n[12:00:03] Found 0 errors. Watching for file changes.\n[12:00:15] File change detected. Starting incremental compilation...\n[12:00:16] Found 0 errors. Watching for file changes.\n[12:00:15] File change detected. Starting incremental compilation...\n[12:00:16] Found 0 errors. Watching for file changes.',
            },
        },
    ],

    Edit: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Edit',
            content: {
                toolId: 'edit-1',
                toolName: 'Edit',
                title: 'src/utils/config.ts',
                content: {
                    type: 'diff' as const,
                    patch: [
                        {
                            oldStart: 10,
                            oldLines: 5,
                            newStart: 10,
                            newLines: 7,
                            lines: [
                                ' import { readFileSync } from "fs";',
                                '-const config = JSON.parse(readFileSync(configPath, "utf-8"));',
                                '-export function getConfig() {',
                                '-    return config;',
                                '-}',
                                '+const configCache = new Map<string, any>();',
                                '+export function getConfig(path: string = configPath) {',
                                '+    if (configCache.has(path)) {',
                                '+        return configCache.get(path);',
                                '+    }',
                                '+    const config = JSON.parse(readFileSync(path, "utf-8"));',
                                '+    configCache.set(path, config);',
                                '+    return config;',
                                '+}',
                            ],
                        },
                    ],
                    diffText: '',
                },
            },
        },
    ],

    Write: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Write',
            content: {
                toolId: 'write-1',
                toolName: 'Write',
                title: 'src/utils/configCache.ts',
                content: {
                    type: 'new' as const,
                    patch: [
                        {
                            oldStart: 0,
                            oldLines: 0,
                            newStart: 1,
                            newLines: 6,
                            lines: [
                                '+export class ConfigCache {',
                                '+    private store = new Map<string, any>();',
                                '+    get(key: string) { return this.store.get(key); }',
                                '+    set(key: string, val: any) { this.store.set(key, val); }',
                                '+    has(key: string) { return this.store.has(key); }',
                                '+}',
                            ],
                        },
                    ],
                    diffText: '',
                },
            },
        },
    ],

    NotebookEdit: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'NotebookEdit',
            content: {
                toolId: 'notebook-edit-1',
                toolName: 'NotebookEdit',
                title: 'notebooks/analysis.ipynb cell:4',
                content: {
                    type: 'diff' as const,
                    patch: [
                        {
                            oldStart: 1,
                            oldLines: 3,
                            newStart: 1,
                            newLines: 5,
                            lines: [
                                ' import pandas as pd',
                                '-df = pd.read_csv("data.csv")',
                                '-print(df.head())',
                                '+import numpy as np',
                                '+df = pd.read_csv("data.csv", dtype={"id": np.int64})',
                                '+df = df.dropna(subset=["value"])',
                                '+print(f"Loaded {len(df)} rows")',
                                '+df.head()',
                            ],
                        },
                    ],
                    diffText: '',
                },
            },
        },
    ],

    Bash: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Bash',
            content: {
                toolId: 'bash-1',
                toolName: 'Bash',
                title: 'npm test -- --coverage',
                content: 'PASS  src/utils/config.test.ts\n  ✓ should load config (12ms)\n  ✓ should validate schema (8ms)\n  ✓ should merge defaults (5ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nTime:        1.234s',
            },
        },
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Bash',
            content: {
                toolId: 'bash-2',
                toolName: 'Bash',
                title: 'npx eslint src/utils/config.ts',
                content: '',
            },
        },
    ],

    AssistantMarkdown: [
        {
            id: nextId(),
            type: 'assistant',
            content: {
                content: `我已经完成了以下优化：

1. **添加了缓存层** - 使用 \`Map\` 缓存已解析的配置，避免重复 IO 和 JSON 解析
2. **新建了 \`configCache.ts\`** - 抽离缓存逻辑为独立模块

\`\`\`typescript
// 优化前：每次调用都读取文件
const config = JSON.parse(readFileSync(configPath, "utf-8"));

// 优化后：首次读取后缓存
const configCache = new Map<string, any>();
export function getConfig(path: string) {
    if (configCache.has(path)) return configCache.get(path);
    // ...
}
\`\`\`

> 测试全部通过，共 3 个用例。`,
            },
        },
        {
            id: nextId(),
            type: 'assistant',
            content: {
                content: 'Lint 检查通过，没有发现任何问题。',
            },
        },
    ],

    AskUserQuestion: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'AskUserQuestion',
            content: {
                toolId: 'ask-1',
                toolName: 'AskUserQuestion',
                title: 'User Response',
                content: '· Which library to use?: → Zod\n· Auth method?: → JWT',
            },
        },
    ],

    PermissionRefused: [
        {
            id: nextId(),
            type: 'permission_request',
            content: {
                toolName: 'Bash',
                title: 'rm -rf node_modules && npm install',
                content: '',
                action: 'refuse',
                refuseMessage: '请不要删除 node_modules，只运行 npm install',
            },
        },
    ],

    PermissionInterrupted: [
        {
            id: nextId(),
            type: 'permission_request',
            content: {
                toolId: 'write-1',
                toolName: 'Write',
                title: 'src/utils/configCache.ts',
                content: {
                    type: 'new' as const,
                    patch: [
                        {
                            oldStart: 0,
                            oldLines: 0,
                            newStart: 1,
                            newLines: 6,
                            lines: [
                                '+export class ConfigCache {',
                                '+    private store = new Map<string, any>();',
                                '+    get(key: string) { return this.store.get(key); }',
                                '+    set(key: string, val: any) { this.store.set(key, val); }',
                                '+    has(key: string) { return this.store.has(key); }',
                                '+}',
                            ],
                        },
                    ],
                    diffText: '',
                },
                action: 'interrupted'
            },
        },
    ],

    ToolError: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'tool_error',
                toolName: 'Bash',
                title: 'npm run build',
                content: 'Error: Cannot find module \'typescript\'\n    at Function.Module._resolveFilename (node:internal/modules/cjs/loader:1075:15)',
            },
        },
    ],

    Interrupted: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'interrupted',
                content: '[Request interrupted by user]',
            },
        },
    ],

    Compact: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'compact',
                content: 'Compacted',
            },
        },
    ],

    Clear: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'clear',
                content: '(no content)',
            },
        },
    ],

    SessionError: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'session_error',
                content: 'Session expired. Please restart the conversation.',
            },
        },
    ],

    TaskEndCompleted: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'task_end',
                status: 'completed',
                summary: 'Bash "ls -la /tmp" completed',
            },
        },
    ],

    TaskEndFailed: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'task_end',
                status: 'failed',
                summary: 'Agent "Analyze codebase and generate a detailed repor..." failed',
            },
        },
    ],

    TaskEndKilled: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'task_end',
                status: 'killed',
                summary: 'Agent "Refactor all API endpoints to use new schema" killed',
            },
        },
    ],

    Agent: [
        {
            id: nextId(),
            type: 'tool',
            toolName: 'Agent',
            content: {
                taskId: 'agent-mock-1',
                subagent_type: 'Explore',
                description: 'Search config usage',
                prompt: 'Find all usages of getConfig in the codebase',
                status: 'completed',
                summary: 'Found 12 usages of getConfig across 5 files.\n- src/app/index.ts (3 calls)\n- src/utils/loader.ts (4 calls)\n- src/test/config.test.ts (5 calls)',
                taskMessages: [
                    {
                        id: nextId(),
                        type: 'user',
                        content: '帮我看一下 src/utils/config.ts 这个文件的逻辑，然后优化一下性能',
                    },
                    {
                        id: nextId(),
                        type: 'assistant',
                        content: { content: '', completed: false },
                        reasoning: '让我先读取这个文件，了解它的结构和逻辑，然后分析性能瓶颈。我需要关注以下几点：\n1. 是否有不必要的重复计算\n2. 数据结构是否合理\n3. 是否有可以缓存的结果',
                    },
                    {
                        id: nextId(),
                        type: 'tool',
                        toolName: 'Glob',
                        content: {
                            toolId: 'glob-1',
                            toolName: 'Glob',
                            title: 'src/**/*.config.ts',
                            summary: '3 files found',
                            content: 'src/utils/config.ts\nsrc/app/app.config.ts\nsrc/test/test.config.ts',
                        },
                    },
                    {
                        id: nextId(),
                        type: 'system',
                        content: {
                            type: 'interrupted',
                            content: '[Request interrupted by user]',
                        },
                    },
                ],
            },
        },
    ],

    PlanImplement: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'plan_implement',
                planFilePath: '/workspace/plan.md',
                planContent: `# Config Optimization Plan

## Steps
1. ~~Add caching layer~~ ✅
2. ~~Create ConfigCache module~~ ✅
3. Update all callers to use new API
4. Add cache invalidation logic
5. Write integration tests`,
            },
        },
    ],
};

/**
 * 根据 PREVIEW_COMPONENTS 生成最终的 mock 消息列表
 *   null  → 全部组件
 *   ['Edit','Bash'] → 只含指定组件
 *   []    → 空数组（关闭预览）
 */
export function getPreviewMessages(): Message[] {
    if (PREVIEW_COMPONENTS !== null && PREVIEW_COMPONENTS.length === 0) {
        return [];
    }
    const keys = PREVIEW_COMPONENTS ?? Object.keys(mockMessageMap);
    return keys.flatMap((k) => mockMessageMap[k] ?? []);
}

/** Mock dialog / 状态组件数据 */
export const mockDialogMap: Record<string, any[]> = {
    ProcessingSpinner: [
        {
            accumulatedSeconds: 5,
            in_progress: '正在分析代码结构…',
            next_progress: '优化配置缓存逻辑',
        },
    ],
    ModelConfigReminder: [
        {
            message: '未检测到有效的模型配置，请先配置 API Key 和模型信息。',
        },
    ],
    PermissionDialog: [
        {
            type: 'permission',
            data: {
                agentId: 'mock-agent-1',
                toolId: 'mock-tool-perm-1',
                toolName: 'Bash',
                title: 'rm -rf node_modules && npm install',
                content: '重装依赖',
                options: {
                    agree: '确认',
                    allow: '确认，本项目不再询问 `npm` 开头的命令',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
        {
            type: 'permission',
            data: {
                agentId: 'main',
                toolId: 'write-2',
                toolName: 'Write',
                title: 'src/utils/configCache.ts',
                content: {
                    type: 'new' as const,
                    patch: [
                        {
                            oldStart: 0,
                            oldLines: 0,
                            newStart: 1,
                            newLines: 6,
                            lines: [
                                '+export class ConfigCache {',
                                '+    private store = new Map<string, any>();',
                                '+    get(key: string) { return this.store.get(key); }',
                                '+    set(key: string, val: any) { this.store.set(key, val); }',
                                '+    has(key: string) { return this.store.has(key); }',
                                '+}',
                            ],
                        },
                    ],
                    diffText: '',
                },
                options: {
                    agree: '确认',
                    allow: '确认, 本次会话不再询问文件编辑',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
    ],
    WebFetchPermissionDialog: [
        {
            type: 'permission',
            data: {
                agentId: 'main',
                toolId: 'webfetch-1',
                toolName: 'WebFetch',
                title: 'WebFetch',
                content: 'https://github.com/midea-ai/sema-code-core',
                options: {
                    agree: '确认',
                    allow: '确认，本项目不再询问 github.com 域名',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
    ],
    AskQuestionDialog: [
        {
            type: 'askQuestion',
            data: {
                agentId: 'mock-agent-2',
                questions: [
                    {
                        question: '请选择您希望在2048游戏中包含的核心模块（可多选）：',
                        header: '核心模块',
                        multiSelect: true,
                        options: [
                            { label: '游戏核心逻辑', description: '包含游戏板状态管理、数字移动合并算法、游戏规则实现等核心功能' },
                            { label: 'UI界面渲染', description: '游戏界面显示、数字方块渲染、分数显示等视觉界面' },
                            { label: '输入控制系统', description: '键盘方向键控制、触摸滑动控制等用户交互' },
                            { label: '动画效果', description: '方块移动动画、合并动画、新方块出现动画等视觉效果' },
                        ],
                    },
                    {
                        question: '请选择您希望在2048游戏中包含的扩展功能（可多选）：',
                        header: '扩展功能',
                        multiSelect: true,
                        options: [
                            { label: '数据存储', description: '最高分记录、游戏状态保存等本地存储功能' },
                            { label: '声音效果', description: '移动音效、合并音效、游戏结束音效等音频反馈' },
                            { label: '主题系统', description: '多种颜色主题、深色/浅色模式切换等个性化设置' },
                            { label: '游戏设置', description: '难度调节、游戏重新开始、暂停等辅助功能' },
                        ],
                    },
                ],
            },
            isBackground: false,
        },
    ],
    PlanExitDialog: [
        {
            type: 'planExit',
            data: {
                agentId: 'mock-agent-3',
                planFilePath: '/workspace/plan.md',
                planContent: '# Optimization Plan\n\n## Steps\n1. ~~Analyze codebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write tests',
                options: {
                    startEditing: '开始代码编辑',
                    clearContextAndStart: '清理上下文，并开始代码编辑',
                }
            },
            isBackground: false,
        },
    ],
    TodosPanel: [
        {
            todos: [
                { content: '分析代码结构', status: 'completed' },
                { content: '添加缓存层', status: 'completed' },
                { content: '更新所有调用方', status: 'in_progress', activeForm: '正在更新 src/app/index.ts ...' },
                { content: '添加缓存失效逻辑', status: 'pending' },
                { content: '编写集成测试', status: 'pending' },
            ],
        },
    ],
    FileChangesPanel: [
        {
            changes: [
                { fileName: 'config.ts', fullPath: 'src/utils/config.ts', additions: 12, removals: 5, type: 'edit', minLine: 10 },
                { fileName: 'configCache.ts', fullPath: 'src/utils/configCache.ts', additions: 6, removals: 0, type: 'write', minLine: 1 },
                { fileName: 'index.ts', fullPath: 'src/app/index.ts', additions: 3, removals: 2, type: 'edit', minLine: 5 },
                { fileName: 'analysis.ipynb', fullPath: 'notebooks/analysis.ipynb', additions: 0, removals: 0, type: 'edit', minLine: 1, isNotebook: true },
            ],
        },
    ],
    BtwDialog: [
        {
            type: 'btw',
            data: {
                question: '你知道可以用 Map 代替对象来做缓存吗？',
                content: '使用 `Map` 相比普通对象有以下优势：\n\n1. **键可以是任意类型**\n2. **保持插入顺序**\n3. **内置 `size` 属性**\n\n```typescript\nconst cache = new Map<string, any>();\ncache.set("key", value);\n```',
            },
            isBackground: false,
        },
    ],
};

/** 根据 PREVIEW_COMPONENTS 过滤需要预览的 dialog 组件 key */
export function getPreviewDialogKeys(): string[] {
    if (PREVIEW_COMPONENTS !== null && PREVIEW_COMPONENTS.length === 0) return [];
    const allKeys = Object.keys(mockDialogMap);
    return PREVIEW_COMPONENTS ? PREVIEW_COMPONENTS.filter(k => allKeys.includes(k)) : allKeys;
}

/** 指定 key 是否在预览范围内 */
export function isPreviewActive(key: string): boolean {
    return PREVIEW_MODE && (PREVIEW_COMPONENTS === null || PREVIEW_COMPONENTS.includes(key));
}

/** 是否开启预览 */
export const PREVIEW_MODE = PREVIEW_COMPONENTS === null || (PREVIEW_COMPONENTS as string[]).length > 0;
