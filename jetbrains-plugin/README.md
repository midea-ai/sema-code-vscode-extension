# Sema Code — JetBrains 插件

面向 JetBrains 全家桶(IntelliJ IDEA / PyCharm / GoLand / WebStorm / CLion 等)的 Code Agent 插件。
与现有 VSCode 扩展(`../`)**共享同一个 Agent 大脑(`sema-core`)和同一套 React UI**,通过薄适配层接入 IntelliJ Platform。
目标:JetBrains 插件体验与 VSCode 插件一致。

> 一个插件即可覆盖整个 JB 系列——只依赖 IntelliJ Platform 核心 API,不绑定任何语言专属模块。

## 核心结论(一句话)

真正复杂的两块——**Agent 大脑(`sema-core`,纯 Node)** 和 **界面(React)**——都与编辑器无关,可高比例复用;
与 VSCode 强绑定的只有中间约 11 个适配文件。JB 版本的主要工作,就是用 Kotlin 重写这层适配,并把大脑改造成独立 sidecar 进程。

## 核心类比:**`sema-grpc` 之于 JB = `sema-core` 之于 VSCode**

VSCode 端,UI 在同进程里**直接 new 一个 `SemaCore`**,调它的方法、听它的事件。
JB 端,大脑被拆成独立 sidecar 进程,UI 够不着 `SemaCore` 对象,于是 **`sema-grpc` 站在原地当替身**:

- **API 完全一致**:`sema-grpc` 的每个 `action` 名 = `sema-core` 方法名,`payload` 字段 = 方法参数名。
- **事件完全一致**:上行事件名 = `sema-core` 原始事件名,桥只做哑转发、不翻译。
- **调用位置一致**:客户端把这层封装成 `RemoteCore` / `RemoteSession`([`remote.ts`](../src/webview/chat/jb/remote.ts)),方法签名 1:1 复刻 `SemaCore` / `SemaSession`。

所以**「JB 调 `RemoteCore`」= 「VSCode 调 `SemaCore`」**,只差一层 gRPC 序列化边界。上层编排代码(`SemaSessionWrapper`、React `App`)得以原样复用。

## 设计理念:命令下行、事件上行

UI 与 Core 之间不是简单函数调用,而是双向的:

- **下行(命令)**:UI 把用户操作翻译成对 Core API 的调用——`createSession()`、`processUserInput()`、`interrupt()`、权限响应等,单向下达,不等结果。
- **上行(事件)**:Core 通过事件流把状态变化推给 UI(思考、文本、工具调用、权限询问、错误…),UI 不轮询。

于是 **UI 始终是无状态消费端**:不持有 Agent 状态,只负责「把操作译成命令、把事件渲染成界面」。换 UI 不动引擎,换引擎不动 UI。

JB 完全沿用这套范式,只把「进程内调用」换成「跨进程消息」:`React → JCEF → Kotlin → gRPC(sema-grpc) → sema-core`。

## 一个例子:同一段编排,两种运行时

同样是「建会话 → 听事件 → 发输入 → 中断 → 关会话」,两端方法名、事件名、参数名逐一对齐:

**VSCode(进程内直连 `sema-core`)**

```ts
const core = new SemaCore({ workingDir });                    // 进程内对象
await core.createSession({ permissionLevel });                // 返回 live session
core.on(...);                                                 // 略:配置/模型走 core
session.on('message:text:chunk', render);                    // 听原始事件
session.on('tool:permission:request', ask);
session.processUserInput(content, orgContent, attachments);  // 下行命令
session.interrupt();
core.closeSession(session.sessionId);
```

**JB(跨进程走 `sema-grpc`,见 [`remote.ts`](../src/webview/chat/jb/remote.ts))**

```ts
const core = new RemoteCore(transport);                       // gRPC 替身,签名同 SemaCore
await core.init({ workingDir });                              // 唯一多的一步:拉起/确认 sidecar Core
const { sessionId } = await core.createSession({ permissionLevel }); // 过界后只回 sessionId
const session = new RemoteSession(sessionId, transport);      // 用它 new 一个会话替身
session.on('message:text:chunk', render);                    // 事件由 Transport 按 sessionId 灌入
session.on('tool:permission:request', ask);
session.processUserInput(content, orgContent, attachments);  // → gRPC action 'processUserInput'
session.interrupt();
core.closeSession(sessionId);
```

差异只在三处(全因跨了进程边界):**① 多一步 `init` 引导 sidecar Core;② 所有调用变异步(`await`);③ `createSession` 只回 `sessionId`,需自己 new 一个 `RemoteSession` 承接事件**。除此之外,方法名、参数名、事件名与 VSCode 一模一样。

> 完整 action / event 清单见 [`sema-grpc/README.md`](sema-grpc/README.md)。

## 跨进程要额外守住的三条约束

这条链路多了一层序列化边界(详见 [docs/sema-grpc-diff.md](docs/sema-grpc-diff.md)):

- **能同步的别假设同步**——所有调用变异步往返,回调型 API(如 `watchTask`)要改成上行事件;
- **要扇出的必须走真事件**——多面板各开独立 gRPC 连接,返回值不跨连接,跨面板同步(如改模型后刷新聊天页)只能靠 core 广播事件;
- **要容错的自己补**——超时、断流重连、重连后按 `sessionId` 重建会话。

## 已确定的技术选型

| 决策点 | 选择 | 理由 |
|---|---|---|
| **界面** | JCEF 加载现有 React,仅替换通信桥 | 一套 UI 代码同时服务 VSCode 与 JB,避免双份维护与分叉 |
| **大脑运行时** | esbuild 把 `sema-core` 打成单文件 `server.js`,由 node 跑它作 sidecar;node、rg 均本地优先→按需下载(`~/.sema` 私有缓存) | 用真 node 避免编译二进制破坏 sema-core 对 MCP/插件的动态加载;本地有就复用、没有按平台下载,不污染系统 |
| **通信桥** | gRPC 双向流(`sema-grpc`),action 名=core 方法名、事件名=core 原始事件名 | 桥是 sema-core 的透明镜像,JB 调桥等价于 VSCode 调 core |
| **插件语言** | Kotlin(IntelliJ Platform SDK) | JB 官方主推,平台 API 一等公民 |
| **落地策略** | MVP 优先:先跑通聊天主闭环,再补配置全功能 | 团队有 JVM 能力,先出可用版本再扩展 |

## 目录规划

```
jetbrains-plugin/
├── README.md                 # 总览与选型(本文件)
├── DEVELOPMENT.md            # 怎么跑起来 + 怎么加/改一个能力
├── build.gradle.kts / settings.gradle.kts / gradle.properties
├── gradlew + gradle/         # 自带 wrapper
├── sema-grpc/                # gRPC 桥(独立 npm 工程)= sema-core 透明镜像
│   ├── proto/sema.proto      # BridgeCommand/BridgeEvent 帧定义
│   └── src/{server,core,session}.ts   # action 路由 / Core 单例 / 会话事件桥接
└── src/main/
    ├── kotlin/com/sema/       # Kotlin 哑转发 + 编辑器集成
    │   ├── toolwindow/        # ToolWindow 入口 + 标题栏三按钮(NewSession/OpenHistory/OpenConfig)
    │   ├── jcef/              # ChatPanel / ConfigPanel / HistoryPanel / HtmlShell / Theme
    │   ├── bridge/            # MessageBridge(grpc/editor/systemConfig/history 转发)+ SemaPanelBus(跨面板总线)
    │   ├── sidecar/           # 进程/gRPC 客户端/生命周期(多连接)
    │   ├── editor/            # EditorOps(快照/diff/回滚/统计/openConfig)
    │   └── config/            # SystemConfigManager + SessionHistoryManager + 配置页/历史页 FileEditor
    └── resources/META-INF/plugin.xml
```

JS 层在主工程内(复用 React),每个面板一套 `jb/` 适配 + `jb-index.tsx` 入口:

```
../src/webview/chat/jb/{transport,remote,controller,bridge}.ts              → jb-chat.js
../src/webview/config/jb/{config-controller,config-bridge}.ts               → jb-config.js
../src/webview/sessionHistory/jb/{history-controller,history-bridge}.ts     → jb-sessionHistory.js
# 打包配置:../webpack.config.js 的 chatWebviewJbConfig / configWebviewJbConfig / sessionHistoryWebviewJbConfig
```

- `transport.ts` — 低层帧收发(对接 Kotlin `window.__semaHostQuery` / `__semaHostToWeb`);
- `remote.ts` — `RemoteCore` / `RemoteSession`,sema-core API 镜像(改/加能力主要动这里);
- `controller.ts` — 会话编排 + 事件路由,复刻 VSCode `semaSidebarProvider`,复用 `SemaSessionWrapper`。

## 与主工程的关系

- **不改** `../src/webview/**` 的业务逻辑;新增 `jb/` 目录 + `jb-index.tsx` 入口,复用现有 `App` 与 `SemaSessionWrapper`。
  - 唯一动到的共享文件是 `InputBox.tsx`(JCEF 的 IME 兜底,用 `window.__SEMA_JB__` 隔离,VSCode 无感)。
  - **JB 专属样式/主题差异走 Kotlin 宿主,不进共享 CSS**:由 `HtmlShell` 按面板注入覆盖 CSS(`html:root{}` 压过 bundle 的 `:root`);主题靠 `Theme` 注入 `--vscode-*` 并订阅 IDE 换肤热更新,而非一次性烤入。
- `sema-core` **未改**:gRPC 桥(`sema-grpc/`)在外面包一层,桥是它的透明镜像。
- React 产物由 Gradle `syncWeb` 从 `../dist/webview` 同步进插件资源。
