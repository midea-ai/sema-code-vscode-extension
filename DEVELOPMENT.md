# Sema Code VSCode Extension 开发文档

## 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [开发环境搭建](#开发环境搭建)
- [构建系统](#构建系统)
- [核心模块详解](#核心模块详解)
- [Webview 层详解](#webview-层详解)
- [数据流与通信机制](#数据流与通信机制)
- [状态管理](#状态管理)
- [权限系统](#权限系统)
- [配置系统](#配置系统)
- [会话管理](#会话管理)
- [打包与发布](#打包与发布)
- [调试指南](#调试指南)
- [开发规范](#开发规范)

---

## 项目概述

**Sema Code VSCode Extension** 是基于 [sema-core](https://github.com/midea-ai/sema-code-core) 引擎的 AI 智能编程 VSCode 插件。它作为 sema-core 与 VSCode IDE 之间的桥接层，提供自然语言驱动的编程体验。

**核心能力：**
- 自然语言指令驱动编程任务
- 多智能体（Subagent）协同工作
- Plan 模式任务分解与规划
- Skill 插件化扩展机制
- MCP（Model Context Protocol）服务支持
- 多模型适配（Anthropic、OpenAI SDK 及国内主流 LLM）
- 细粒度权限控制
- 会话历史管理与文件变更追踪

---

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 语言 | TypeScript | 4.9.x |
| UI 框架 | React | 18.2.x |
| 构建工具 | Webpack | 5.75.x |
| 转译器 | Babel 7（React 预设）/ ts-loader | — |
| 核心引擎 | sema-core | ^1.0.11 |
| 文件搜索 | @vscode/ripgrep | ^1.17.0 |
| Diff 算法 | diff | ^8.0.2 |
| HTML 消毒 | dompurify | ^3.3.1 |
| 压缩包处理 | adm-zip | ^0.5.16 |
| VSCode API | ^1.75.0 | — |
| Node.js 目标 | ES2022 | — |

---

## 项目结构

```
sema-code-vscode-extension/
├── src/
│   ├── extension.ts                      # 插件入口（activate/deactivate）
│   ├── core/                             # 插件宿主层
│   │   ├── semaCoreWrapper.ts            # sema-core 封装层，事件桥接
│   │   └── semaSidebarProvider.ts        # WebviewViewProvider 主协调器
│   ├── managers/                         # 状态管理器
│   │   ├── SystemConfigManager.ts        # 系统配置（globalState）
│   │   ├── SessionHistoryManager.ts      # 会话持久化（workspaceState）
│   │   ├── FileStateDiffManager.ts       # 文件快照与 diff 管理
│   │   └── FileOperationManager.ts       # 文件打开/搜索操作
│   ├── utils/                            # 公共工具
│   │   ├── prompt.ts                     # 指令 → Prompt 转换
│   │   ├── command.ts                    # 命令工具
│   │   └── fileExcludePatterns.ts        # 文件排除规则
│   └── webview/                          # UI 层（3 个独立 Webview）
│       ├── chat/                         # 聊天主界面
│       │   ├── index.tsx                 # 入口
│       │   ├── App.tsx                   # 根组件
│       │   ├── MessageItem.tsx           # 消息类型分发
│       │   ├── chatWebview.ts            # Webview Provider
│       │   ├── blocks/                   # 消息类型渲染器
│       │   │   ├── AiResponseBlock.tsx   # AI 回复
│       │   │   ├── UserInputBlock.tsx    # 用户输入
│       │   │   ├── ThoughtBlock.tsx      # 思考过程
│       │   │   ├── ToolErrorBlock.tsx    # 工具错误
│       │   │   ├── TaskEndBlock.tsx      # 任务结束
│       │   │   └── tools/               # 工具输出渲染器
│       │   │       ├── EditBlock.tsx     # 文件编辑
│       │   │       ├── ReadBlock.tsx     # 文件读取
│       │   │       ├── BashBlock.tsx     # 命令执行
│       │   │       ├── AgentBlock.tsx    # 子代理
│       │   │       ├── NotebookEditBlock.tsx
│       │   │       ├── PubBlock.tsx
│       │   │       └── TaskOutputBlock.tsx
│       │   ├── components/              # UI 组件
│       │   │   ├── input/               # 输入相关
│       │   │   ├── panels/              # 侧面板
│       │   │   ├── permission/          # 权限对话框
│       │   │   └── ui/                  # 通用 UI 组件
│       │   ├── utils/                   # 聊天工具函数
│       │   │   ├── StreamingStore.ts    # 流式消息管理
│       │   │   ├── diffParser.ts        # Diff 解析
│       │   │   ├── markdown.ts          # Markdown 渲染
│       │   │   └── fileIconUtils.ts     # 文件图标映射
│       │   ├── types.ts                 # 类型定义
│       │   └── style/                   # 样式
│       ├── config/                      # 配置面板
│       │   ├── index.tsx
│       │   ├── App.tsx
│       │   ├── configWebview.ts
│       │   ├── types.ts
│       │   └── default/defaultConfig.ts # 默认配置
│       └── sessionHistory/              # 会话历史面板
│           ├── index.tsx
│           ├── App.tsx
│           ├── sessionHistoryWebview.ts
│           └── styles.css
├── webpack.config.js                    # 4 个 Webpack 配置
├── tsconfig.json                        # Extension 编译配置
├── tsconfig.webview.json                # Webview 编译配置
├── .babelrc.json                        # Babel 配置
├── package.json
└── package-all.sh                       # 多平台打包脚本
```

---

## 架构设计

### 整体架构

插件采用**三层架构**，运行在两个不同的进程中：

```
┌──────────────────────────────────────────────────────────┐
│                    VSCode Extension Host (Node.js)        │
│                                                           │
│  extension.ts ─── activate()                              │
│       │                                                   │
│       ▼                                                   │
│  SemaSidebarProvider（主协调器）                            │
│       │                                                   │
│       ├── SemaCoreWrapper ─── sema-core 引擎              │
│       │       │                                           │
│       │       └── 事件监听 & 转发                          │
│       │                                                   │
│       ├── ChatWebviewProvider ─── 聊天 Webview 通信        │
│       ├── ConfigWebviewProvider ─── 配置 Webview 通信      │
│       ├── SessionHistoryWebviewProvider                   │
│       │                                                   │
│       └── Managers                                        │
│           ├── SystemConfigManager（globalState）           │
│           ├── SessionHistoryManager（workspaceState）      │
│           ├── FileStateDiffManager（文件快照）              │
│           └── FileOperationManager（文件操作）             │
│                                                           │
└──────────────┬───────────────┬───────────────┬───────────┘
               │ postMessage   │               │
               ▼               ▼               ▼
┌──────────┐ ┌──────────┐ ┌──────────────────┐
│ Chat     │ │ Config   │ │ Session History  │
│ Webview  │ │ Webview  │ │ Webview          │
│ (React)  │ │ (React)  │ │ (React)          │
└──────────┘ └──────────┘ └──────────────────┘
     Browser 环境（独立沙箱）
```

### 关键设计原则

1. **事件驱动**：sema-core 通过事件 emit 输出结果，SemaCoreWrapper 监听并转发到 Webview
2. **进程隔离**：Extension Host（Node.js）与 Webview（浏览器沙箱）通过 `postMessage` 通信
3. **状态分离**：全局配置用 `globalState`，项目级会话用 `workspaceState`
4. **流式处理**：AI 回复通过 StreamingStore 实现增量累积渲染

---

## 开发环境搭建

### 前置要求

- Node.js 18.x+
- VSCode ^1.75.0
- npm

### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/midea-ai/sema-code-vscode-extension.git
cd sema-code-vscode-extension

# 2. 安装依赖
npm install

# 3. 编译项目
npm run compile

# 4. 在 VSCode 中按 F5 启动调试
#    这将打开一个新的 Extension Development Host 窗口
```

### 开发工作流

1. 修改代码后运行 `npm run compile` 重新编译
2. 在 Extension Development Host 窗口中按 `Ctrl+Shift+P` → `Developer: Reload Window` 重载
3. 注意：项目未配置热更新，每次修改需重新编译

---

## 构建系统

### Webpack 配置

项目使用 4 个独立的 Webpack 配置，分别构建不同的目标产物：

| 配置 | 目标 | 入口 | 产物 |
|------|------|------|------|
| `extensionConfig` | Node.js | `src/extension.ts` | `dist/extension.js` |
| `chatWebviewConfig` | Web | `src/webview/chat/index.tsx` | `dist/webview/chat.js` |
| `configWebviewConfig` | Web | `src/webview/config/index.tsx` | `dist/webview/config.js` |
| `sessionHistoryWebviewConfig` | Web | `src/webview/sessionHistory/index.tsx` | `dist/webview/sessionHistory.js` |

### 编译差异

- **Extension 代码**：使用 `ts-loader` + `tsconfig.json`，目标为 CommonJS
- **Webview 代码**：使用 `babel-loader` + `.babelrc.json`，支持 JSX/TSX 转译
- **外部模块**：`vscode` 和 `@vscode/ripgrep` 标记为 externals，不打包

### 产物结构

```
dist/
├── extension.js              # Extension Host 代码
└── webview/
    ├── chat.js               # 聊天界面
    ├── config.js             # 配置面板
    └── sessionHistory.js     # 会话历史面板
```

---

## 核心模块详解

### extension.ts — 插件入口

**职责：**
- 调用 `activate()` 注册 WebviewViewProvider 和命令
- 监听工作区变更，自动重载插件
- 无工作区时创建默认 `~/sema-demo` 目录

**注册的命令：**
| 命令 ID | 功能 |
|---------|------|
| `sema-vscode-extension.newSession` | 开始新对话 |
| `sema-vscode-extension.openHistory` | 打开历史会话面板 |
| `sema-vscode-extension.openConfig` | 打开配置面板 |

### SemaSidebarProvider — 主协调器

**文件：** `src/core/semaSidebarProvider.ts`

**职责：**
- 实现 `vscode.WebviewViewProvider`，作为侧边栏 Webview 的容器
- 初始化所有 Manager 实例
- 协调 Extension Host 与各个 Webview 之间的通信
- 管理 Webview Panel 的生命周期

### SemaCoreWrapper — sema-core 封装层

**文件：** `src/core/semaCoreWrapper.ts`（约 1096 行）

这是整个插件最核心的模块，负责：
- 封装 sema-core 引擎的初始化和调用
- 监听 sema-core 的所有事件（AI 回复、工具调用、任务状态等）
- 将事件转换为 Webview 可消费的消息格式
- 处理权限请求的异步回调
- 管理文件快照的生命周期

### Managers — 状态管理器

#### SystemConfigManager
- 使用 `context.globalState` 持久化全局配置
- 存储模型配置、权限开关、系统提示词等

#### SessionHistoryManager
- 使用 `context.workspaceState` 持久化会话历史
- 按项目隔离，切换工作区自动切换会话
- 支持会话的保存、加载、删除

#### FileStateDiffManager
- 在工具执行前对文件做快照
- 计算文件变更 diff
- 支持文件变更回退（恢复到快照状态）
- 快照存储在临时目录中

#### FileOperationManager
- 封装文件打开、搜索等操作
- 管理 Bash 命令输出的展示

---

## Webview 层详解

### 三个独立 Webview

插件包含三个独立的 Webview，各自有独立的 React 应用：

#### 1. Chat Webview（聊天主界面）

**核心组件树：**
```
App.tsx
├── Welcome                    # 欢迎页
├── MessageItem[]              # 消息列表
│   ├── UserInputBlock         # 用户输入
│   ├── AiResponseBlock        # AI 回复（Markdown 渲染）
│   ├── ThoughtBlock           # 思考过程
│   ├── ToolErrorBlock         # 工具错误
│   ├── TaskEndBlock           # 任务结束
│   └── Tools Blocks           # 工具输出
│       ├── EditBlock          # 文件编辑（含 diff 展示）
│       ├── ReadBlock          # 文件读取
│       ├── BashBlock          # 命令执行
│       ├── AgentBlock         # 子代理
│       └── ...
├── InputBox                   # 用户输入框
├── PermissionDialog           # 权限确认对话框
├── FileChangesPanel           # 文件变更面板
├── TodosPanel                 # 任务列表面板
└── TaskDetailModal            # 任务详情弹窗
```

**消息分发机制（MessageItem.tsx）：**
根据消息的 `type` 字段，将消息分发到对应的 Block 组件进行渲染。每种消息类型有独立的渲染逻辑。

#### 2. Config Webview（配置面板）

提供以下配置能力：
- 模型管理（添加、测试、删除 LLM 配置）
- 系统设置（流式输出、思考过程、权限开关）
- 插件/Skill/命令管理
- MCP Server 配置
- 后台任务管理

#### 3. Session History Webview（会话历史面板）

- 浏览已保存的对话记录
- 加载/删除历史会话
- 按项目隔离展示

### 流式消息处理

**StreamingStore** (`src/webview/chat/utils/StreamingStore.ts`) 是流式消息的核心：

```
sema-core 事件 → SemaCoreWrapper → postMessage → App.tsx → StreamingStore
                                                              │
                                                              ▼
                                                    增量累积 → React 状态更新 → UI 渲染
```

StreamingStore 通过 delta 累积的方式处理流式文本，避免每次全量替换导致的性能问题。

---

## 数据流与通信机制

### Extension Host ↔ Webview 通信

通信基于 VSCode 的 `postMessage` API，采用约定的消息格式：

**Extension → Webview：**
```typescript
webview.postMessage({
    type: 'messageType',
    payload: { /* 数据 */ }
});
```

**Webview → Extension：**
```typescript
vscode.postMessage({
    type: 'messageType',
    payload: { /* 数据 */ }
});
```

### 完整数据流

```
用户输入
  │
  ▼
InputBox (Webview) ──postMessage──→ ChatWebviewProvider (Extension Host)
                                         │
                                         ▼
                                   SemaCoreWrapper
                                         │
                                         ▼
                                     sema-core 引擎
                                         │
                                    (事件 emit)
                                         │
                                         ▼
                                   SemaCoreWrapper (事件监听)
                                         │
                                    postMessage
                                         │
                                         ▼
                                   App.tsx (Webview)
                                         │
                                         ▼
                                   StreamingStore → React 状态 → UI 渲染
```

### 权限请求流程

```
sema-core 请求工具执行
  │
  ▼
SemaCoreWrapper 检查权限配置
  │
  ├── 已跳过权限 → 直接执行
  │
  └── 需要权限 → postMessage → PermissionDialog (Webview)
                                     │
                                 用户操作
                                     │
                               postMessage
                                     │
                                     ▼
                              SemaCoreWrapper → 执行/拒绝
```

---

## 状态管理

### 持久化策略

| 数据类型 | 存储方式 | 作用域 | 说明 |
|----------|----------|--------|------|
| 系统配置 | `globalState` | 全局 | 模型、权限开关、系统提示词 |
| 会话历史 | `workspaceState` | 项目级 | 对话记录，按工作区隔离 |
| 文件快照 | 临时目录 | 会话级 | 文件变更前的备份 |
| Webview 状态 | React state/ref | 运行时 | 消息列表、UI 状态 |

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `stream` | boolean | true | 启用流式输出 |
| `thinking` | boolean | true | 显示 LLM 思考过程 |
| `skipFileEditPermission` | boolean | false | 跳过文件编辑权限确认 |
| `skipBashExecPermission` | boolean | false | 跳过命令执行权限确认 |
| `skipSkillPermission` | boolean | false | 跳过 Skill 执行权限确认 |
| `skipMCPToolPermission` | boolean | false | 跳过 MCP 工具权限确认 |
| `systemPrompt` | string | — | 系统提示词 |
| `customRules` | string | — | 自定义规则 |
| `enableLLMCache` | boolean | false | 启用 LLM 响应缓存 |
| `enableClaudeCodeCompat` | boolean | true | Claude Code 兼容模式 |
| `disableBackgroundTasks` | boolean | false | 禁用后台任务 |
| `useTools` | string[] \| null | null | 限制可用工具（null = 全部） |

---

## 权限系统

插件实现了细粒度的权限控制，在执行敏感操作前请求用户确认：

| 权限类别 | 控制配置 | 触发场景 |
|----------|----------|----------|
| 文件编辑 | `skipFileEditPermission` | Edit、Write 等工具调用 |
| 命令执行 | `skipBashExecPermission` | Bash 工具调用 |
| Skill 执行 | `skipSkillPermission` | Skill 工具调用 |
| MCP 工具 | `skipMCPToolPermission` | MCP Server 工具调用 |

权限对话框（`PermissionDialog`）展示操作详情，支持：
- 允许本次执行
- 拒绝本次执行
- 配置中永久跳过该类权限（区分会话级、项目级、bash前缀）

---

## 会话管理

### 会话生命周期

```
新建会话 → 用户交互 → 自动保存 → 可从历史加载
                           │
                      debounce 防抖
```

### 会话数据结构

每个会话包含：
- 会话 ID
- 创建时间
- 消息列表（用户输入、AI 回复、工具调用等）
- 关联的工作区路径

### 项目隔离

会话通过 `workspaceState` 存储，自动按当前工作区隔离。切换工作区时，自动加载对应项目的会话历史。

---

## 打包与发布

### 多平台打包

```bash
# 使用脚本打包所有平台
./package-all.sh

# 产出文件格式：
# sema-vscode-extension-darwin-x64-<version>.vsix
# sema-vscode-extension-darwin-arm64-<version>.vsix
# sema-vscode-extension-linux-x64-<version>.vsix
# sema-vscode-extension-win32-x64-<version>.vsix
```

### 发布到 Marketplace

```bash
# 需要先登录或使用 PAT
vsce login <publisher>

# 发布所有平台包
for vsix in sema-vscode-extension-*.vsix; do
    vsce publish --packagePath "$vsix"
done
```

### .vscodeignore

打包时排除开发相关文件（源码、配置文件等），仅包含 `dist/` 产物和必要资源。

---

## 调试指南

### 调试 Webview

- 在 Extension Development Host 窗口中，按 `Ctrl+Shift+P`
- 执行 `Developer: Open Webview Developer Tools`
- 可以在浏览器开发者工具中调试 React 组件

### 预览模式（Preview Mode）

项目内置了一套 Mock 预览系统，可以在**不启动 sema-core 后端**的情况下独立预览和调试所有 UI 组件的渲染效果。这对于样式调整、新组件开发和 UI 走查非常有用。

**相关文件：**
- `src/webview/chat/utils/mockMessages.ts` — Mock 数据定义与预览控制开关
- `src/webview/chat/utils/PreviewDialogs.tsx` — 弹窗类组件的预览容器
- `src/webview/chat/App.tsx` — 根组件中集成预览模式的渲染逻辑

**使用方式：**

通过修改 `mockMessages.ts` 中的 `PREVIEW_COMPONENTS` 常量来控制预览范围：

```typescript
// 预览所有组件（消息块 + 弹窗）
export const PREVIEW_COMPONENTS: string[] | null = null;

// 只预览指定组件
export const PREVIEW_COMPONENTS: string[] | null = ['Edit', 'Bash', 'PermissionDialog'];

// 关闭预览（正常模式，默认值）
export const PREVIEW_COMPONENTS: string[] | null = [];
```

修改后重新编译（`npm run compile`）并 Reload Window 即可看到效果。

#### 可预览的消息块组件

| 组件名 | 说明 |
|--------|------|
| `UserInput` | 用户输入消息 |
| `FileReference` | 文件引用 |
| `AssistantThinking` | AI 思考过程 |
| `AssistantMarkdown` | AI 回复（Markdown 渲染） |
| `Read` | 文件读取工具 |
| `Edit` | 文件编辑工具（含 diff） |
| `Write` | 文件新建工具 |
| `Bash` | 命令执行工具 |
| `Glob` / `Grep` | 文件搜索工具 |
| `Agent` | 子代理（含嵌套消息） |
| `NotebookEdit` | Notebook 编辑 |
| `McpTool` | MCP 工具调用 |
| `TaskOutput` / `TaskStop` | 后台任务输出/停止 |
| `AskUserQuestion` | 向用户提问 |
| `PermissionRefused` / `PermissionInterrupted` | 权限拒绝/中断 |
| `ToolError` | 工具执行错误 |
| `Interrupted` / `Compact` / `Clear` | 系统状态消息 |
| `TaskEndCompleted` / `TaskEndFailed` / `TaskEndKilled` | 任务结束状态 |
| `PlanImplement` | Plan 模式执行计划 |

**可预览的弹窗/状态组件：**

| 组件名 | 说明 |
|--------|------|
| `ProcessingSpinner` | 处理中加载动画 |
| `ModelConfigReminder` | 模型配置提醒 |
| `PermissionDialog` | 权限确认对话框（含 Bash 和 Write 两种样式） |
| `AskQuestionDialog` | 多选问答对话框 |
| `PlanExitDialog` | Plan 模式退出确认 |
| `BtwDialog` | 附带提示弹窗 |
| `TodosPanel` | 任务列表面板 |
| `FileChangesPanel` | 文件变更面板 |

**工作原理：**

1. `PREVIEW_MODE` 为 `true` 时，`App.tsx` 在消息列表为空时渲染 `getPreviewMessages()` 返回的 Mock 消息
2. 弹窗类组件由 `PreviewDialogs` 组件统一渲染，每个弹窗可独立关闭
3. `TodosPanel` 和 `FileChangesPanel` 通过 `isPreviewActive()` 判断是否使用 Mock 数据初始化
4. 弹窗的回调操作会输出到控制台（`[Preview] ComponentName.action`），方便验证交互逻辑

**新增组件时的预览适配：**

1. 在 `mockMessageMap`（消息块）或 `mockDialogMap`（弹窗）中添加对应的 Mock 数据
2. 如果是弹窗组件，在 `PreviewDialogs.tsx` 中添加渲染逻辑
3. 设置 `PREVIEW_COMPONENTS = null` 验证渲染效果

### 启动调试

1. 在 VSCode 中打开项目
2. 按 `F5` 启动 Extension Development Host
3. 在新窗口的侧边栏中找到 Sema Code 图标

### 调试 Extension Host

- 使用 VSCode 内置的 Node.js 调试器
- 在 `src/` 目录下的 `.ts` 文件中设置断点
- Source Map 已配置（`nosources-source-map`）

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 修改代码后无效果 | 重新运行 `npm run compile`，然后 Reload Window |
| Webview 白屏 | 检查 `dist/webview/` 下是否有产物文件 |
| sema-core 报错 | 检查 `node_modules/sema-core` 是否正确安装 |
| 权限对话框不出现 | 检查 SystemConfigManager 中的权限配置 |
| 预览模式不生效 | 确认 `PREVIEW_COMPONENTS` 不是空数组 `[]`，重新编译并 Reload |

---

## 开发规范

### 代码组织

- **Extension Host 代码**放在 `src/core/` 和 `src/managers/`
- **Webview 代码**放在 `src/webview/` 对应子目录
- **共享类型**在各层的 `types.ts` 中定义
- **工具函数**放在对应层的 `utils/` 目录

### 新增工具渲染器

当 sema-core 新增工具类型时，需要：

1. 在 `src/webview/chat/blocks/tools/` 下创建 `XxxBlock.tsx`
2. 在 `MessageItem.tsx` 中添加消息类型分发
3. 如需权限控制，在 `PermissionContent.tsx` 中添加展示逻辑

### 新增配置项

1. 在 `src/webview/config/default/defaultConfig.ts` 添加默认值
2. 在 `SystemConfigManager.ts` 中处理存取
3. 在 Config Webview 的 UI 中添加配置入口
4. 在 `SemaCoreWrapper.ts` 中使用配置

### 通信消息约定

Extension 与 Webview 之间的消息应遵循统一格式：

```typescript
{
    type: string;      // 消息类型标识
    payload?: any;     // 消息数据
}
```

新增消息类型时，应在对应的 WebviewProvider 和 Webview App 中同步添加处理逻辑。
