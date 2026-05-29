# Claw — 把手机变成 VS Code Agent 的远程入口

手机上给微信 bot 发一句话 = 在 IDE 输入框里敲下它：消息进到本项目里的一个专属 agent 会话执行，整段结果发回手机。

Claw 是**扩展进程内的一个模块**，不是独立进程、无 HTTP、无 token。只有在配置页点「开启」后才工作，关窗即停——这是刻意设计。

---

## 设计要点

- **复用窗口已有的 SemaCore**：claw 不另起引擎，而是在当前窗口的 `SemaProcessWrapper` 上多开一个固定 id 的会话（`sessionId='__claw__'`，权限档 `Ask`）。与你自己的工作会话互不串扰。
- **懒加载，不开就零开销**：激活时只载入极薄的 `ClawCoordinator`；真正的运行时（轮询、会话、桥接、`qrcode`）打成独立 webpack chunk，只有点「绑定」或「开启」时才 `await import()` 进来。从不使用 claw 的用户不会加载这部分代码。
- **跨窗口独占**：用文件锁 `~/.sema/claw/owner.lock` 保证全局只有一个窗口在收发；另一个窗口开启时会提示“正在『项目X』使用中”。崩溃留下的脏锁由下一个开启者按 pid 存活检测接管。
- **整段回复，不流式**：agent 一轮跑完（主代理状态回 `idle`）才把完整文字作为一条消息发回，避免手机端气泡被增量刷碎。
- **风险项走手机 y/n**：permission 默认 `Ask`，遇到要确认的工具时给手机发“是否允许…？回 y/n”，回 y=本次允许 / n=拒绝。
- **headless**：claw 会话不进 chat 的会话列表，状态只在配置页看。

## 目录速览

```
coordinator.ts        常驻极薄壳：enabled 标志 + 懒载入口；配置页只跟它打交道
index.ts              懒载 chunk 入口：ClawModule（编排 锁→会话→channel→bridge）+ 绑定流程
owner-lock.ts         文件锁：claim / release + pid 存活检测（脏锁接管）
session.ts            ClawSession：在已有 SemaCore 上开/关 __claw__ 会话；/clear 时重建
bridge.ts             ★ 核心：订阅会话事件累积文字，idle 时整段发出；inbound 路由（y/n、/clear、/cancel）
credentials-store.ts  ~/.sema/claw/credentials/ 凭证读写（0600）
paths.ts              ~/.sema/claw 路径 + claw 历史文件路径（与 sema-core 规则对齐）
channels/
  types.ts            ChannelAdapter / NormalizedMessage / ReplyContext 抽象（加平台只写一个适配）
  wechat/
    adapter.ts        WeChatAdapter：起轮询收消息、整段文字发消息
    poller.ts         getUpdates 长轮询循环（带游标、可中断、失败退避）
    normalize.ts      微信消息 → 归一文本（仅文字）
    qr.ts             扫码绑定编排（含把二维码 payload 编码成 data URL）
    vendor/           从官方插件 @tencent-weixin/openclaw-weixin 搬运的协议层
```

### vendor/ 说明

`vendor/` 下是从腾讯官方微信渠道插件搬过来的纯协议代码（iLink bot API、扫码登录），只做了三处适配：去掉对 OpenClaw SDK 的依赖（换成 `shims.ts`）、去掉 `import.meta.url`、把扫码验证码的 stdin 读改成可注入回调。**改 vendor 时尽量保持和上游一致，新逻辑写在外层。**

## 主链路

```
入站  手机 ─▶ 微信后端 ─长轮询▶ poller ─normalize▶ bridge ─processUserInput▶ __claw__ 会话
处理  会话跑 agent，bridge 累积主代理输出，直到 state:update = idle
出站  bridge ─整段文字▶ adapter ─sendMessage▶ 微信后端 ─▶ 手机（一条完整回复）

穿插  遇风险项：bridge 发“回 y/n” → 手机回 y/n → respondToToolPermission → 继续
```

---

## 开发调试

### 构建 & 启动

```bash
npx webpack --watch      # 或 npm run compile（一次性）
```

然后在 VS Code 里按 **F5**（Run Extension）打开扩展宿主窗口。注意 `compile` 不是 launch 的前置任务，**F5 前先确保已 build / 在 watch**。

宿主窗口里：打开 Sema 侧栏 → 齿轮（配置）→ 左侧「Claw 远程」。

- **绑定**：点「扫码绑定」，手机微信扫码；若弹验证码，页面输入框填手机上显示的数字。凭证落在 `~/.sema/claw/credentials/`（0600）。
- **开启 / 关闭**：绑定后点「开启」抢锁并起轮询；关闭或关窗即释放。
- **远端命令**：`/clear` 清上下文、`/cancel` 中断当前任务；风险项回 `y`/`n`。

### 看日志

扩展端所有 claw 日志带 `[claw]` 前缀，打到「调试控制台」（Run and Debug 面板）。需要更细的协议日志可临时调高 vendor 日志级别：

```ts
// 任意入口处
import { setLogLevel } from './channels/wechat/vendor/shims';
setLogLevel('debug');   // 打印 getUpdates / sendMessage 的请求与响应（已脱敏 token）
```

状态文件都在 `~/.sema/claw/`：`owner.lock`（当前持有窗口）、`credentials/`、`cursors/`（长轮询游标）。claw 会话历史和普通会话一样在 `~/.sema/history/<项目>/__claw__.json`。

### 验证懒加载没被破坏

claw 运行时必须留在懒载 chunk，不能进主 bundle。build 后自查：

```bash
grep -c "ilink/bot/getupdates" dist/extension.js   # 期望 0
ls dist/*.extension.js                              # 期望出现 N.extension.js 懒载 chunk
```

**红线**：`coordinator.ts` 到 `index.ts` 之间只能走 `await import('./index.js')` 这个动态边界，不能有任何常驻代码静态 `import` 到 `index.ts` 或其下游（否则整块被拉进主 bundle，懒加载失效）。动态 import 必须写 `.js` 后缀（Node16 要求），webpack 靠 `resolve.extensionAlias` 把它映射回 `.ts`。

### 常见坑

- **F5 前忘了 build**：宿主跑的是 `dist/`，改完 `.ts` 要等 webpack 重新打包。
- **改了 vendor 的 import**：相对依赖在本仓是无后缀的（CJS 风格），别把上游的 `./x.js` 留着。
- **扫码卡住**：先看 `[claw]` 日志里 `get_qrcode_status` 的 status；`need_verifycode` 分支需要页面输入验证码回灌。
- **`.tsx` 不报类型错**：配置页 React 文件走 babel 编译、且 `src/webview` 不在 tsc 范围，类型问题不会让 build 失败，改 `ClawConfig.tsx` 时自己留意。

## 现状

文字闭环 MVP。**未做**：媒体（图片/语音/文件、CDN）、`pick:option`/`plan:exit` 两种确认（已兜底防死锁）、会话列表里的远程标识。详见根目录 `claw.md`（设计）。
