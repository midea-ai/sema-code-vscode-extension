# sema-grpc

基于 gRPC 双向流的 sema-core 桥接服务，供 C# / Java / Kotlin / Python 等客户端通过 gRPC 调用 sema-core 能力。当前主要作为 JetBrains 插件的 sidecar 进程使用。

## 架构

```
客户端应用 (JB 插件 / C# / Java / Python / ...)
    ↕ gRPC 双向流 (grpc://127.0.0.1:3766)
Node.js gRPC 服务 (sema-grpc)
    ↕ 内部调用
sema-core (npm 包)
```

## 目录结构

```
sema-grpc/
├── package.json
├── tsconfig.json
├── esbuild.mjs           # 单文件打包脚本（bundle 出 dist/server.js）
├── proto/
│   └── sema.proto        # Protobuf 协议定义（同时生成 Java/Kotlin 类）
└── src/
    ├── server.ts         # gRPC 服务器入口 + action 路由
    ├── core.ts           # SemaCoreManager：进程级单例 Core + 会话池
    └── session.ts        # SessionBinder：会话级事件桥接到 gRPC 流
```

> 构建产物为单个 `dist/server.js`（esbuild 把 `src/server.ts` 与 sema-core 一起打包），
> 运行时仅依赖系统 `node` 与同级的 `proto/sema.proto`，不再需要 `node_modules`。

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

> proto 里带有 `java_package = "com.sema.grpc"` 等选项，供 JB 插件生成 Java/Kotlin 类；proto-loader 的 JS 侧会忽略这些选项。

### 进程与会话模型（对齐 VSCode 插件）

- **一个 Node 进程 = 一个共享的 SemaCore + 会话池**。模型 / 配置 / MCP / 插件等进程级能力全进程共享。
- **多会话**（对应 UI 多标签）通过 `session_id` 复用同一个 Core：`createSession` 的 `ack` 返回 `sessionId`，后续会话级指令用它路由，会话级事件也带上它。
- `init` **非破坏式**：首次创建 Core，再次调用只做就绪确认（**不再用 seed 覆盖已有配置**），不会销毁已有会话。多面板（chat / config / history）共享同一进程单 Core，后打开的面板也会发 `init`。
- **多连接**：JB 各面板（聊天页 / 配置页 / 后台任务面板）各建一条独立 gRPC 连接。单连接 push 到不了兄弟面板，因此跨面板同步（如模型变更、后台任务生命周期）由服务端**广播**合成事件到每条连接。

### 支持的 Action

> **设计原则：桥是 sema-core 的透明镜像。** action 名与 sema-core 方法名一一对应，事件名保持 core 原始事件名，桥不做任何协议翻译——让"调 gRPC"等同于"调 core 方法"。UI 协议的翻译（sema-core 原始事件 → `chunkUpdate` 等）由**客户端**负责（复用 `semaSessionWrapper.ts` / `config-controller` 等），不在本桥内。
>
> 路由规则：`session_id` 为空 → 调用 **SemaCore** 方法；非空 → 调用对应 **SemaSession** 方法（该会话须已 `createSession` 成功，否则返回 `error`）。`init` 是唯一例外（对应 Core 构造，core 无同名方法）。
>
> **ack 语义**：多数配置/查询类 action 的 `ack.data` 直接回传 sema-core 原始返回值（下表标注 ✓）；纯命令类（如 `interrupt`）的 `ack.data` 只回 `{ action }`。

#### 生命周期与会话（Core，进程级）

| Action             | 需 session_id | ack 回原始返回值 | 对应 sema-core 方法 / 说明                        |
|--------------------|:---:|:---:|--------------------------------------------------|
| `init`             | ✗ | — | 初始化/确认 SemaCore 就绪（**非破坏式**，不销毁已有会话），ack 回 `{ ready: true }` |
| `updateCoreConfig` | ✗ | ✗ | `SemaCore.updateCoreConfig(payload)`             |
| `createSession`    | ✗ | — | `SemaCore.createSession({ sessionId?, permissionLevel?, mode? })`；`ack` 返回分配的 `sessionId`，随后触发 `session:ready` |
| `listSessions`     | ✗ | ✓ | 随 `ack` 的 `data.sessions` 返回会话 ID 列表        |
| `closeSession`     | ✓ | ✗ | `SemaCore.closeSession(sessionId)`（不销毁 Core）  |

#### 会话交互（Session，需 session_id）

| Action                     | ack 回原始返回值 | 对应 sema-core 方法                              |
|----------------------------|:---:|--------------------------------------------------|
| `processUserInput`         | ✗ | `SemaSession.processUserInput(content, orgContent?, attachments?)` |
| `interrupt`                | ✗ | `SemaSession.interrupt()`                        |
| `respondToToolPermission`  | ✗ | `SemaSession.respondToToolPermission({ toolId, toolName, selected })` |
| `respondToPickOption`      | ✗ | `SemaSession.respondToPickOption({ agentId, answers })` |
| `respondToPlanExit`        | ✗ | `SemaSession.respondToPlanExit({ selected })`    |
| `updateAgentMode`          | ✗ | `SemaSession.updateAgentMode(mode)`              |
| `updatePermissionLevel`    | ✗ | `SemaSession.updatePermissionLevel(level)`       |

#### Fork / 撤销 / 后台子 Agent（Session，需 session_id）

| Action                      | ack 回原始返回值 | 说明                                             |
|-----------------------------|:---:|--------------------------------------------------|
| `getForkPreview`            | ✓ | `getForkPreview(messageUuid)`：撤销回退预览        |
| `fork`                      | ✓ | `fork(messageUuid, options)`：从指定消息 fork      |
| `stopAllTasks`             | ✓ | Stop 时一并停后台子 agent；ack 回 `{ count }`     |
| `transferAgentToBackground` | ✓ | 子 agent 转后台；ack 回 `{ ok: boolean }`         |

#### 模型（Core，进程级）

| Action                | ack 回原始返回值 | 说明 / 附带行为                                   |
|-----------------------|:---:|--------------------------------------------------|
| `addModel`            | ✓ | `addModel(config, skipValidation?)`，并广播 `model:update` |
| `delModel`            | ✓ | `delModel(modelName)`，并广播 `model:update`      |
| `switchModel`         | ✓ | `switchModel(modelName)`，并广播 `model:update`   |
| `applyTaskModel`      | ✓ | `applyTaskModel({ main, quick })`，并广播 `model:update` |
| `getModelData`        | ✓ | `getModelData()`                                 |
| `fetchAvailableModels`| ✓ | `fetchAvailableModels(payload)`                  |
| `testApiConnection`   | ✓ | `testApiConnection(payload)`                     |
| `getModelAdapter`     | ✓ | `getModelAdapter(provider, modelName, baseURL)`  |

#### 工具 / 系统配置（Core，进程级）

| Action               | ack 回原始返回值 | 说明                                      |
|----------------------|:---:|-------------------------------------------|
| `getToolInfos`       | ✓ | `getToolInfos()`                          |
| `updateDisabledTools`| ✗ | `updateDisabledTools(disabledTools)`      |
| `updateCoreConfByKey`| ✗ | `updateCoreConfByKey(key, value)`         |

#### 后台任务面板（Core，跨会话聚合）

| Action        | ack 回原始返回值 | 说明                                             |
|---------------|:---:|--------------------------------------------------|
| `getTaskList` | ✓ | 遍历所有会话聚合任务，每项打上归属 `sessionId`      |
| `stopTask`    | ✗ | 按 `taskId` 全局生效（借道任一会话转发）           |
| `watchTask`   | ✗ | 订阅任务流式增量，delta 合成进程级事件 `task:watch:delta` 上行（幂等：重复 watch 先取消旧的） |
| `unwatchTask` | ✗ | 取消对应 `taskId` 的订阅                          |

#### 插件市场 / Plugins（Core，进程级）

| Action                          | 说明                                             |
|---------------------------------|--------------------------------------------------|
| `getMarketplacePluginsInfo`     | 获取插件市场信息                                  |
| `refreshMarketplacePluginsInfo` | 刷新插件市场信息                                  |
| `addMarketplaceFromGit`         | `addMarketplaceFromGit(repo)`                    |
| `addMarketplaceFromDirectory`   | `addMarketplaceFromDirectory(dirPath)`           |
| `updateMarketplace`             | `updateMarketplace(marketplaceName)`             |
| `removeMarketplace`             | `removeMarketplace(marketplaceName)`             |
| `installPlugin` / `uninstallPlugin` | `(pluginName, marketplaceName, scope, projectPath)` |
| `enablePlugin` / `disablePlugin` / `updatePlugin` | 同上参数签名                      |

> 以上 action 均无需 `session_id`，`ack.data` 回 core 原始返回值。

#### Agents / Skills / Commands（Core，进程级）

| Action              | 说明                                             |
|---------------------|--------------------------------------------------|
| `getAgentsInfo`     | `getAgentsInfo(true, refresh?)`                  |
| `addAgentConf` / `removeAgentConf` | 新增 / 删除 agent 配置             |
| `getSkillsInfo`     | `getSkillsInfo(true, refresh?)`                  |
| `removeSkillConf`   | 删除 skill 配置                                   |
| `getCommandsInfo`   | `getCommandsInfo(true, refresh?)`                |
| `addCommandConf` / `removeCommandConf` | 新增 / 删除 command 配置       |

#### MCP（Core，进程级）

| Action                | 说明                                             |
|-----------------------|--------------------------------------------------|
| `getMCPServerInfo`    | 获取 MCP server 信息                              |
| `refreshMCPServerInfo`| 刷新 MCP server 信息                              |
| `addMCPServer` / `removeMCPServer` | 新增 / 删除 MCP server              |
| `reconnectMCPServer`  | 重连 MCP server                                  |
| `enableMCPServer` / `disableMCPServer` | 启用 / 停用 MCP server         |
| `updateMCPUseTools`   | `updateMCPUseTools(name, toolNames)`             |

#### Cron（Core，进程级）

| Action            | 说明                                             |
|-------------------|--------------------------------------------------|
| `getCronTasks`    | 获取定时任务列表                                  |
| `deleteCronTask`  | `deleteCronTask(id)`（同步返回 boolean）          |
| `enableCronTask` / `disableCronTask` | 启用 / 停用定时任务（同步返回 boolean） |

#### Memory / Rule / Design（Core，只读）

| Action                 | 说明                                             |
|------------------------|--------------------------------------------------|
| `getMemoryInfo`        | `getMemoryInfo(refresh?)`                        |
| `getRuleInfo`          | `getRuleInfo(refresh?)`                          |
| `getDesignSkillsInfo`  | `getDesignSkillsInfo(refresh?)`                  |
| `getDesignSystemsInfo` | `getDesignSystemsInfo(refresh?)`                 |

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

#### 会话级事件（携带 `session_id`）

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
| `tool:permission:auto`     | 工具权限自动放行     |
| `tool:execution:complete`  | 工具执行完成        |
| `tool:execution:chunk`     | 工具执行中间态      |
| `tool:execution:error`     | 工具执行错误        |
| `task:agent:start`         | 子 Agent 启动      |
| `task:agent:end`           | 子 Agent 结束      |
| `task:start`               | 后台任务启动（同时跨连接广播） |
| `task:transfer`            | 任务转后台（同时跨连接广播） |
| `task:end`                 | 后台任务结束（同时跨连接广播） |
| `todos:update`             | 待办事项更新        |
| `topic:update`             | 会话主题更新        |
| `pick:option:request`      | AI 发起选项询问     |
| `plan:exit:request`        | AI 请求退出计划模式  |
| `plan:implement`           | 计划开始实施        |
| `compact:exec`             | 上下文压缩执行      |
| `conversation:usage`       | Token 使用统计     |
| `file:reference`           | 文件引用信息        |
| `permissionLevel:update`   | 权限档位变化        |
| `quickchat:response`       | 快捷问答响应        |

> `task:start` / `task:transfer` / `task:end` 三类后台任务生命周期事件除按 `session_id` 推送外，还会**跨连接广播**（`session_id` 留空），让没有会话的配置页后台任务面板实时增删。

#### 进程级事件（`session_id` 留空）

| Event               | 说明                                       |
|---------------------|--------------------------------------------|
| `cron:update`       | 定时任务变化                                |
| `mcp:server:status` | MCP server 状态变化                         |
| `model:update`      | 模型变更（合成事件，广播到所有连接以同步各面板） |
| `task:watch:delta`  | `watchTask` 订阅的任务流式增量               |

#### 通用响应事件

| Event   | 说明                    |
|---------|-------------------------|
| `ack`   | 指令确认（含 `cmd_id`）  |
| `error` | 错误事件（含 `cmd_id`，`data` 为 `{ message, action }`）|

## 环境要求

- Node.js 18+
- npm（仅构建期需要；运行期仅需系统 node）

## 安装与启动

```bash
cd jetbrains-plugin/sema-grpc
npm install
npm run build     # esbuild 打出单文件 dist/server.js
npm start         # node dist/server.js
```

开发调试（ts-node 直跑源码）：

```bash
npm run dev
```

## 环境变量

| 变量名               | 默认值          | 说明                   |
|---------------------|----------------|------------------------|
| `SEMA_BRIDGE_PORT`  | `3766`         | gRPC 服务监听端口；传 `0` 由系统分配空闲端口（多 IDE 窗口避免撞端口） |
| `SEMA_WORKING_DIR`  | 当前工作目录     | Agent 操作的目标代码仓库路径 |

> 服务只监听 `127.0.0.1`（本机回环），不对外暴露。
> 启动后 stdout 会打印一行机器可解析的 `SEMA_BRIDGE_PORT_ACTUAL=<port>`。
> 当宿主（如 JB 插件）用 `SEMA_BRIDGE_PORT=0` 拉起 sidecar 时，可从该行读取实际端口再建立 gRPC 连接。

示例：

```bash
SEMA_BRIDGE_PORT=3766 SEMA_WORKING_DIR=/path/to/your/project npm start
```
