#!/usr/bin/env node
//
// Claude Code 桌宠 hook 分派器。
// 用法：node hook.js <event>，事件数据从 stdin 读 JSON（Claude Code hook 约定）。
//
// 由 install.js 写进 ~/.claude/settings.json 的 hooks，把 Claude Code 事件映射成桌宠动作：
//   session-start   → ensurePetRunning + register + idle（耗时部分丢给 detached 子进程，不卡 Claude）
//   prompt-submit   → thinking
//   pre-tool        → working
//   post-tool       → thinking
//   stop            → idle
//   notification    → permission_prompt/idle_prompt 时 attention + 气泡
//   session-end     → unregister（最后一个会话注销后桌宠自动退出）
//
// 设计要点：全程吞异常、始终 exit(0)，绝不返回退出码 2 —— 桌宠挂了/没装不能影响 Claude，
// 也不能误 block 工具调用。

'use strict';

const { spawn } = require('child_process');
const client = require('./lib/client');
const { ensurePetRunning } = require('./lib/launcher');

const event = process.argv[2];

async function main() {
  // 内部事件：detached 子进程承担下载/解压/启动/注册这些耗时活，
  // session-start hook 本体 spawn 完它就立即退出，不阻塞 Claude。
  if (event === '__ensure') {
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

  switch (event) {
    case 'session-start': {
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
    case 'prompt-submit':
      await client.state(sessionId, 'thinking');
      break;
    case 'pre-tool':
      await client.state(sessionId, 'working');
      break;
    case 'post-tool':
      await client.state(sessionId, 'thinking');
      break;
    case 'stop':
      await client.state(sessionId, 'idle');
      break;
    case 'notification': {
      const type = data.notification_type;
      if (type === 'permission_prompt') {
        await client.state(sessionId, 'attention');
        await client.say(sessionId, '需要权限确认', { kind: 'attention', sticky: true });
      } else if (type === 'idle_prompt') {
        await client.state(sessionId, 'attention');
        await client.say(sessionId, '在等你输入哦', { kind: 'attention', sticky: true });
      }
      break;
    }
    case 'session-end':
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
