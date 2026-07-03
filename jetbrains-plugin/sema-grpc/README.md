# sema-grpc

基于 gRPC 双向流的 sema-core 桥接服务，供 C# / Java / Python 等客户端通过 gRPC 调用 sema-core 能力。

## 架构

```
客户端应用 (C# / Java / Python / ...)
    ↕ gRPC 双向流 (grpc://localhost:3766)
Node.js gRPC 服务 (sema-grpc)
    ↕ 内部调用
sema-core (npm 包)
```

## 目录结构

```
sema-grpc/
├── package.json
├── tsconfig.json
├── proto/
│   └── sema.proto        # Protobuf 协议定义
└── src/
    ├── server.ts         # gRPC 服务器入口
    └── session.ts        # 会话管理
```

## 协议说明

### Proto 定义（`proto/sema.proto`）

服务暴露单个双向流 RPC：

```protobuf
service SemaBridge {
  rpc Connect(stream BridgeCommand) returns (stream BridgeEvent);
}
```

**BridgeCommand**（客户端 → 服务端）

| 字段         | 类型   | 说明                                        |
|------------|------|---------------------------------------------|
| `id`         | string | 请求 ID，用于匹配响应                          |
| `action`     | string | 操作名，见下表                               |
| `payload`    | string | JSON 序列化的参数（可为空字符串）              |
| `session_id` | string | 目标会话 ID；**会话级 action 必填**，进程级 action 留空 |

**BridgeEvent**（服务端 → 客户端）

| 字段         | 类型   | 说明                                      |
|------------|------|-------------------------------------------|
| `event`      | string | 事件名，见下表                             |
| `data`       | string | JSON 序列化的数据（可为空字符串）           |
| `cmd_id`     | string | 对应指令的 ID（仅响应类消息携带）            |
| `session_id` | string | 事件所属会话 ID；会话级事件携带，进程级事件留空 |

### 进程与会话模型（对齐 VSCode 插件）

- **一个 Node 进程 = 一个共享的 SemaCore + 会话池**。模型 / 配置 / MCP / 插件等进程级能力全进程共享。
- **多会话**（对应 UI 多标签）通过 `session_id` 复用同一个 Core：`createSession` 的 `ack` 返回 `sessionId`，后续会话级指令用它路由，会话级事件也带上它。
- `init` **非破坏式**：首次创建 Core，再次调用只做配置合并，不会销毁已有会话。

### 支持的 Action

> **设计原则：桥是 sema-core 的透明镜像。** action 名与 sema-core 方法名一一对应，事件名保持 core 原始事件名，桥不做任何协议翻译——让"调 gRPC"等同于"调 core 方法"。UI 协议的翻译（sema-core 原始事件 → `chunkUpdate` 等）由**客户端**负责（复用 `semaSessionWrapper.ts`），不在本桥内。
>
> 路由规则：`session_id` 为空 → 调用 **SemaCore** 方法；非空 → 调用对应 **SemaSession** 方法（该会话须已 `createSession` 成功，否则返回 `error`）。`init` 是唯一例外（对应 Core 构造，core 无同名方法）。

| Action                   | 接收者 | 需 session_id | 对应 sema-core 方法 / 说明                          |
|--------------------------|--------|:---:|--------------------------------------------------|
| `init`                   | Core   | ✗ | 初始化/合并 SemaCore 配置（**非破坏式**，不销毁已有会话）  |
| `updateCoreConfig`       | Core   | ✗ | `SemaCore.updateCoreConfig(payload)`               |
| `addModel`               | Core   | ✗ | `SemaCore.addModel(config, skipValidation?)`       |
| `delModel`               | Core   | ✗ | `SemaCore.delModel(modelName)`                     |
| `switchModel`            | Core   | ✗ | `SemaCore.switchModel(modelName)`                  |
| `applyTaskModel`         | Core   | ✗ | `SemaCore.applyTaskModel({ main, quick })`         |
| `getModelData`           | Core   | ✗ | `SemaCore.getModelData()`（数据随 `ack` 的 `data` 返回）|
| `createSession`          | Core   | ✗ | `SemaCore.createSession({ sessionId? })`；`ack` 返回分配的 `sessionId`，随后触发 `session:ready` |
| `listSessions`           | Core   | ✗ | `SemaCore.listSessions()`（随 `ack` 的 `data.sessions` 返回）|
| `closeSession`           | Core   | ✓ | `SemaCore.closeSession(sessionId)`（不销毁 Core）    |
| `processUserInput`       | Session| ✓ | `SemaSession.processUserInput(content, orgContent?, attachments?)` |
| `interrupt`              | Session| ✓ | `SemaSession.interrupt()`                          |
| `respondToToolPermission`| Session| ✓ | `SemaSession.respondToToolPermission({ toolId, toolName, selected })` |
| `respondToPickOption`    | Session| ✓ | `SemaSession.respondToPickOption({ agentId, answers })` |
| `respondToPlanExit`      | Session| ✓ | `SemaSession.respondToPlanExit({ selected })`      |
| `updateAgentMode`        | Session| ✓ | `SemaSession.updateAgentMode(mode)`                |
| `updatePermissionLevel`  | Session| ✓ | `SemaSession.updatePermissionLevel(level)`         |

### 典型调用流程

```
init  ─▶  addModel  ─▶  applyTaskModel  ─▶  createSession
                                                 │
                                   等待 session:ready 事件
                                                 ▼
                     processUserInput ⇄ (message:*/tool:* 等事件流)
                                                 │
                                           closeSession
```

- 每条指令都会收到一帧 `ack`（或 `error`），其 `cmd_id` 等于指令的 `id`，可用于按序等待。
- 模型相关 action 只需配置一次，后续连接可复用。
- 交互场景建议在 `init` 的配置中加 `disabledTools: ['ask_form', 'plan_to_agent']` 禁用无法应答的工具。

### 服务端推送的事件（Event）

| Event                      | 说明              |
|----------------------------|-------------------|
| `session:ready`            | 会话已就绪，含 `sessionId` |
| `session:error`            | 会话错误           |
| `session:interrupted`      | 会话已中断          |
| `session:cleared`          | 会话已清空          |
| `state:update`             | 状态变化（`idle` / `processing`）  |
| `input:received`           | 用户输入已接收       |
| `input:processing`         | 用户输入开始处理     |
| `message:text:chunk`       | AI 文本流式输出片段  |
| `message:thinking:chunk`   | AI 思考流式输出片段  |
| `message:complete`         | 本轮消息输出完成     |
| `tool:permission:request`  | 请求工具执行权限     |
| `tool:execution:complete`  | 工具执行完成        |
| `tool:execution:chunk`     | 工具执行中间态      |
| `tool:execution:error`     | 工具执行错误        |
| `task:agent:start`         | 子 Agent 启动      |
| `task:agent:end`           | 子 Agent 结束      |
| `task:start`               | 后台任务启动        |
| `task:end`                 | 后台任务结束        |
| `todos:update`             | 待办事项更新        |
| `topic:update`             | 会话主题更新        |
| `pick:option:request`      | AI 发起选项询问     |
| `plan:exit:request`        | AI 请求退出计划模式  |
| `conversation:usage`       | Token 使用统计     |
| `file:reference`           | 文件引用信息        |
| `ack`                      | 指令确认（含 `cmd_id`）|
| `error`                    | 错误事件（含 `cmd_id`）|

## 环境要求

- Node.js 18+
- npm

## 安装与启动

```bash
cd example/sema-grpc
npm install
npm run build
npm start
```

## 环境变量

| 变量名               | 默认值          | 说明                   |
|---------------------|----------------|------------------------|
| `SEMA_BRIDGE_PORT`  | `3766`         | gRPC 服务监听端口；传 `0` 由系统分配空闲端口（多 IDE 窗口避免撞端口） |
| `SEMA_WORKING_DIR`  | 当前工作目录     | Agent 操作的目标代码仓库路径 |

> 启动后 stdout 会打印一行机器可解析的 `SEMA_BRIDGE_PORT_ACTUAL=<port>`。
> 当宿主（如 JB 插件）用 `SEMA_BRIDGE_PORT=0` 拉起 sidecar 时，可从该行读取实际端口再建立 gRPC 连接。

示例：

```bash
SEMA_BRIDGE_PORT=3766 SEMA_WORKING_DIR=/path/to/your/project npm start
```

## 快速测试

服务启动后，可使用同目录下的 `quickstart-grpc.mjs` 进行基本连通性测试：
执行前修改配置：
```javascript
// sema-grpc/quickstart-grpc.mjs
const WORKING_DIR = '/path/to/your/project';  // Agent 将操作的目标代码仓库路径
"apiKey": "sk-your-api-key",  // 替换为你的 API Key
```

执行：
```bash
cd example/sema-grpc
node quickstart-grpc.mjs
```
