# Sema Pet

跟 `src/pet/` 扩展端配套的原生桌宠进程。桌宠和扩展是两个进程，通过 `127.0.0.1:24700` 通信。扩展激活时按 `runtime.json` → `/health` 探活 → spawn 本地二进制的顺序找桌宠。

## macOS

技术栈：Swift + AppKit，源码在 `pet/macos/`。要求 macOS 12+，Swift 5.7+。

### 源码结构

Swift Package，源码全在 `pet/macos/Sources/SemaPet/`：

```
SemaPet/
├── App.swift           # 进程入口（@main），AppDelegate 装配并连线所有组件
├── Protocol.swift      # 通信数据模型：PetState 枚举、各请求 payload、PetConstants 常量
├── StateMachine.swift  # 多会话状态机，按 priority 合并算出桌宠当前显示状态
├── HttpServer.swift    # 本地 HTTP 服务，监听 24700，路由 /health /session/* /state /say /command
├── FocusBridge.swift   # /command 长轮询的 waiter 队列，挂起连接直到有指令或超时
├── Runtime.swift       # 读写 runtime.json（port/pid），供扩展探活定位桌宠
├── Config.swift        # config.json 读写，目前仅存 windowPosition
├── Paths.swift         # ~/.sema/pet 下各路径常量与目录创建
├── Assets.swift        # GIF 资源加载，用户目录优先 fallback 内嵌资源，带缓存
├── PetWindow.swift     # 承载桌宠的无边框浮动 NSPanel，恢复/校验窗口位置
├── PetView.swift       # 桌宠视图：GIF 显示、拖拽、点击、alpha 命中测试、右键菜单
├── BubblePanel.swift   # 顶部气泡面板，/say 消息落这里，最多 3 条跟随桌宠
└── Tray.swift          # 状态栏 🐾 菜单：会话列表、切换会话、退出
```

### 构建

```sh
cd pet/macos
swift build -c release          # 产物：.build/release/SemaPet
```

### 本地调试

构建产物已经在 `.build/release/SemaPet`，直接跑：

```sh
cd pet/macos
./.build/release/SemaPet
```

改了代码再重新 `swift build -c release`，没改就别重复 build（首次构建 15-20s，纯编译开销）。

确认启动正常：右下角浮窗桌宠 + 状态栏 🐾【直观可见】

### 打包

```sh
npm run pet:build                  # arm64 + x64，产物落 dist/pet/
node pet/build-zips.js arm64       # 只打单架构（本机测试快）
```

构建链：`swift build -c release` → `codesign -s -`（ad-hoc，**必须**，不签在 Apple Silicon 上会被内核直接 Killed: 9）→ `zip -yr`（`-y` 存符号链接、`-x '*.DS_Store'` 排除 Finder 垃圾文件）。swift toolchain 自带 x86_64 target，一台 Apple Silicon mac 就能同时出两架构产物，无需 Intel 机器。

验证 zip：

```sh
cd pet/macos/.build/arm64-apple-macosx/release    # x64 换 x86_64-apple-macosx/release
unzip -l sema-pet-darwin-arm64.zip            # SemaPet + SemaPet_SemaPet.bundle
file SemaPet                                  # Mach-O 64-bit executable arm64 / x86_64
codesign -dv SemaPet 2>&1 | grep Signature    # Signature=adhoc
```

## Windows

技术栈：Rust + windows-sys + Win32 API，源码在 `pet/windows/`。要求 MSVC Rust toolchain。

### 源码结构

Rust crate，源码全在 `pet/windows/src/`：

```
src/
├── main.rs             # 进程入口，初始化各组件并启动消息循环
├── lib.rs              # crate 根，导出所有公开模块
├── protocol.rs         # 通信数据模型：PetState 枚举、各请求 payload、常量
├── state_machine.rs    # 多会话状态机，按 priority 合并算出桌宠当前显示状态
├── http_server.rs      # 本地 HTTP 服务，监听 24700，路由 /health /session/* /state /say /command
├── focus_bridge.rs     # /command 长轮询的 waiter 队列，挂起连接直到有指令或超时
├── runtime.rs          # 读写 runtime.json（port/pid），供扩展探活定位桌宠
├── config.rs           # config.json 读写，目前仅存 windowPosition
├── paths.rs            # ~/.sema/pet 下各路径常量与目录创建
├── assets.rs           # GIF 资源加载，用户目录优先 fallback 内嵌资源，带缓存
├── gif_decoder.rs      # GIF 解码器，处理动画帧
├── render_window.rs    # 承载桌宠的无边框浮动窗口（Layered Window）
├── hit_window.rs       # 透明命中测试窗口，捕获鼠标点击
├── hit_region.rs       # 命中测试区域管理，支持不规则形状
├── bubble_window.rs    # 气泡窗口，/say 消息显示，最多 3 条跟随桌宠
├── bubble_store.rs     # 气泡消息存储，管理气泡生命周期
├── layered_bitmap.rs   # 分层位图渲染，支持 Alpha 通道混合
├── tray.rs             # 系统托盘图标和菜单：会话列表、切换会话、退出
├── window_coordinator.rs # 窗口协调器，管理多个窗口的显示、位置和交互
├── window_messages.rs  # 自定义窗口消息常量，用于窗口间通信
├── process.rs          # 进程管理，检测进程存活
├── vscode_launcher.rs  # VS Code 启动器，从桌宠启动 VS Code 实例
├── win32.rs            # Win32 API 封装（字符串转换等）
└── test_sprite.rs      # 开发测试用精灵，正式版未使用
```

### 构建

```powershell
cd pet/windows
cargo build --release           # 产物：target\release\SemaPet.exe
```

### 本地调试

```powershell
cd pet/windows
cargo run
```

确认启动正常：桌面浮窗 + 系统托盘图标【直观可见】

> Windows 端额外通过 `clientPid` 做 stale session 清理：VS Code 崩溃/强杀后未正常 unregister 的孤儿 session 会被定期 sweep 清理。

### 打包

Rust + MSVC 工程，**无法在 macOS 上交叉编译**，需在 Windows 机器上：

```powershell
npm run pet:build                  # 默认 x64
node pet/build-zips.js arm64       # 如需 arm64（aarch64-pc-windows-msvc）
```

默认静态链接 CRT（`RUSTFLAGS=-C target-feature=+crt-static`），zip 只含 `SemaPet.exe`。

验证 zip：

```powershell
Expand-Archive dist\pet\sema-pet-win32-x64.zip -DestinationPath tmp-pet   # 应只有 SemaPet.exe
```

## Linux

技术栈：Rust + GTK3（从 Windows 端 fork 而来），源码在 `pet/linux/`。要求 glibc 系统 + Rust toolchain + GTK3 开发包。GTK 动态链接系统库，无法 musl 静态编译。

### 源码结构

`protocol.rs`、`state_machine.rs`、`focus_bridge.rs`、`bubble_store.rs`、`hit_region.rs`、`config.rs`、`runtime.rs`、`assets.rs` 与 Windows 完全同源（纯 std + serde，原样复制）；`http_server.rs`、`paths.rs`、`process.rs`、`vscode_launcher.rs` 做了平台适配。GTK 相关模块：

```
src/
├── main.rs             # 进程入口，gtk::init 后装配组件并跑 gtk::main
├── lib.rs              # crate 根，导出所有公开模块
├── messages.rs         # UiMessage 枚举：HTTP/托盘线程通过 glib channel 通知 UI 线程
├── http_server.rs      # 本地 HTTP 服务，监听 24700；PostMessageW 换成 glib::Sender
├── gif_animation.rs    # GIF 动画，基于 gdk-pixbuf 的 PixbufAnimation 原生解码
├── pet_window.rs       # 承载桌宠的透明异形 GTK 窗口，input shape 做点击穿透 + 拖拽
├── bubble_window.rs    # 单个透明点击穿透气泡窗，cairo + Pango 绘制
├── bubble_store.rs     # 气泡消息存储，管理气泡生命周期
├── bubble_stack.rs     # 管理最多 3 个气泡窗，跟随桌宠定位
├── tray.rs             # ksni 实现的 StatusNotifierItem 托盘：会话列表、切换会话、退出
└── app.rs              # 协调器：持有桌宠窗/气泡栈/托盘，处理 UiMessage、窗口定位
```

> 不规则窗口在 Linux 只需一个窗口：用 `input_shape_combine_region` 直接给桌宠窗设命中区域，无需 Windows 那样独立的 hit window。托盘走 D-Bus 的 StatusNotifierItem 协议，X11/Wayland 通用；GNOME 原生无 SNI host，需装 AppIndicator 扩展才显示托盘图标，但右键桌宠始终能出同一份菜单。

> 菜单视觉：mac/win 的会话项前有状态色圆点。Linux 不画圆点——SNI 托盘菜单由系统 host 渲染，图标位置/间距完全不可控，与本地 GTK 右键菜单无法做到视觉一致，因此两边都只用 `项目 — working` 纯文本，靠 state 文字传达状态。会话按 `(priority desc, last_event_at desc)` 排序，最高优先级排在最上（与 mac 一致）。

> 聚焦行为：与 mac `FocusBridge::dispatchFocus` 对齐，每次都做三件事：
> 1. 通过 X11 `_NET_ACTIVE_WINDOW` ClientMessage 把对应 VSCode 顶层窗口 raise + 取消最小化（按 `_NET_WM_PID` → `/proc/<pid>/cwd` 匹配 cwd）。这是 Linux 端额外的步骤——mac 的 `code` CLI 自身就会 raise 已开窗口，Linux 的 `code` CLI 不会（甚至弹"已就绪" toast），所以我们绕开走 X11 协议自己做。逻辑在 `x11_activate.rs`。
> 2. spawn `code <cwd>`：负责 VS Code 没在跑时拉起新实例。
> 3. 发 focus 命令给扩展端：focus 编辑器组与 sema 侧栏。
>
> 纯 Wayland（无 XWayland）下 X11 raise 不可用，会安静回退到 spawn+focus，效果降级到"VS Code 弹 toast 用户再点一下"。

### 构建

```sh
# Debian/Ubuntu 安装依赖（含 gdk-pixbuf / cairo / pango / glib）
sudo apt install libgtk-3-dev pkg-config

cd pet/linux
cargo build --release           # 产物：target/release/SemaPet
```

### 本地调试

```sh
cd pet/linux
cargo run
```

确认启动正常：
- 桌面浮窗桌宠【直观可见】
- 系统托盘图标（GNOME 需装 AppIndicator 扩展才显示；右键桌宠永远能出菜单）

> Wayland 下普通 GTK 窗口不能自定位、置顶仅是 hint，桌宠位置/层级由合成器决定，属已知降级；X11 下效果完整。

### 打包

Rust + GTK3 工程，**无法在 macOS 上交叉编译**，需在 Linux 机器上：

```sh
npm run pet:build                  # 仅 x64
```

走 host glibc target（`x86_64-unknown-linux-gnu`），**不用 musl、不静态链接**——GTK 必须动态链接系统库。zip 只含 `SemaPet`。

## 协议手测

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

## 扩展并连本地桌宠

F5 启动 Extension Development Host → 在 Sema Code 侧栏 → 配置 → 系统配置 → 基础设置勾选「启用桌宠」。

- 本地已经跑了 SemaPet（macOS `./.build/release/SemaPet`，Windows `SemaPet.exe`）→ launcher `ping /health` 通，直接复用，不会触发解压
- 本地没跑 → launcher 从扩展的 `dist/pet/sema-pet-<platform>-<arch>.zip` 解压到 `~/.sema/pet/bin/<platform>-<arch>/` → spawn
- 想测解压路径，先 `rm -rf ~/.sema/pet/bin/` 再勾选

> 桌宠开关状态存在 VS Code 的 globalState 里，不在 `~/.sema/pet/config.json`（旧设计已废弃，该文件现仅留 `windowPosition` 供桌宠自身记录）。

## 美术资源

加载顺序：`~/.sema/pet/assets/<state>.gif` 存在就用用户文件，否则 fallback 到内嵌默认资源。三平台共用一份默认资源，统一维护在 `pet/macos/Assets/`：macOS 打进 bundle，Windows / Linux 通过 `include_bytes!` 编译进 `SemaPet` 并在启动时 seed 到用户 assets 目录。

覆盖同名文件即可热替换，下次状态切换生效，无需重启。想跑一遍干净流程：

```sh
# macOS
rm -rf ~/.sema/pet/assets
./.build/release/SemaPet        # 启动会 seed 默认资源

# Windows
Remove-Item -Recurse -Force ~\.sema\pet\assets
cargo run                        # 启动会 seed 默认资源
```

## 打包发布

桌宠源码不常动，一份 zip 能复用很多个扩展版本。改动后才需要走这一节。

桌宠各平台 zip 统一发布到 GitHub 的 `pet-assets` Release —— 一个固定 tag、无版本号、只保留最新一份，与扩展版本号无关。zip 命名严格对齐 `process.platform-process.arch`：`sema-pet-darwin-arm64.zip` / `sema-pet-darwin-x64.zip` / `sema-pet-win32-x64.zip` / `sema-pet-linux-x64.zip`。

得到桌宠 zip 有两条路，产物落点都是 `dist/pet/`：

| 命令 | 作用 | 场景 |
|---|---|---|
| `npm run pet:fetch` | 从 `pet-assets` Release 拉全平台最新 zip | 日常发布扩展 |
| `npm run pet:build` | 现场编译**当前平台**桌宠 | 改了桌宠源码、需要更新 Release |

`pet/build-zips.js` 按 `process.platform` 分派：macOS 走 `swift`，Windows / Linux 走 `cargo`；`pet/fetch-zips.js` 走 https 下载。两者互斥，别在同一次发布里混用。各平台具体打包命令见上文对应小节。

**上传**：把 `dist/pet/` 下对应的 zip 手动拖到 `pet-assets` Release（覆盖同名旧文件）。三平台的 zip 都汇集在这一个 Release，之后任何人 `npm run pet:fetch` 就能拿到最新版。

### 扩展怎么消费 zip

`npm run compile` 只做 webpack，不碰桌宠 zip —— zip 由 `pet:fetch` / `pet:build` 直接放进 `dist/pet/`。`.vscodeignore` 含 `!dist/pet/*.zip`，而 `package-all.sh` 打包时会清空 `dist/pet/` 只放当前平台那一份（如 `darwin-arm64` 包只含 `sema-pet-darwin-arm64.zip`，`linux-x64` 包只含 `sema-pet-linux-x64.zip`），运行时 launcher 直接取用。完整发布流程见 `src/README.md`。

## 常见问题

| 现象 | 排查 |
|---|---|
| 端口 24700 被占 | `lsof -nP -iTCP:24700` 找进程，多半是上次没退干净，`kill` 掉 |
| 浮窗不见 | 多屏时可能在屏外，删 `config.json` 的 `windowPosition` 字段重置 |
| Gatekeeper 拦 | `xattr -dr com.apple.quarantine ./.build/release/SemaPet` |
| GIF 错帧 | `rm -rf ~/.sema/pet/assets` 让进程重新 seed |
| Linux 起不来 / 报缺 .so | 缺 GTK 运行时库，装 `libgtk-3-0`（及 gdk-pixbuf/cairo/pango/glib 运行时包）；`ldd ./SemaPet` 看缺哪个 |
| Linux 托盘图标不显示 | GNOME 原生无 SNI host，装 AppIndicator 扩展；或直接右键桌宠出菜单 |
| Linux 桌宠不透明 / 位置不对 | Wayland 下定位/置顶受协议限制属已知降级；X11 需有合成器才透明，无合成器会显示黑底 |
