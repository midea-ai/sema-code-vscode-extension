# Sema Pet

跟 `src/pet/` 扩展端配套的原生桌宠进程。

- macOS：Swift + AppKit，见 `pet/macos/`
- Windows：计划中，见 `pet/windows/`

桌宠和扩展是两个进程，通过 `127.0.0.1:24700` 通信。扩展激活时按 `runtime.json` → `/health` 探活 → spawn 本地二进制的顺序找桌宠。

## 构建

要求：macOS 12+，Swift 5.7+。

```sh
cd pet/macos
swift build -c release          # 产物：.build/release/SemaPet
```

## 本地调试

构建产物已经在 `.build/release/SemaPet`，直接跑：

```sh
cd pet/macos
./.build/release/SemaPet
```

改了代码再重新 `swift build -c release`，没改就别重复 build（首次构建 15-20s，纯编译开销）。

确认启动正常：
- 右下角浮窗桌宠 + 状态栏 🐾 【直观可见】

### 协议手测

不开扩展，curl 直接验证：

```sh
# 注：cwd 用一个 VS Code 已 trust 过的目录，否则点桌宠/会话项时
# VS Code 会弹 "Workspace Trust" 对话框。

# 1. 注册一个会话（模拟一个 VS Code 窗口接入桌宠）
#    sessionId 是会话唯一标识，后续所有请求都用它定位会话
#    cwd 用于桌宠菜单展示项目名（取末段 basename）
curl -s -X POST http://127.0.0.1:24700/session/register \
  -H 'content-type: application/json' \
  -d '{"sessionId":"sema-demo-1","cwd":"/Users/zhoujie195/sema-demo"}'

# 2. 上报会话状态（驱动桌宠切换动画/表情）
#    state 常见值：idle / thinking / working / attention / done 等
curl -s -X POST http://127.0.0.1:24700/state \
  -H 'content-type: application/json' \
  -d '{"sessionId":"sema-demo-1","state":"thinking"}'

# 3. 让桌宠"说话"（顶部气泡弹一条消息）
#    kind: info / warn / error 等，影响气泡样式
#    ttlMs: 气泡停留毫秒数，到期自动消失
curl -s -X POST http://127.0.0.1:24700/say \
  -H 'content-type: application/json' \
  -d '{"sessionId":"sema-demo-1","text":"hello","kind":"info","ttlMs":5000}'

# 4. 拉取用户在桌宠上触发的指令（点击托盘菜单等会落到这里）
#    扩展端长轮询这个接口，没指令就返回空
curl -s "http://127.0.0.1:24700/command?sessionId=sema-demo-1"

# 5. 注销会话（VS Code 窗口关闭时调）
#    最后一个 session 注销后桌宠会自动退出，方便清场
curl -s -X POST http://127.0.0.1:24700/session/unregister \
  -H 'content-type: application/json' \
  -d '{"sessionId":"sema-demo-1"}'
```

最后一个 session 注销后桌宠自动退出。

### 扩展并连本地桌宠

F5 启动 Extension Development Host → 在 Sema Code 侧栏 → 配置 → 系统配置 → 基础设置勾选「启用桌宠」。

- 本地已经跑了 SemaPet（`./.build/release/SemaPet`）→ launcher `ping /health` 通，直接复用，不会触发解压
- 本地没跑 → launcher 从扩展的 `dist/pet/sema-pet-darwin-<arch>.zip` 解压到 `~/.sema/pet/bin/<arch>/SemaPet` → spawn
- 想测解压路径，先 `rm -rf ~/.sema/pet/bin/` 再勾选

> 桌宠开关状态存在 VS Code 的 globalState 里，不在 `~/.sema/pet/config.json`（旧设计已废弃，该文件现仅留 `windowPosition` 供桌宠自身记录）。

## 美术资源

加载顺序：`~/.sema/pet/assets/<state>.gif` 存在就用用户文件，否则 fallback 到 bundle 内嵌资源。

覆盖同名文件即可热替换，下次状态切换生效，无需重启。想跑一遍干净流程：

```sh
rm -rf ~/.sema/pet/assets
./.build/release/SemaPet        # 启动会 seed 默认资源
```

## 常见问题

| 现象 | 排查 |
|---|---|
| 端口 24700 被占 | `lsof -nP -iTCP:24700` 找进程，多半是上次没退干净，`kill` 掉 |
| 浮窗不见 | 多屏时可能在屏外，删 `config.json` 的 `windowPosition` 字段重置 |
| Gatekeeper 拦 | `xattr -dr com.apple.quarantine ./.build/release/SemaPet` |
| GIF 错帧 | `rm -rf ~/.sema/pet/assets` 让进程重新 seed |

## 打包桌宠

桌宠 zip 跟扩展一起发布（具体集成流程见 `src/README.md`）。这里只讲怎么得到桌宠 zip。

两架构 zip 各 ~130KB，命名严格对齐 `process.platform-process.arch`。

### macOS

一键打 arm64 + x64 两个 zip：

```sh
bash pet/macos/build-zips.sh
```

脚本每个架构都走完整 `swift build -c release` → `codesign -s -`（ad-hoc，必须，**不签 Apple Silicon 上会被内核直接 Killed: 9**）→ `zip -y`。swift toolchain 自带 x86_64 target，一台 Apple Silicon mac 就能同时出两架构产物，无需找 Intel 机器。

| 架构 | 构建命令 | 产物路径 |
|---|---|---|
| arm64 | `swift build -c release --arch arm64` | `pet/macos/.build/arm64-apple-macosx/release/sema-pet-darwin-arm64.zip` |
| x64 | `swift build -c release --arch x86_64` | `pet/macos/.build/x86_64-apple-macosx/release/sema-pet-darwin-x64.zip` |

手动验证 zip（可选）：

```sh
cd pet/macos/.build/arm64-apple-macosx/release    # x64 换 x86_64-apple-macosx/release
unzip -l sema-pet-darwin-arm64.zip            # 应该只有一行：SemaPet
file SemaPet                                  # Mach-O 64-bit executable arm64 / x86_64
codesign -dv SemaPet 2>&1 | grep Signature    # Signature=adhoc
```

### Windows

暂未实现。扩展 UI 端已自动禁用开关，不需要产物。规划见 `pet/windows/`。

预留命名：`sema-pet-win32-x64.zip`。
