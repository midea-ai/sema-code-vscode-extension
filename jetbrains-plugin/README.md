# Sema Code — JetBrains 插件

面向 JetBrains 全家桶(IntelliJ IDEA / PyCharm / GoLand / WebStorm / CLion 等)的 Code Agent 插件。
与现有 VSCode 扩展(`../`)**共享同一个 Agent 大脑(`sema-core`)和同一套 React UI**,通过薄适配层接入 IntelliJ Platform。

> 一个插件即可覆盖整个 JB 系列——只依赖 IntelliJ Platform 核心 API,不绑定任何语言专属模块。

## 核心结论(一句话)

真正复杂的两块——**Agent 大脑(`sema-core`,纯 Node)** 和 **界面(React)**——都与编辑器无关,可高比例复用;
与 VSCode 强绑定的只有中间约 11 个适配文件。JB 版本的主要工作,就是用 Kotlin 重写这层适配,并把大脑改造成独立 sidecar 进程。

## 已确定的技术选型

| 决策点 | 选择 | 理由 |
|---|---|---|
| **界面** | JCEF 加载现有 React,仅替换通信桥 | 一套 UI 代码同时服务 VSCode 与 JB,避免双份维护与分叉 |
| **大脑运行时** | `sema-core` 用 pkg/bun 编译成各平台独立二进制,作为 sidecar | 用户无需预装 Node;复用现有 pet 的"下载平台二进制 + spawn"分发机制 |
| **sema-core 归属** | 团队自维护,新增 IPC/进程入口 | 可为其增加 JSON-RPC over stdio 入口,VSCode 端亦可受益 |
| **插件语言** | Kotlin(IntelliJ Platform SDK) | JB 官方主推,平台 API 一等公民 |
| **落地策略** | MVP 优先:先跑通聊天主闭环,再补配置全功能 | 团队有 JVM 能力,先出可用版本再扩展 |

## 目录规划(随开发逐步填充)

```
jetbrains-plugin/
├── README.md                 # 总览与选型（本文件）
├── DEVELOPMENT.md            # 怎么跑起来（前置/运行/打包）
├── docs/
│   ├── STATUS.md             # ★ 现状 + 文件地图 + 踩坑 + 阶段2起点（先读）
│   ├── architecture.md       # 整体架构:分层、进程模型、gRPC 透明镜像
│   ├── roadmap.md            # 分阶段方案与进度
│   └── build.md              # 宿主↔webview 传输契约（单一真源；运行见 DEVELOPMENT.md）
├── build.gradle.kts / settings.gradle.kts / gradle.properties
├── gradlew + gradle/         # 自带 wrapper
├── sema-grpc/                # gRPC 桥（独立 npm 工程）= sema-core 透明镜像
│   ├── proto/sema.proto
│   └── src/{server,core,session}.ts
└── src/main/
    ├── kotlin/com/sema/         # Kotlin 哑转发 + 编辑器集成
    │   ├── toolwindow/          # ToolWindow 入口 + 标题栏三按钮（NewSession/OpenHistory/OpenConfig）
    │   ├── jcef/                # ChatPanel / ConfigPanel / HistoryPanel / HtmlShell / Theme
    │   ├── bridge/              # MessageBridge（grpc/editor/systemConfig/history 转发）+ SemaPanelBus（跨面板总线）
    │   ├── sidecar/             # 进程/gRPC 客户端/生命周期（多连接）
    │   ├── editor/              # EditorOps（快照/diff/回滚/统计/openConfig）
    │   └── config/              # SystemConfigManager + SessionHistoryManager + 配置页/历史页 FileEditor 各一套
    └── resources/META-INF/plugin.xml

# JS 层在主工程内（复用 React）：
../src/webview/chat/jb/{transport,remote,controller,bridge}.ts + jb-index.tsx            → jb-chat.js
../src/webview/config/jb/{config-controller,config-bridge}.ts + jb-index.tsx             → jb-config.js
../src/webview/sessionHistory/jb/{history-controller,history-bridge}.ts + jb-index.tsx   → jb-sessionHistory.js
../webpack.config.js 的 chatWebviewJbConfig / configWebviewJbConfig / sessionHistoryWebviewJbConfig
```

## 与主工程的关系

- **不改** `../src/webview/**` 的业务逻辑；新增 `jb/` 目录 + `jb-index.tsx` 入口，复用现有 `App` 与 `semaSessionWrapper`。
  - 唯一动到的共享文件是 `InputBox.tsx`（JCEF 的 IME 兜底，用 `window.__SEMA_JB__` 隔离，VSCode 无感）。
- `sema-core` **未改**：gRPC 桥（`sema-grpc/`）在外面包一层，桥是它的透明镜像。
- React 产物由 Gradle `syncWeb` 从 `../dist/webview` 同步进插件资源。

