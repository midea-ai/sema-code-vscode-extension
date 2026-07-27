# Sema Code JetBrains 插件 — 技术架构

> 面向维护者的**实现级架构参考**：讲清楚「一条消息从 React 点击到 sema-core 再回到界面」这条链路上，每一层是什么、为什么这么设计、代码在哪。
>
> 相关文档：[`README.md`](README.md) 讲选型与目录，[`DEVELOPMENT.md`](DEVELOPMENT.md) 讲怎么跑起来，[`docs/build.md`](docs/build.md) 是 JCEF↔Kotlin 线上协议的单一真源，完整 action/event 清单见 sema-core 仓库 `sdks/shared/bridge/README.md`。本文是这些文档的架构性总纲。

---

## 1. 架构总览

### 1.1 一句话架构

**真正复杂的两块——Agent 大脑（`sema-core`，纯 Node）和界面（React）——都与编辑器无关，被 VSCode 与 JB 两端高比例复用；JB 版本的全部新增工作，是用 Kotlin 重写一层「哑适配」，并把大脑从「进程内库」改造成「独立 sidecar 进程」。**

- VSCode 端：React UI 在扩展宿主进程里**直接 `new SemaCore()`**，同进程调方法、听事件。
- JB 端：JVM 里没有 Node 运行时，大脑必须拆成**独立 Node 进程**；UI 够不着 `SemaCore` 对象，于是中间插入一层 **gRPC 透明镜像**当替身——即 sema-core 官方桥（`sdks/shared/bridge`），随 **sema-core Java SDK**（maven `io.github.midea-ai:sema-core`）内嵌分发，进程托管与连接管理也由 SDK 提供。

核心等式：**「JB 调 gRPC 桥」≡「VSCode 调 sema-core」**，只差一层序列化边界。上层编排代码（`SemaSessionWrapper`、React `App`）因此得以原样复用。

### 1.2 进程与运行时模型

```
┌──────────────────────── JetBrains IDE（JVM 进程，每个 project 一个）────────────────────────┐
│                                                                                              │
│   Kotlin 插件（薄适配层）                                                                     │
│   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐                               │
│   │ ChatPanel      │   │ ConfigPanel    │   │ HistoryPanel   │   ← 每个面板一个 JCEF 浏览器  │
│   │ (ToolWindow)   │   │ (Editor Tab)   │   │ (Editor Tab)   │                               │
│   │  JCEF + React  │   │  JCEF + React  │   │  JCEF + React  │                               │
│   └───────┬────────┘   └───────┬────────┘   └───────┬────────┘                               │
│           │ MessageBridge      │ MessageBridge      │ MessageBridge   （每面板一个，哑转发）  │
│   ┌───────┴────────────────────┴────────────────────┴────────┐                               │
│   │ SidecarService（project 级单例，委托 Java SDK）           │                               │
│   │   · 一个 SidecarManager（整个 project 共享，SDK 托管）    │                               │
│   │   · N 条独立 BridgeConnection 连接（每面板一条）          │                               │
│   └───────────────────────────┬──────────────────────────────┘                               │
│                               │ gRPC 双向流（明文，127.0.0.1:动态端口）                       │
└───────────────────────────────┼──────────────────────────────────────────────────────────────┘
                                 │
             ┌───────────────────▼────────────────────┐
             │  Node sidecar 进程（server.js 单文件）  │   ← sema-core 官方桥产物（内嵌 SDK jar，
             │  ┌────────────────────────────────────┐ │      运行时释放），用系统/私有 node 跑
             │  │ 官方桥 sdks/shared/bridge（镜像）  │ │
             │  │   SemaCoreManager（进程级单 Core） │ │
             │  │   SessionBinder（会话事件→gRPC）   │ │
             │  └──────────────┬─────────────────────┘ │
             │  ┌──────────────▼─────────────────────┐ │
             │  │ sema-core（未改动的 npm 包）        │ │   ← 会话池 / LLM / 工具 / MCP /
             │  │   SemaCore + SemaSession[]         │ │      插件 / cron / 配置
             │  └────────────────────────────────────┘ │
             └─────────────────────────────────────────┘
```

| 维度 | 取值 | 说明 |
|---|---|---|
| **进程数** | 每个 project 1 个 sidecar | `SidecarService` 是 `@Service(PROJECT)`，`project.basePath` 即 sema-core 工作目录 |
| **gRPC 连接数** | 每个 JCEF 面板 1 条 | chat / config / history 各开一条 `BridgeConnection`（SDK），互不串扰、`cmdId` 不撞车 |
| **sema-core 实例数** | 每个 sidecar 1 个 | 进程级单 `SemaCore` + 会话池；多面板/多会话共享，与 VSCode「一宿主一 Core」对齐 |
| **端口** | 动态（`SEMA_BRIDGE_PORT=0`） | OS 分配空闲端口，sidecar 用 `SEMA_BRIDGE_PORT_ACTUAL=<n>` 写回 stdout，宿主读取；避免多 IDE 窗口撞端口 |
| **传输** | gRPC over OkHttp，明文 | 全程 `127.0.0.1`，明文足够；OkHttp 传输比 netty-shaded 小 ~8MB |

### 1.3 分层：什么被复用、什么被重写

现有 VSCode 扩展天然是干净的三层结构，JB 端沿用同一分层：

| 层 | 内容 | JB 端处置 |
|---|---|---|
| **① Agent 大脑** `sema-core` | 会话池、LLM、工具执行、MCP、插件、cron、配置 | **100% 复用**，外面包一层 gRPC 桥，源码未改 |
| **③ UI** React（chat/config/history 约 100 个文件） | 界面与交互逻辑，绝大部分代码量在此 | **~100% 复用**，仅新增 `jb/` 适配目录 + `jb-index.tsx` 入口；唯一动到的共享文件是 `InputBox.tsx`（JCEF 的 IME 兜底，用 `window.__SEMA_JB__` 隔离，VSCode 无感） |
| **② 宿主适配层** | sidebar/webview 桥、文件操作、diff、历史、配置 | **全部用 Kotlin 重写**（本插件的主体工作），但只做「哑转发 + 编辑器集成」，不含任何 Agent/协议逻辑 |

设计上刻意让「大脑」和「界面」都不知道自己跑在 VSCode 还是 JB 里——**换 UI 不动引擎，换引擎不动 UI**。

### 1.4 目录结构

代码分两处：Kotlin 宿主在本插件工程内，JS 适配层在主工程内（与 React UI 同仓，方便复用）；
gRPC 桥（③）不再驻留本仓库——用 sema-core 官方桥（`sdks/shared/bridge`），随 Java SDK maven 依赖内嵌引入。

```
jetbrains-plugin/
├── ARCHITECTURE.md / README.md / DEVELOPMENT.md      # 本文 / 选型·目录 / 怎么跑
├── build.gradle.kts · gradle.properties · gradlew    # Gradle 构建（含 syncWeb）
│
└── src/main/
    ├── kotlin/com/sema/              # ② Kotlin 宿主（哑转发 + 编辑器集成）
    │   ├── toolwindow/               #    工具窗口入口 + 标题栏三按钮
    │   ├── jcef/                     #    三个浏览器面板 + HtmlShell/Theme/Tooltips
    │   ├── bridge/                   #    MessageBridge（转发）+ SemaPanelBus（跨面板总线）
    │   ├── sidecar/                  #    SidecarService：SDK SidecarManager/BridgeConnection 薄封装
    │   ├── editor/                   #    EditorOps：diff / 快照 / 统计 / 回滚
    │   └── config/                   #    系统配置·会话历史持久化 + 配置/历史页 FileEditor
    └── resources/META-INF/plugin.xml #    扩展点注册（工具窗口 / 服务 / FileEditorProvider）

../src/webview/                       # ① JS 适配层（在主工程内，复用 React UI）
├── chat/jb/{transport,remote,controller,bridge}.ts + jb-index.tsx     → jb-chat.js
├── config/jb/{config-controller,config-bridge}.ts + jb-index.tsx      → jb-config.js
└── sessionHistory/jb/{history-controller,history-bridge}.ts + jb-index.tsx → jb-sessionHistory.js

<sema-core>/sdks/                     # ③ gRPC 桥 + Java SDK（sema-core 仓库，maven 依赖引入）
├── shared/proto/sema.proto           #    帧定义（单一真源）
├── shared/bridge/                    #    官方桥：server/core/session/rg（esbuild 单文件，内嵌 SDK jar）
└── java/                             #    Java SDK：transport/protocol/runtime（通信层 + sidecar 托管）
```

①②③ 对应 §1.3 的三层：① UI（复用）、② 宿主适配（Kotlin 重写）、③ 大脑桥接（gRPC 镜像，把复用的 sema-core 包在里面，由 sema-core 仓库统一维护）。

---

## 2. 通信架构与关键时序

UI 与 Core 之间不是简单函数调用，而是双向异步的：

- **下行（命令）**：UI 把用户操作译成对 Core API 的调用（`createSession` / `processUserInput` / `interrupt` / 权限响应…），单向下达，不等结果。
- **上行（事件）**：Core 通过事件流把状态变化推给 UI（思考、文本、工具调用、权限询问、错误…），UI 不轮询。

于是 UI 始终是**无状态消费端**。JB 完全沿用这套范式，只把「进程内调用」换成「跨进程消息」。完整链路：

```
React App  ──postMessage──►  createJbBridge (vscode shim)
                                  │
                            Controller（会话编排，复刻 semaSidebarProvider）
                              │        └── SemaSessionWrapper（原始事件→UI 协议翻译，原样复用）
                            Transport（低层帧收发）
                              │  window.__semaHostQuery(json)   ▲ window.__semaHostToWeb(json)
                    ══════════│═════════════════════════════════│══════════  JCEF ↔ JVM 边界
                              ▼                                  │
                            MessageBridge（哑转发，按 channel 路由）
                              ├── channel=grpc  ──► BridgeConnection（SDK） ═══► 官方桥 ──► sema-core
                              ├── channel=editor ─► EditorOps / SystemConfigManager / SessionHistoryManager（本地处理）
                              └── channel=host  ◄── SemaPanelBus（宿主主动下发入站命令）
```

### 2.1 三条通道（JCEF ↔ Kotlin 线上协议）

宿主只暴露两个低层桥函数（`__semaHostQuery` 出、`__semaHostToWeb` 入），**协议逻辑全在 webview JS**。帧按 `channel` 分三类：

| channel | 方向 | 用途 | 处理者 |
|---|---|---|---|
| **`grpc`** | 双向 | 转发给 sidecar，sema-core 的透明镜像，桥不解释内容 | `MessageBridge` → `BridgeConnection`（SDK） |
| **`editor`** | 双向 | 编辑器本地操作（开文件、diff、快照、系统配置、历史读写），**不进 sidecar** | `EditorOps` / `SystemConfigManager` / `SessionHistoryManager` |
| **`host`** | 宿主→web | 标题栏按钮 / 历史面板主动向聊天页下发的入站命令（`createSession` / `loadHistorySession`） | `SemaPanelBus` → `Controller` |

`editor` 通道内又分两种语义：**即发即忘**（`openFile`、`revertFile`…）和**请求/应答**（带 `reqId`，如 `systemConfig` 的 get/save、`history` 的 list）。

### 2.2 跨进程边界带来的三条约束

多了一层序列化边界后，相对 VSCode 的进程内直连有三处必须守住的差异：

1. **能同步的别假设同步**——所有调用变异步往返（`await`）；回调型 API（如 `watchTask`）改造成上行事件（`task:watch:delta`）。
2. **要扇出的必须走真事件**——多面板各开独立 gRPC 连接，返回值不跨连接；跨面板同步（如配置页改模型后刷新聊天页的模型指示器）只能靠 sidecar **广播**合成事件。
3. **要容错的自己补**——超时由调用方把控；断流重连由 SDK `BridgeConnection` 内置（指数退避）；重连后按 `sessionId` 重建会话的续流逻辑仍在上层（待补）。

### 2.3 四条关键链路

用这几条典型流程说明各层如何协作、以及跨进程后哪些地方需要额外绕一下。

**① 首个面板打开 → sidecar 就绪。** 面板一创建就向 `SidecarService` 要一条连接并异步引导进程（SDK `SidecarManager` 在守护线程拉起 Node、释放内嵌桥产物、通过 stdout 回报实际端口），此时 sidecar 可能还没起（首启甚至要下载 node），于是**连接先返回、命令先入队缓冲**（SDK `BridgeConnection` 内置），端口就绪后自动建流并把缓冲的命令 flush 出去。核心是**「连接」与「进程」解耦**,避开「命令早于进程就绪」的竞态。

**② 发一条消息（下行命令 + 上行事件的完整往返）。** 用户输入经浏览器内的编排层做 @file 编码/斜杠展开,交给会话代理 → 传输层 → 跨越 JCEF 边界 → 转发桥按 `grpc` 通道送进 sidecar → sema-core 处理。回程是**流式事件**：sema-core 每吐一段就经 gRPC 回到转发桥、跨回浏览器,编排层按 `sessionId` 派发到对应会话,由翻译层把原始事件转成 UI 消息喂给 React 渲染。这就是「命令下行、事件上行」在跨进程下的完整体现。

**③ 配置页改模型 → 聊天页跟着刷新（跨面板同步）。** 配置页与聊天页是**两条独立 gRPC 连接**,配置页操作的返回值到不了聊天页。所以模型变更在 sidecar 侧成功后,由 gRPC 桥**广播**一条合成事件写到每条连接;聊天页那条连接收到后(无归属会话)走进程级分发,刷新模型指示器。跨面板同步只能靠广播真事件,不能靠返回值。

**④ 历史面板点一条会话 → 聊天页重放。** 历史面板与聊天页同样各在各的连接上,无法直接对话。点击先由转发桥在本地读出会话存档,再经**跨面板总线**把「加载会话」当作一条入站命令推给聊天页并激活工具窗口;聊天页编排层收到后:已打开就切标签,否则用原会话 id + 历史内容新建会话并把历史消息重放回界面。

---

## 3. gRPC 桥（sema-core 的透明镜像）

sema-core 官方桥（sema-core 仓库 `sdks/shared/bridge`，Java/Python/C# SDK 共享同一实现），esbuild 打成单文件 `server.js` 内嵌 Java SDK jar，运行时由 SDK 释放拉起。**核心原则：桥是 sema-core 的 1:1 透明镜像，不做任何协议翻译。**

- **action 名 = sema-core 方法名**（`createSession` / `processUserInput` / `addModel`…）。`init` 是唯一例外（对应 Core 构造，core 无同名方法）。
- **事件名 = sema-core 原始事件名**（`message:text:chunk` / `tool:permission:request`…），桥只做哑转发。
- **路由规则**：`session_id` 空 → 调 `SemaCore`；非空 → 调对应 `SemaSession`。

### 3.1 Proto（`sdks/shared/proto/sema.proto`）

单个双向流 RPC，两个泛化帧：

```protobuf
service SemaBridge { rpc Connect(stream BridgeCommand) returns (stream BridgeEvent); }

message BridgeCommand { string id; string action; string payload;  string session_id; }  // 宿主 → Node
message BridgeEvent   { string event; string data;   string cmd_id; string session_id; }  // Node → 宿主
```

`payload`/`data` 一律是 JSON 字符串——桥不关心内容，序列化边界因此极薄。Java stub 由 SDK 构建期生成并随 jar 分发，插件工程不再生成 proto 代码。

### 3.2 三个源文件

| 文件 | 角色 | 要点 |
|---|---|---|
| **`server.ts`** | gRPC 服务器 + action 路由表 | 每条连接一个 `connect()` 作用域，持有本连接的 `binders`（会话绑定器）和 `watchers`（watchTask 取消函数）；一个大 `switch(action)` 把命令映射到 `manager.instance.<method>()`；`ack` 回原始返回值（配置/查询类）或 `{action}`（纯命令类）；`fail` 回 `error` 帧 |
| **`core.ts`** | `SemaCoreManager`——进程级单例 | 首次 `init` 才 `new SemaCore(seed)`；**已存在时 `init` 是 no-op**（只确认就绪，不再用 seed 覆盖配置——否则「打开面板=悄悄改一次 core 配置」会撞白名单校验）；封装会话池（`getSession`/`listSessions`/`closeSession`）与进程级事件（on/off） |
| **`session.ts`** | `SessionBinder`——会话事件桥接 | 每个 `SemaSession`（对应 UI 一个标签）一个实例，把 `SESSION_EVENTS`（30+ 个原始事件）全部 `on` 上，转发时带 `session_id`；`unbind` 时全部摘除防泄漏 |

### 3.3 多连接与广播模型

各面板连接互相独立，单连接 push 到不了兄弟面板。凡是「非 core 原生、但需跨面板同步」的事件，都靠 `server.ts` 里的 `broadcast()` 合成帧写到**每条**活跃连接（`connections: Set<pushEvent>`）：

- **`model:update`**：`addModel`/`delModel`/`switchModel`/`applyTaskModel` 成功后广播 → 让聊天页模型指示器跟着配置页刷新（对齐 VSCode 双面板广播返回值）。
- **`task:start`/`task:transfer`/`task:end`**：后台任务生命周期由 `SessionBinder` 额外广播（`sessionId` 留空）→ 让配置页「后台任务面板」实时增删（那条连接没有 session，只能靠广播补齐）。
- **进程级原生事件**（`cron:update`、`mcp:server:status`）：Core 就绪后每条连接各自 `onProcessEvent` 订阅，`session_id` 留空转发。

### 3.4 会话生命周期

```
init（首次建 Core）─► addModel ─► applyTaskModel ─► createSession
                                                       │ ack 回 {sessionId}
                                          server 端 new SessionBinder(session).bind()
                                          等待 session:ready 事件 ─► processUserInput ─► …流式事件… ─► interrupt
                                                 closeSession（unbind + core.closeSession，不销毁 Core）
```

连接断开时 `cleanup()`：退出广播集合、取消所有 watcher、摘除进程事件、`unbind` 并 `closeSession` 本连接的所有会话。进程收 `SIGTERM`/`SIGINT` → `manager.dispose()` → 优雅关服。

---

## 4. 各层职责

本节讲每一层「担什么职责、有哪些非显然的设计决策」，不做逐文件罗列——落到具体类时给出地标名，方便按图索骥，细节以代码为准。

### 4.1 UI 层（复用 VSCode 的 React）

React 界面整体复用，JB 端只做两件事：**提供一个假的 `vscode` 通信对象**，以及**把 VSCode 宿主的编排逻辑搬到浏览器里**。

- **通信 shim**：VSCode 里 UI 靠 `acquireVsCodeApi().postMessage` 与宿主对话。JB 端伪造一个同形对象，让 `App` 无差别调用——消息背后改走 gRPC。因此 React 代码一行不改（唯一例外是输入框对 JCEF 输入法的兜底，用 `window.__SEMA_JB__` 标记隔离，VSCode 无感）。
- **编排层下沉**：VSCode 的会话编排原本在扩展宿主（`semaSidebarProvider`/`chatWebview`）。JB 端把这套逻辑（会话池、事件按标签路由、读时快照触发、历史存档、@file 编码等）**复刻进浏览器里的一个 Controller**，因为跨进程后宿主只剩「哑转发」，编排没地方放。
- **翻译层零改动**：原始 core 事件 → UI 消息的翻译（`SemaSessionWrapper`）是纯逻辑、无编辑器依赖，两端**原样复用**。它原本拿进程内的会话对象，现在拿一个**接口 1:1 复刻、背后走 gRPC 的会话代理**（`RemoteSession`）——对它而言毫无区别。这就是「JB 调桥 ≡ VSCode 调 core」能成立的关键。

> 代码位置：`src/webview/**/jb/`（`controller.ts` 编排、`remote.ts` 代理、`transport.ts` 帧收发、`bridge.ts` shim）。

### 4.2 宿主层（Kotlin，四类职责）

Kotlin 侧只做「搬运 + 编辑器集成」，不含任何 Agent/协议逻辑。按职责分四类：

**① 进程与连接管理**——把「一个 sidecar 进程 + 每面板一条 gRPC 连接」的生命周期管起来，重活（异步引导、就绪前缓冲、断线重连、Node 探测/下载、端口握手）全部委托 sema-core Java SDK，Kotlin 侧只剩 project 级的薄封装。
*地标：`SidecarService`（薄封装）；SDK 侧 `SidecarManager`（进程托管）、`BridgeConnection`（单条流）。*

**② 消息转发与跨面板同步**——每个面板一个转发器，按通道把 web 消息分流到 gRPC 或本地编辑器操作。两个要点：`init` 时把宿主持久化的系统配置合并进去做 seed（sema-core 自己不存 core 配置）；以及一条**跨面板总线**——标题栏「新建会话」按钮、历史面板「加载会话」需要主动推进聊天页，但聊天页是临时对象没有稳定引用，于是走总线中转，并处理「聊天页还没就绪先缓冲」的时序。
*地标：`MessageBridge`（转发）、`SemaPanelBus`（跨面板总线）。*

**③ 界面承载与主题**——三个面板各是一个 JCEF 浏览器，加载复用的 React bundle。两处非显然设计：bundle 必须作为外部 `file://` 脚本加载（内联会白屏）；以及**主题跟随 IDE 明暗色热更新**——把 IDE 颜色映射成 React 认识的 `--vscode-*` 变量注入，并订阅 IDE 换肤事件，换肤时只替换那段样式的内容、不重载页面。配置页与历史页不是工具窗口，而是**编辑器区的 Tab**（用轻量虚拟文件 + 自定义 FileEditor 承载，对齐 VSCode 的 webview panel）。
*地标：`ChatPanel`/`ConfigPanel`/`HistoryPanel`、`HtmlShell`、`Theme`。*

**④ 编辑器集成与持久化**——diff 预览、接受/拒绝、改动统计、文件快照，以及系统配置与会话历史的落盘。这里是跨进程差异最大的地方，两个核心坑：
  - **VFS 陈旧**：sema-core 在独立进程直接写盘，IDE 的虚拟文件缓存还是旧的，所以凡读「当前内容」一律直读磁盘、绕开 VFS。
  - **快照竞态**：权限预览时改动尚未落盘，无法靠「读磁盘」拿到提议内容，改为**从 patch 反推**出目标内容，避免与写盘时序赛跑。

  持久化沿用 IDE 原生机制：系统配置存应用级（跨 project），会话历史存项目级（进 `workspace.xml`）——正好对齐 VSCode 的 globalState / workspaceState 语义。
  *地标：`EditorOps`（diff/快照/统计）、`SystemConfigManager`、`SessionHistoryManager`。*

---

## 5. 构建、打包与运行时依赖

### 5.1 构建管线

**两个输入，Gradle 负责汇合：**

1. **sema-core Java SDK**（maven `io.github.midea-ai:sema-core`）：通信层 + sidecar 托管 + 内嵌桥产物，gradle 从 Maven Central 按 `semaCoreSdkVersion` 自动拉取。
2. **React bundle**（主工程）：webpack 的 `chatWebviewJbConfig`/`configWebviewJbConfig`/`sessionHistoryWebviewJbConfig` 三个入口 → `dist/webview/jb-{chat,config,sessionHistory}.js`。

**Gradle（`build.gradle.kts`）汇合：**

| 任务 | 作用 |
|---|---|
| `syncWeb` | 从 `../dist/webview` 同步 **仅 `jb-*.js`**（VSCode 版 bundle 从不加载，省 ~3.8MB） |
| `buildPlugin` | 出 `sema-jetbrains-plugin-<ver>.zip`（落在插件根目录） |

平台锚定 `platformType=IC`、`platformVersion=2023.2`（`sinceBuild=232`，此版起 JCEF/`JBCefBrowser` API 稳定）；`javaVersion=17`。签名/发布 token 走环境变量，本地未配则跳过。

### 5.2 运行时依赖供给（node / rg）

统一范式：**本地有就用本地 → 没有按平台下载到 `~/.sema/{node,rg}/`**（私有缓存，不写系统目录、不改 shell 配置、不影响插件外的 node/rg）。node 由 SDK `NodeProviders` 供给，rg 由桥进程自己供给（`shared/bridge/src/rg.ts`）。

| 依赖 | 要求 | 覆写点 | 缓存 |
|---|---|---|---|
| **node** | ≥18 | `SEMA_NODE_PATH` 指现成 node，`SEMA_NODE_BASE_URL` 指镜像（默认 nodejs.org） | `~/.sema/node/` |
| **rg** | 任意可运行版本 | `SEMA_RG_PATH` 指现成 rg，`SEMA_RG_BASE_URL` 指镜像（默认 GitHub Release） | `~/.sema/rg/` |
| **sidecar** | — | `SEMA_SIDECAR_DIR`/`-Dsema.sidecar.dir`（dev 指桥产物目录） | `~/.sema/java-sdk-sidecar/`（从 SDK jar 释放） |
</content>
