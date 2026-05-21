# Sema Pet × Claude Code

让 Claude Code 用上桌宠 SemaPet：开会话时桌宠自动出现并跟随状态（工作 / 等你确认 / 空闲），结束自动退出。靠 Claude Code 的 **hooks** 驱动，装一次即可。

## 前置

- 本机装了 Node（跑 Claude Code 一般都有）。
- 系统是 macOS / Windows / Linux 之一。

## 安装

无需 clone 本仓库，终端一行即可：

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/midea-ai/sema-code-vscode-extension/main/pet/claude-code/bootstrap.js | node
```

**Windows（PowerShell）**

```powershell
irm https://raw.githubusercontent.com/midea-ai/sema-code-vscode-extension/main/pet/claude-code/bootstrap.js -OutFile "$env:TEMP\sema-pet-bootstrap.js"; node "$env:TEMP\sema-pet-bootstrap.js"
```

**新开的 Claude Code 会话即生效**（已经开着的会话要重启）。装完就不用管了——首次会话时会自动从 GitHub 拉桌宠二进制并启动。

> - 引导脚本会把 hook 运行时脚本拉到稳定路径 `~/.sema/pet/claude-code/`，再把桌宠 hook 追加进用户级 `~/.claude/settings.json`，**不动你已有的其它配置**。可重复运行。
> - 国内访问 raw 较慢时，可设环境变量 `SEMA_PET_RAW_BASE` 指向镜像源后再跑（例如 `SEMA_PET_RAW_BASE=<镜像>/pet/claude-code curl ... | node`）。

## 使用

无需手动操作。开一个 Claude Code 会话，桌宠就会在桌面出现并跟着你当前会话变状态：

| 你在做什么 | 桌宠状态 |
|---|---|
| 发出一句话、正在执行工具（跑命令、改文件…） | 工作 |
| 需要你确认权限 | 关注（弹气泡「需要你确认」） |
| 回复结束 | 空闲 |

多个 Claude Code 会话（甚至加上 VS Code 里的 Sema）会注册进同一个桌宠，桌宠按优先级显示最需要关注的那个。最后一个会话结束后桌宠自动退出。

## 不支持的情况

**用户主动停止本轮后，桌宠不会立刻回到空闲，会停在当前状态直到你下一次输入。**

具体两种：

- 在权限弹窗上点**拒绝**、或弹窗出现时按 **Esc 中断** → 桌宠停在「关注」，「需要你确认」气泡不会马上消失；
- 纯文本回复（没有工具调用）说到一半被 **Esc 中断** → 桌宠停在「工作」。

**原因**：桌宠完全靠 Claude Code 的 hook 驱动状态，而 Claude Code 在「用户主动停止本轮」（Esc 中断、拒绝权限）时**不触发任何收尾 hook**——`Stop` 不发、`Notification` 也不发，桌宠收不到「本轮结束了」的信号，只能停在停止前的状态。等你下一次输入，`UserPromptSubmit` 会把它切回「工作」从而恢复，所以残留只持续到你的下一次操作。

> 注：「权限弹窗 → 关注」本身是**即时**的（靠 `PermissionRequest` hook 在弹窗显示前同步触发）；缺的只是「停止后的回落」信号。要彻底即时回落，需改用阻塞式 HTTP hook 接管权限连接的生命周期（连接关闭即弹窗结束），成本较高，暂未做。

## 卸载

```sh
node ~/.sema/pet/claude-code/install.js --uninstall   # 从 ~/.claude/settings.json 摘掉桌宠 hook
rm -rf ~/.sema/pet                                     # 可选：清掉脚本本体 + 已下载的桌宠二进制
```

## 常见问题

| 现象 | 处理 |
|---|---|
| 桌宠没出现 | 端口被占？`lsof -nP -iTCP:24700`。或下载失败：`node ~/.sema/pet/claude-code/hook.js __ensure test "$(pwd)" 0` 看 stderr 报错。 |
| 想升级 / 重装脚本 | 重跑上面的一行安装命令即可重新拉最新脚本（幂等，会覆盖 `~/.sema/pet/claude-code/`）。 |
| 点桌宠没反应 | 目前 Claude Code 端不支持点击聚焦（终端程序的限制），桌宠只做状态展示。 |
| 强关终端后桌宠菜单残留失效会话 | 没正常结束会话就不会注销，重启桌宠或正常退出会话即清。 |
| 想强制重新下载桌宠 | `rm -rf ~/.sema/pet/bin`，下次开会话重新拉。 |

## 实现说明（简）

`bootstrap.js` 是 `curl | node` 的一行入口，从 GitHub raw 把脚本拉到稳定路径 `~/.sema/pet/claude-code/` 再调 `install.js`；`install.js` 负责注册 hook（本地有 checkout 时也能直接 `node pet/claude-code/install.js` 跑），它把每个 Claude Code 事件映射成桌宠协议指令写进 settings。`hook.js` 是分派器，但**不认识 Claude 的 hook 名**——它只认协议指令（`register` / `state` / `say` / `unregister`），收到后调 `lib/` 里的客户端，通过 `127.0.0.1:24700` 把状态发给桌宠进程；多个 hook 可共用同一条指令。桌宠本体（三平台原生进程、zip 来源、协议）见 [`../README.md`](../README.md)。
