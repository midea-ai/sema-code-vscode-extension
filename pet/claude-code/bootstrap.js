#!/usr/bin/env node
//
// 桌宠 × Claude Code 的「一行安装」引导脚本。
// 用户无需 clone 本仓库，终端一行即可装好：
//
//   curl -fsSL https://raw.githubusercontent.com/midea-ai/sema-code-vscode-extension/main/pet/claude-code/bootstrap.js | node
//
// 做两件事：
//   1. 从 GitHub raw 把 hook 运行时脚本（install.js + hook.js + lib/）拉到稳定路径
//      ~/.sema/pet/claude-code/；
//   2. 跑下载下来的 install.js，把 hooks 合并进 ~/.claude/settings.json
//      （install.js 在稳定路径里跑，copyScripts 会因 src===dest 自动跳过自拷）。
//
// 桌宠二进制本体仍由首次会话时 lib/launcher.js 从 GitHub Release 按需下载，这里不碰。
//
// 下载源可用环境变量 SEMA_PET_RAW_BASE 覆盖（指向镜像加速，国内访问 raw 较慢时有用）。

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const RAW_BASE = (
  process.env.SEMA_PET_RAW_BASE
  || 'https://raw.githubusercontent.com/midea-ai/sema-code-vscode-extension/main/pet/claude-code'
).replace(/\/+$/, '');

const STABLE_DIR = path.join(os.homedir(), '.sema', 'pet', 'claude-code');

// 需要落地到稳定路径的运行时脚本（相对 pet/claude-code/）。install.js 放第一个，下面直接跑它。
const FILES = [
  'install.js',
  'hook.js',
  'lib/protocol.js',
  'lib/client.js',
  'lib/launcher.js',
];

// 跟随 302（raw 一般直接 200，但镜像/CDN 可能跳转），逻辑同 lib/launcher.js 的 download。
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        return;
      }
      const tmp = `${dest}.download`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        try { fs.renameSync(tmp, dest); resolve(); }
        catch (e) { reject(e); }
      }));
      file.on('error', (err) => { fs.rmSync(tmp, { force: true }); reject(err); });
    }).on('error', reject);
  });
}

async function main() {
  console.log('⬇️  正在下载桌宠 hook 脚本到', STABLE_DIR);
  for (const rel of FILES) {
    const dest = path.join(STABLE_DIR, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(`${RAW_BASE}/${rel}`, dest);
  }

  // 跑下载好的 install.js 注册 hooks（它在稳定路径里跑，copyScripts 会因 src===dest 跳过）。
  const r = spawnSync(process.execPath, [path.join(STABLE_DIR, 'install.js')], { stdio: 'inherit' });
  process.exit(r.status || 0);
}

main().catch((e) => {
  console.error('❌ 安装失败：', e && e.message);
  console.error('   网络问题可设 SEMA_PET_RAW_BASE 指向镜像后重试。');
  process.exit(1);
});
