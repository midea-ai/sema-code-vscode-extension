// 桌宠启动器 —— 镜像 src/pet/pet-launcher.ts 的 ensurePetRunning，
// 但 zip 来源从「扩展内置 dist/pet」换成「GitHub pet-assets Release 下载」
// （Claude Code 没法像 VSCode 扩展那样内置 zip），并用系统 unzip/tar 解压避开 adm-zip 依赖。

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  PET_HOST, PET_PORT,
  PET_SERVER_HEADER, PET_SERVER_HEADER_VALUE,
  PET_DIR, BIN_DIR, BIN_PATH, ZIP_URL,
  SUPPORTED_PLATFORMS,
} = require('./protocol');

const SPAWN_READY_TIMEOUT_MS = 15000;  // 冷启动首启较慢（dyld/Gatekeeper 扫描、GTK/AppKit 初始化）
const RESOURCE_BUNDLE_PATH = path.join(BIN_DIR, 'SemaPet_SemaPet.bundle'); // 仅 macOS

/**
 * 确保桌宠在跑：
 *   1. ping /health 通过 → 已在跑
 *   2. 本地无二进制 → 从 GitHub pet-assets Release 下载 zip → 解压
 *   3. spawn 二进制 → ping 等待就绪（最多 ~15s）
 * 返回 true 表示桌宠已就绪。
 */
async function ensurePetRunning() {
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) return false;
  if (await ping()) return true;

  if (needsInstall()) {
    const ok = await installFromGitHub();
    if (!ok) return false;
  }

  return await spawnBinary();
}

function needsInstall() {
  if (!fs.existsSync(BIN_PATH)) return true;
  // macOS 资源 bundle 缺失也要重装
  if (process.platform === 'darwin' && !fs.existsSync(RESOURCE_BUNDLE_PATH)) return true;
  return false;
}

// ── 下载 ─────────────────────────────────────────────────────────────
// GitHub Release 资源会 302 跳到 CDN，跟随重定向（逻辑同 pet/fetch-zips.js）。
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

async function installFromGitHub() {
  try {
    // 清理旧版本残留，避免文件名变化造成污染（同 pet-launcher.ts）
    if (fs.existsSync(BIN_DIR)) {
      try { fs.rmSync(BIN_DIR, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(BIN_DIR, { recursive: true });

    const zipPath = path.join(BIN_DIR, 'sema-pet.zip');
    await download(ZIP_URL, zipPath);

    if (!extractZip(zipPath, BIN_DIR)) return false;
    try { fs.rmSync(zipPath, { force: true }); } catch {}

    try { fs.chmodSync(BIN_PATH, 0o755); } catch {}
    if (process.platform === 'darwin') {
      // 不签 / 带 quarantine 会被 Gatekeeper 直接 Killed:9
      try { spawnSync('xattr', ['-dr', 'com.apple.quarantine', BIN_PATH]); } catch {}
    }
    return fs.existsSync(BIN_PATH);
  } catch (e) {
    log('install failed:', e && e.message);
    return false;
  }
}

// 用系统工具解压，避开 adm-zip 依赖：
//   mac/linux 用 unzip（能还原 zip -y 存进去的符号链接，macOS .bundle 需要）
//   Windows 用 tar（bsdtar，Win10 1803+ 自带；win 端 zip 只含 SemaPet.exe）
function extractZip(zipPath, destDir) {
  const r = process.platform === 'win32'
    ? spawnSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'ignore' })
    : spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'ignore' });
  if (r.error || r.status !== 0) {
    log('extract failed:', r.error ? r.error.message : `exit ${r.status}`);
    return false;
  }
  return true;
}

// ── 启动 ─────────────────────────────────────────────────────────────
async function spawnBinary() {
  if (!fs.existsSync(BIN_PATH)) return false;
  fs.mkdirSync(PET_DIR, { recursive: true });

  try { fs.chmodSync(BIN_PATH, 0o755); } catch {}
  if (process.platform === 'darwin') {
    try { spawnSync('xattr', ['-dr', 'com.apple.quarantine', BIN_PATH]); } catch {}
  }

  // Linux 下强制 GDK_BACKEND=x11，否则 Wayland 禁止应用置顶、桌宠会被盖住（同 pet-launcher.ts）
  const extraEnv = process.platform === 'linux' ? { GDK_BACKEND: 'x11' } : {};
  const child = spawn(BIN_PATH, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...extraEnv, SEMA_PET_PORT: String(PET_PORT) },
  });
  child.unref();

  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get({
      host: PET_HOST, port: PET_PORT, path: '/health', timeout: 200,
    }, (res) => {
      const ok = res.headers[PET_SERVER_HEADER] === PET_SERVER_HEADER_VALUE
        && (res.statusCode ?? 0) < 400;
      res.resume();
      resolve(ok);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function log(...args) {
  // 桌宠相关日志只走 stderr，不污染 hook 的 stdout（stdout 可能被 Claude 当上下文）
  try { process.stderr.write('[sema-pet] ' + args.join(' ') + '\n'); } catch {}
}

module.exports = { ensurePetRunning, ping };
