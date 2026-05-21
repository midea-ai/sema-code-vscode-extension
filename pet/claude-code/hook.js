#!/usr/bin/env node
//
// Claude Code 桌宠 hook 分派器。
//
// 用法：node hook.js <command> [arg] [onlyWhenNotificationType]
//   command 直接就是桌宠协议指令（见 ../README.md），hook.js 不认识 Claude 的 hook 名：
//     register                          注册会话（首个会话顺带拉起桌宠并置 idle）
//     state <idle|working|attention>    推送状态
//     say <text>                        弹气泡
//     unregister                        注销会话
//   第三个参数可选：按 notification_type 过滤，不匹配就跳过（通用能力，当前映射未用到）。
//
// 哪个 hook 触发哪条指令由 install.js 写进 ~/.claude/settings.json，多个 hook 可共用同一指令：
//   SessionStart       → register
//   UserPromptSubmit   → state working
//   PostToolUse        → state working
//   PermissionRequest  → state attention + say 需要你确认
//   Stop               → state idle
//   SessionEnd         → unregister
//
// attention 用 PermissionRequest（权限弹窗显示前同步触发，无延迟），不用 Notification——
// 后者对权限通知有 ~60s 的 idle 延迟，会让桌宠切 attention 明显滞后。
//
// 已知不支持：用户主动停止本轮（Esc 中断、在弹窗上拒绝权限）时，Claude Code 不触发任何收尾
// hook（Stop / Notification 都不发），桌宠会停在 attention/working，直到下次输入（UserPromptSubmit
// → working）才恢复。原因与权衡见 README「不支持的情况」。
//
// 设计要点：全程吞异常、始终 exit(0)，绝不返回退出码 2 —— 桌宠挂了/没装不能影响 Claude，
// 也不能误 block 工具调用。

'use strict';

const { spawn } = require('child_process');
const client = require('./lib/client');
const { ensurePetRunning } = require('./lib/launcher');

const command = process.argv[2];
const arg = process.argv[3];
const onlyNotificationType = process.argv[4]; // 可选：仅当 notification_type 匹配才执行

async function main() {
  // 内部指令：detached 子进程承担下载/解压/启动/注册这些耗时活，
  // register hook 本体 spawn 完它就立即退出，不阻塞 Claude。
  if (command === '__ensure') {
    const sessionId = process.argv[3];
    const cwd = process.argv[4];
    const clientPid = parseInt(process.argv[5], 10);
    if (!sessionId) return;
    const ok = await ensurePetRunning();
    if (!ok) return;
    const registered = await client.register(
      sessionId, cwd, Number.isInteger(clientPid) ? clientPid : undefined,
    );
    if (registered) await client.state(sessionId, 'idle');
    return;
  }

  const data = parseJson(await readStdin());
  const sessionId = data.session_id;
  if (!sessionId) return; // 没 sessionId 无法定位会话，直接放弃

  // 通知类型过滤：settings.json 给了第三个参数时，只在该类型通知下执行（其它通知忽略）。
  if (onlyNotificationType && data.notification_type !== onlyNotificationType) return;

  switch (command) {
    case 'register': {
      const cwd = data.cwd || process.cwd();
      const clientPid = process.ppid; // hook 的父进程即 claude 主进程（stdin 无 PID，只能兜底）
      const child = spawn(
        process.execPath,
        [__filename, '__ensure', sessionId, cwd, String(clientPid)],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
      break;
    }
    case 'state':
      await client.state(sessionId, arg);
      break;
    case 'say':
      await client.say(sessionId, arg, { kind: 'attention', sticky: true });
      break;
    case 'unregister':
      await client.unregister(sessionId);
      break;
    default:
      break;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

function parseJson(s) {
  try { return JSON.parse(s) || {}; }
  catch { return {}; }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
