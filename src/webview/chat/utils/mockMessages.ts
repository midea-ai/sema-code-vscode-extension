/**
 * Mock messages for preview/debug mode.
 * Covers all message types and block components for style alignment.
 *
 * Usage:
 *   PREVIEW_COMPONENTS = null          → 显示所有组件
 *   PREVIEW_COMPONENTS = ['Edit','Write'] → 只显示指定组件
 *   PREVIEW_COMPONENTS = []            → 关闭预览（正常模式）
 */
import { Message } from '../types';
import {
    TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_VIEW_FILE,
    TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_EDIT_NOTEBOOK,
    TOOL_NAME_RUN_SHELL, TOOL_NAME_FETCH_URL, TOOL_NAME_STOP_BG_JOB, TOOL_NAME_PEEK_BG_JOB,
    TOOL_NAME_PICK_OPTION, TOOL_NAME_SKILL
} from '../../../utils/tool';

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
            toolName: TOOL_NAME_VIEW_FILE,
            content: {
                toolId: 'read-1',
                toolName: TOOL_NAME_VIEW_FILE,
                title: 'src/utils/config.ts:1-30',
                content: '',
            },
        },
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_VIEW_FILE,
            content: {
                toolId: 'read-2',
                toolName: TOOL_NAME_VIEW_FILE,
                title: '/Users/user/outside-project/image.jpg',
                content: '',
            },
        },
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_VIEW_FILE,
            content: {
                toolId: 'read-3',
                toolName: TOOL_NAME_VIEW_FILE,
                title: 'notebooks/analysis.ipynb:1-10',
                content: '# Notebook cell contents...',
            },
        },
    ],

    Glob: [
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_SEARCH_FILES,
            content: {
                toolId: 'glob-1',
                toolName: TOOL_NAME_SEARCH_FILES,
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
            toolName: TOOL_NAME_SEARCH_CONTENT,
            content: {
                toolId: 'search_content-1',
                toolName: TOOL_NAME_SEARCH_CONTENT,
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

    BackgroundJob: [
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_PEEK_BG_JOB,
            content: {
                toolId: 'background-job-1',
                toolName: TOOL_NAME_PEEK_BG_JOB,
                title: 'a3f2b1c0',
                content: '[12:00:01] Starting compilation...\n[12:00:03] Found 0 errors. Watching for file changes.\n[12:00:15] File change detected. Starting incremental compilation...\n[12:00:16] Found 0 errors. Watching for file changes.\n[12:00:15] File change detected. Starting incremental compilation...\n[12:00:16] Found 0 errors. Watching for file changes.',
            },
        },
    ],

    StopBackgroundJob: [
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_STOP_BG_JOB,
            content: {
                toolId: 'task-stop-1',
                toolName: TOOL_NAME_STOP_BG_JOB,
                title: 'a3f2b1c0',
                content: 'npm run dev · stopped',
            },
        },
    ],


    Edit: [
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_PATCH_FILE,
            content: {
                toolId: 'edit-1',
                toolName: TOOL_NAME_PATCH_FILE,
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
            toolName: TOOL_NAME_WRITE_FILE,
            content: {
                toolId: 'write-1',
                toolName: TOOL_NAME_WRITE_FILE,
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
            toolName: TOOL_NAME_EDIT_NOTEBOOK,
            content: {
                toolId: 'notebook-edit-1',
                toolName: TOOL_NAME_EDIT_NOTEBOOK,
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

    Shell: [
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_RUN_SHELL,
            content: {
                toolId: 'bash-1',
                toolName: TOOL_NAME_RUN_SHELL,
                summary: '读取 Excel 所有工作表名称并打印',
                title: `python3 -c "
import pandas as pd
import openpyxl
# Step 1: Read all sheet names and data
wb = openpyxl.load_workbook('/Users/zhoujie195/ReactProject/sema-design-test/src/估价样例.xlsx', data_only=False)
print('=== Sheet Names ===')
print(wb.sheetnames)
print()
" 2>&1`,
                content: 'PASS  src/utils/config.test.ts\n  ✓ should load config (12ms)\n  ✓ should validate schema (8ms)\n  ✓ should merge defaults (5ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 tbvjhsbvhktal\nTime:        1.234s',
            },
        },
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_RUN_SHELL,
            content: {
                toolId: 'bash-2',
                toolName: TOOL_NAME_RUN_SHELL,
                summary: '对 config.ts 运行 eslint 检查，这是一段足够长的摘要用于验证页面太窄时的省略号效果',
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
                content: `### 4.1 多租户隔离模型

当 Sema Core 被嵌入多租户环境时（例如一个同时服务多个用户的 Agent 平台），多个引擎实例必须在同一进程内并发运行。传统的全局单例设计中，$n$ 个 Agent 实例 $\\mathcal{A} = \\{A_1, A_2, \\ldots, A_n\\}$ 共享状态空间 $\\mathcal{S}$，任意 $A_i$ 的状态写入 $A_i \\xrightarrow{w} \\mathcal{S}$ 都可能被 $A_j\\ (j \\neq i)$ 的读操作 $A_j \\xrightarrow{r} \\mathcal{S}$ 观测到，产生不可预期的状态污染——一个用户的对话历史泄露到另一个用户的上下文中，或一个实例的中断操作意外终止了另一个实例的任务。

Sema Core 采用 Node.js 的 **AsyncLocalStorage（ALS）** 机制实现按实例的状态隔离。每个引擎实例 $E_i$ 拥有独立的资源束：

$$\\mathcal{R}_i = \\langle \\text{EventBus}_i,\\ \\text{StateManager}_i,\\ \\text{MCPManager}_i,\\ \\text{Config}_i \\rangle$$

Bash 层针对管道组合和命令注入两类风险分别处理：

$$P_{\\text{Bash}}(c) = \\text{allow} \\iff \\begin{cases} \\text{head}(c) \\in \\mathcal{W} & c \\text{ 为单一命令} \\\\ \\forall i:\\ \\text{head}(c_i) \\in \\mathcal{W} & c = c_1 \\mid \\cdots \\mid c_p \\text{ 为管道} \\end{cases}$$`,
            },
        },
        {
            id: nextId(),
            type: 'assistant',
            content: {
                content: `## 图片渲染示例
远程图片（点击在浏览器打开）：
![shields](https://img.shields.io/badge/build-passing-brightgreen)
<img src="https://github.com/midea-ai/sema-code-core/raw/main/images/semacode-logo.png" />
`,
            },
        },
        {
            id: nextId(),
            type: 'assistant',
            content: {
                content: `- **概述**
  - [项目概述](https://midea-ai.github.io/sema-code-core/#/wiki/overview/project)
  - [架构设计](sort.py)
`,
            },
        },
        {
            id: nextId(),
            type: 'assistant',
            content: {
                content: `**Layout 在 iiQWorks.PLC UNI 中指的是 VS（Visual Components / iiQWorks.Sim）的 3D 场景视图**，用于查看和操作虚拟设备模型。

关键引用：
> **"PLC工程无法单独保存，layout中新建任意元素才可保存工程"** — 来自 \`(CN) iiQWorks.PLC UNI 1.0.pdf\` p.20 [1]

### 请确认

你说的 **"layout"** 具体是指：
- **iiQWorks.PLC UNI 中的编程布局界面**（软件主界面）
- **iiQWorks.Sim / Visual Components 中的 3D Layout 场景视图**（虚拟调试的 3D 场景）

可以告诉我你的具体场景，我给出更精确的操作指引。

---

## 参考文献
[1] [iiQWorks.PLC UNI 1.0 手册 p.20](file:///Users/allen/.cache/plc-knowledge-base/originals/iiqworks/%28CN%29%20iiQWorks.PLC%20UNI%201.0.pdf#page=20)
[2] [iiQWorks.PLC UNI 入门指南 (虚拟调试) p.18](file:///Users/allen/.cache/plc-knowledge-base/originals/iiqworks/%28CN%29%20iiQWorks.PLC%20UNI%20%E5%85%A5%E9%97%A8%E6%8C%87%E5%8D%97%20%28%E8%99%9A%E6%8B%9F%E8%B0%83%E8%AF%95%29%20.pdf#page=18)`,
            },
        }
    ],

    AskQuestion: [
        {
            id: nextId(),
            type: 'tool',
            toolName: TOOL_NAME_PICK_OPTION,
            content: {
                toolId: 'ask-1',
                toolName: TOOL_NAME_PICK_OPTION,
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
                toolName: TOOL_NAME_RUN_SHELL,
                title: `python3 -c "
import pandas as pd
import openpyxl
# Step 1: Read all sheet names and data
wb = openpyxl.load_workbook('/Users/zhoujie195/ReactProject/sema-design-test/src/估价样例.xlsx', data_only=False)
print('=== Sheet Names ===')
print(wb.sheetnames)
print()
" 2>&1`,
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
                toolName: TOOL_NAME_WRITE_FILE,
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

    AskFormHistory: [
        {
            id: nextId(),
            type: 'askForm',
            content: {
                status: 'submitted',
                values: {
                    visual_style: '极简高级 / Apple 风格',
                    core_modules: ['游戏核心逻辑', 'UI界面渲染'],
                    page_count: '4-6 页',
                    project_name: 'sema-demo',
                    extra_notes: '希望首屏加载在 2s 内',
                },
                data: {
                    agentId: 'mock-agent-history',
                    estimatedTime: '30 秒',
                    intro: '回答后我会基于这些选择直接生成首屏方案',
                    questions: [
                        { type: 'radio', id: 'visual_style', label: '视觉气质', required: true, options: ['极简高级 / Apple 风格', '科技未来感', '商务稳重', '活泼年轻'] },
                        { type: 'checkbox', id: 'core_modules', label: '核心模块', required: true, options: ['游戏核心逻辑', 'UI界面渲染', '输入控制系统', '动画效果', '数据存储'], maxSelections: 3 },
                        { type: 'select', id: 'page_count', label: '大概多少页面？', options: ['1-3 页', '4-6 页', '7-10 页', '10 页以上'] },
                        { type: 'text', id: 'project_name', label: '项目名称', placeholder: '请输入项目名称' },
                        { type: 'textarea', id: 'extra_notes', label: '其他备注', placeholder: '可选：补充任何需要特别说明的内容' },
                    ],
                },
            },
        },
    ],

    ToolError: [
        {
            id: nextId(),
            type: 'system',
            content: {
                type: 'tool_error',
                toolName: TOOL_NAME_RUN_SHELL,
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
                agent_type: 'SearchCodebase',
                title: 'Search config usage',
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
                        toolName: TOOL_NAME_SEARCH_FILES,
                        content: {
                            toolId: 'glob-1',
                            toolName: TOOL_NAME_SEARCH_FILES,
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
                planContent: '# Optimization Plan\n\n## Steps\n1. ~~Analyze codebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write testsebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write testsebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write tests',
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
                agentId: 'main',
                toolId: 'view-file-1',
                toolName: TOOL_NAME_VIEW_FILE,
                title: '/Users/sema/design-spec.md',
                content: '',
                options: {
                    agree: '确认',
                    allow: '确认，本次会话不再询问 /Users/sema 目录下的读取',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
        {
            type: 'permission',
            data: {
                agentId: 'mock-agent-1',
                toolId: 'mock-tool-perm-1',
                toolName: TOOL_NAME_RUN_SHELL,
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
                toolName: TOOL_NAME_WRITE_FILE,
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
                toolName: TOOL_NAME_FETCH_URL,
                title: 'https://github.com/midea-ai/sema-code-core',
                content: '',
                options: {
                    agree: '确认',
                    allow: '确认，本项目不再询问 github.com 域名',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
    ],
    McpToolPermissionDialog: [
        {
            type: 'permission',
            data: {
                agentId: 'main',
                toolId: 'mcp-perm-1',
                toolName: 'mcp__github__search_repositories',
                title: 'query: sema-code language:typescript',
                content: {
                    query: 'sema-code language:typescript',
                    perPage: 10,
                    sort: 'stars',
                    query1: 'sema-code language:typescript',
                    perPage1: 10,
                    sort1: 'stars',
                    query2: 'sema-code language:typescript',
                    perPage2: 10,
                    sort2: 'stars',
                },
                options: {
                    agree: '确认',
                    allow: '确认，本项目不再询问 `github` MCP 工具',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
    ],
    SkillPermissionDialog: [
        {
            type: 'permission',
            data: {
                agentId: 'main',
                toolId: 'skill-perm-1',
                toolName: TOOL_NAME_SKILL,
                title: 'xlsx-pricing',
                content: `python3 SKILL_DIR/scripts/xlsx_reader.py input.xlsx                 # structure discovery
python3 SKILL_DIR/scripts/formula_check.py file.xlsx --json         # formula validation
python3 SKILL_DIR/scripts/formula_check.py file.xlsx --report      # standardized report
python3 SKILL_DIR/scripts/xlsx_unpack.py in.xlsx /tmp/work/         # unpack for XML editing
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/work/ out.xlsx          # repack after editing
python3 SKILL_DIR/scripts/xlsx_shift_rows.py /tmp/work/ insert 5 1  # shift rows for insertion
python3 SKILL_DIR/scripts/xlsx_add_column.py /tmp/work/ --col G ... # add column with formulas
python3 SKILL_DIR/scripts/xlsx_insert_row.py /tmp/work/ --at 6 ...  # insert row with data`,
                options: {
                    agree: '确认',
                    allow: '确认，本次会话不再询问 `xlsx-pricing` Skill',
                    refuse: '拒绝'
                }
            },
            isBackground: false,
        },
    ],
    AskFormDialog: [
        {
            type: 'askForm',
            data: {
                agentId: 'mock-agent-2',
                estimatedTime: '30 秒',
                intro: '回答后我会基于这些选择直接生成首屏方案',
                questions: [
                    {
                        type: 'radio',
                        id: 'visual_style',
                        label: '视觉气质',
                        required: true,
                        options: ['极简高级 / Apple 风格', '科技未来感', '商务稳重', '活泼年轻'],
                    },
                    {
                        type: 'checkbox',
                        id: 'core_modules',
                        label: '核心模块（可多选，最多 3 项）',
                        required: true,
                        options: ['游戏核心逻辑', 'UI界面渲染', '输入控制系统', '动画效果', '数据存储'],
                        maxSelections: 3,
                    },
                    {
                        type: 'select',
                        id: 'page_count',
                        label: '大概多少页面？',
                        options: ['1-3 页', '4-6 页', '7-10 页', '10 页以上'],
                    },
                    {
                        type: 'text',
                        id: 'project_name',
                        label: '项目名称',
                        placeholder: '请输入项目名称',
                    },
                    {
                        type: 'textarea',
                        id: 'extra_notes',
                        label: '其他备注',
                        placeholder: '可选：补充任何需要特别说明的内容',
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
                planContent: '# Optimization Plan\n\n## Steps\n1. ~~Analyze codebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write testsebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write testsebase~~ ✅\n2. ~~Add caching~~ ✅\n3. Update `callers`\n4. Write tests',
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
                { id: '1', title: '分析代码结构', status: 'completed', progressText: '' },
                { id: '2', title: '添加缓存层', status: 'completed', progressText: '' },
                { id: '3', title: '更新所有调用方', status: 'in_progress', progressText: '正在更新 src/app/index.ts ...' },
                { id: '4', title: '添加缓存失效逻辑', status: 'pending', progressText: '' },
                { id: '5', title: '编写集成测试', status: 'pending', progressText: '' },
            ],
        },
    ],
    FileChangesPanel: [
        {
            changes: [
                { fileName: 'config.ts', fullPath: '/Users/zhoujie195/midea-code/sema-vscode-extension/src/utils/config.ts', additions: 12, removals: 5, type: 'edit', minLine: 10 },
                { fileName: 'configCache.ts', fullPath: 'src/utils/configCache.ts', additions: 6, removals: 0, type: 'write', minLine: 1 },
                { fileName: 'index.ts', fullPath: 'src/app/index.ts', additions: 3, removals: 2, type: 'edit', minLine: 5 },
                { fileName: 'analysis.ipynb', fullPath: 'notebooks/analysis.ipynb', additions: 0, removals: 0, type: 'edit', minLine: 1, isNotebook: true },
            ],
        },
    ],
    QuickChatDialog: [
        {
            type: 'quickchat',
            data: {
                question: '你知道可以用 Map 代替对象来做缓存吗？',
                content: '使用 `Map` 相比普通对象有以下优势：\n\n1. **键可以是任意类型**\n2. **保持插入顺序**\n3. **内置 `size` 属性**\n\n```typescript\nconst cache = new Map<string, any>();\ncache.set("key", value);\n```',
            },
            isBackground: false,
        },
    ],
    ForkDialog: [
        {
            preview: {
                messageUuid: 'mock-fork-uuid-1',
                canRestoreFiles: true,
                files: [
                    { filePath: '/ws/src/utils/config.ts', displayPath: 'src/utils/config.ts', effect: 'modify', additions: 12, removals: 5 },
                    { filePath: '/Users/zhoujie195/midea-code/sema-vscode-extension/ws/src/app/index.ts', displayPath: '/Users/zhoujie195/midea-code/sema-vscode-extension/src/app/index.ts', effect: 'modify', additions: 3, removals: 2 },
                    { filePath: '/ws/src/legacy/oldLoader.ts', displayPath: 'src/legacy/oldLoader.ts', effect: 'recreate', additions: 40, removals: 0 },
                    { filePath: '/ws/src/utils/configCache.ts', displayPath: 'src/utils/configCache.ts', effect: 'delete', additions: 0, removals: 6 },
                    { filePath: '/ws/assets/logo.png', displayPath: 'assets/logo.png', effect: 'modify', additions: 0, removals: 0, binary: true },
                ],
            },
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
