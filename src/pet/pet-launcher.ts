import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, spawnSync } from 'child_process';
import AdmZip = require('adm-zip');
import {
  PET_HOST, PET_PORT,
  PET_SERVER_HEADER, PET_SERVER_HEADER_VALUE,
  PET_DIR_NAME, PET_RUNTIME_FILE,
  PetRuntimeInfo,
} from './pet-types';

const PET_DIR = path.join(os.homedir(), PET_DIR_NAME);
const RUNTIME_PATH = path.join(PET_DIR, PET_RUNTIME_FILE);

const PLATFORM_KEY = `${process.platform}-${process.arch}`;           // e.g. darwin-arm64
const BIN_DIR = path.join(PET_DIR, 'bin', PLATFORM_KEY);
const BIN_NAME = process.platform === 'win32' ? 'SemaPet.exe' : 'SemaPet';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const RESOURCE_BUNDLE_PATH = path.join(BIN_DIR, 'SemaPet_SemaPet.bundle');
const INSTALLED_META_PATH = path.join(BIN_DIR, '.installed-meta.json');

const DEFAULT_RELEASE_BASE =
  'https://github.com/midea-ai/sema-code-vscode-extension/releases/download/pet-assets';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SPAWN_READY_TIMEOUT_MS = 15_000;  // 冷启动首启较慢，放宽就绪等待上限

// 跨进程 spawn 锁：每个 VSCode 窗口是独立的 extension host，重启电脑 / VSCode 更新
// 重启时 N 个窗口同时激活、同时 ping 失败、各 spawn 一个桌宠 → 桌面上出现多个桌宠
// （Windows 二进制先建窗口再抢端口，抢不到就卡在报错弹窗里不退出；macOS 会退出但
// 已把 runtime.json 的 pid 覆盖成死进程，导致后续 killPet 杀不到真正的桌宠）。
// 锁文件与 pet/claude-code/lib/launcher.js 共用同一路径，Claude Code hook 与 VSCode
// 同时拉起时也只会 spawn 一次。
const SPAWN_LOCK_PATH = path.join(PET_DIR, 'spawn.lock');
const SPAWN_LOCK_STALE_MS = 90_000;     // 覆盖首次下载 + 解压 + 启动窗口
const WAIT_OTHER_SPAWN_MS = 90_000;     // 没抢到锁时等别的窗口把桌宠拉起来的上限
const WAIT_OTHER_SPAWN_INTERVAL_MS = 300;

/** 本地开发 zip（npm run pet:build 落 dist/pet/）的安装指纹，用于判断 zip 换过需要重装 */
interface InstalledMeta {
  zipSize?: number;
  zipMtimeMs?: number;
}

interface SpawnLockInfo {
  pid: number;
  ts: number;
}

export interface EnsurePetOptions {
  /** 即将从远端下载桌宠时触发，供宿主展示状态栏提示 */
  onDownloading?: () => void;
}

/** 当前平台对应的 pet-assets zip 文件名；不支持的平台/架构返回 null。 */
function petZipNameForPlatform(): string | null {
  switch (process.platform) {
    case 'darwin':
      if (process.arch === 'arm64' || process.arch === 'x64') {
        return `sema-pet-darwin-${process.arch}.zip`;
      }
      return null;
    case 'win32':
      // Windows ARM64 经 WoW64 仿真运行 x64 桌宠
      if (process.arch === 'x64' || process.arch === 'arm64') {
        return 'sema-pet-win32-x64.zip';
      }
      return null;
    case 'linux':
      if (process.arch === 'x64') {
        return 'sema-pet-linux-x64.zip';
      }
      return null;
    default:
      return null;
  }
}

function getReleaseBase(): string {
  return (process.env.SEMA_PET_BASE_URL ?? DEFAULT_RELEASE_BASE).replace(/\/+$/, '');
}

export function readRuntimeInfo(): PetRuntimeInfo | null {
  try { return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8')); }
  catch { return null; }
}

export function killPet(): void {
  const info = readRuntimeInfo();
  if (!info?.pid) return;
  // runtime.json 可能被抢端口失败的重复实例覆盖成死 pid，或被 pid 复用指向无关进程；
  // 只对确认是 SemaPet 的进程发信号，避免误杀。
  if (!isSemaPetProcess(info.pid)) return;
  try { process.kill(info.pid, 'SIGTERM'); } catch {}
}

function isSemaPetProcess(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      return (r.stdout || '').toLowerCase().includes(BIN_NAME.toLowerCase());
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    return path.basename((r.stdout || '').trim()) === BIN_NAME;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function readSpawnLock(): SpawnLockInfo | null {
  try { return JSON.parse(fs.readFileSync(SPAWN_LOCK_PATH, 'utf8')); }
  catch { return null; }
}

function isSpawnLockStale(): boolean {
  const info = readSpawnLock();
  if (!info || typeof info.pid !== 'number' || typeof info.ts !== 'number') return true;
  if (Date.now() - info.ts > SPAWN_LOCK_STALE_MS) return true;
  return !isProcessAlive(info.pid);
}

/** 原子创建锁文件（wx）。锁已存在且新鲜 → false；陈旧锁清掉后重试一次。 */
function tryAcquireSpawnLock(): boolean {
  const payload = JSON.stringify({ pid: process.pid, ts: Date.now() } satisfies SpawnLockInfo);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(PET_DIR, { recursive: true });
      fs.writeFileSync(SPAWN_LOCK_PATH, payload, { flag: 'wx' });
      return true;
    } catch (e) {
      // 非"已存在"类错误（权限、只读盘等）不阻塞启动，退回旧行为直接 spawn
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return true;
      if (!isSpawnLockStale()) return false;
      try { fs.unlinkSync(SPAWN_LOCK_PATH); } catch {}
    }
  }
  return false;
}

function releaseSpawnLock(): void {
  const info = readSpawnLock();
  if (info?.pid !== process.pid) return;
  try { fs.unlinkSync(SPAWN_LOCK_PATH); } catch {}
}

/** 别的进程正在拉起桌宠：不重复 spawn，只等它就绪。 */
async function waitForOtherSpawn(): Promise<boolean> {
  const deadline = Date.now() + WAIT_OTHER_SPAWN_MS;
  while (Date.now() < deadline) {
    if (await ping()) return true;
    await new Promise(r => setTimeout(r, WAIT_OTHER_SPAWN_INTERVAL_MS));
  }
  return false;
}

function isBinaryInstalled(): boolean {
  if (!fs.existsSync(BIN_PATH)) return false;
  if (process.platform === 'darwin' && !fs.existsSync(RESOURCE_BUNDLE_PATH)) return false;
  return true;
}

function readInstalledMeta(): InstalledMeta | null {
  try { return JSON.parse(fs.readFileSync(INSTALLED_META_PATH, 'utf8')); }
  catch { return null; }
}

function writeInstalledMeta(meta: InstalledMeta): void {
  try {
    fs.writeFileSync(INSTALLED_META_PATH, JSON.stringify(meta));
  } catch (e) {
    console.error('[pet] write installed meta failed:', e);
  }
}

/** 下载远端 zip 到目标路径（跟随 302 重定向，先落 .download 临时文件再原子重命名）。 */
function downloadRemote(urlStr: string, dest: string, redirects = 6): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('http://') ? http : https;
    const req = mod.get(urlStr, { headers: { 'User-Agent': 'sema-vscode-extension' } }, res => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        downloadRemote(res.headers.location, dest, redirects - 1).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} — ${urlStr}`));
        return;
      }
      const tmp = `${dest}.download`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        try {
          fs.renameSync(tmp, dest);
          resolve();
        } catch (e) {
          try { fs.rmSync(tmp, { force: true }); } catch {}
          reject(e);
        }
      }));
      out.on('error', err => {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        reject(err);
      });
      res.on('error', err => {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('Download timed out')));
  });
}

/**
 * 解压桌宠 zip 到 BIN_DIR（先清空旧目录再解压，并设可执行位 / macOS 去隔离）。
 * macOS/Linux 优先使用系统 unzip（能完整还原 zip -y 存的 .bundle 符号链接），失败或 Windows 回退 adm-zip。
 */
function extractZipToBinDir(zipPath: string): boolean {
  try {
    if (fs.existsSync(BIN_DIR)) {
      try { fs.rmSync(BIN_DIR, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(BIN_DIR, { recursive: true });

    let extracted = false;
    if (process.platform !== 'win32') {
      const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', BIN_DIR], { stdio: 'ignore' });
      if (!r.error && r.status === 0) extracted = true;
    }
    if (!extracted) {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(BIN_DIR, true);
    }

    try { fs.chmodSync(BIN_PATH, 0o755); } catch {}
    if (process.platform === 'darwin') {
      try { spawnSync('xattr', ['-dr', 'com.apple.quarantine', BIN_PATH]); } catch {}
    }
    return isBinaryInstalled();
  } catch (e) {
    console.error('[pet] extract failed:', e);
    return false;
  }
}

function needsLocalZipInstall(localZip: string): boolean {
  if (!isBinaryInstalled()) return true;
  let stat: fs.Stats;
  try { stat = fs.statSync(localZip); } catch { return false; }
  const meta = readInstalledMeta();
  if (!meta) return true;
  return meta.zipSize !== stat.size || meta.zipMtimeMs !== stat.mtimeMs;
}

function installFromLocalZip(localZip: string): boolean {
  if (!extractZipToBinDir(localZip)) return false;
  try {
    const stat = fs.statSync(localZip);
    writeInstalledMeta({ zipSize: stat.size, zipMtimeMs: stat.mtimeMs });
  } catch (e) {
    console.error('[pet] stat local zip failed:', e);
  }
  return true;
}

async function installFromRemote(zipName: string, opts?: EnsurePetOptions): Promise<boolean> {
  const url = `${getReleaseBase()}/${zipName}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sema-pet-'));
  const zipPath = path.join(tmpDir, zipName);
  try {
    opts?.onDownloading?.();
    await downloadRemote(url, zipPath);
    return extractZipToBinDir(zipPath);
  } catch (e) {
    console.error('[pet] remote install failed:', e);
    return false;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * 确保桌宠在跑：
 *   1. ping 健康检查通过 → 已在跑
 *   2. 抢跨进程 spawn 锁；没抢到则等别的窗口拉起
 *   3. 本地开发模式（dist/pet/ 有 zip）→ 按指纹从本地 zip 解压
 *      生产模式 → 未安装则从 GitHub pet-assets Release 按需下载一次；装过就直接用本地，不再探测远端新版
 *   4. spawn 二进制 → ping 等待就绪
 */
export async function ensurePetRunning(extensionPath: string, opts?: EnsurePetOptions): Promise<boolean> {
  const zipName = petZipNameForPlatform();
  if (!zipName) return false;
  if (await ping()) return true;

  if (!tryAcquireSpawnLock()) return await waitForOtherSpawn();
  try {
    // 拿到锁后再探一次：锁在别人手里那段时间桌宠可能已经起来了
    if (await ping()) return true;

    const localDevZip = path.join(extensionPath, 'dist', 'pet', zipName);
    if (fs.existsSync(localDevZip)) {
      if (needsLocalZipInstall(localDevZip)) {
        if (!installFromLocalZip(localDevZip)) return false;
      }
    } else if (!isBinaryInstalled()) {
      // 只在没装过时下载一次；装过就一直用本地，不探测远端新版（要换新版删掉 ~/.sema/pet/bin 后重新启用）
      const ok = await installFromRemote(zipName, opts);
      if (!ok) return false;
    }

    return await spawnBinary();
  } finally {
    releaseSpawnLock();
  }
}

async function spawnBinary(): Promise<boolean> {
  if (!fs.existsSync(BIN_PATH)) return false;
  fs.mkdirSync(PET_DIR, { recursive: true });

  try { fs.chmodSync(BIN_PATH, 0o755); } catch {}
  if (process.platform === 'darwin') {
    try { spawnSync('xattr', ['-dr', 'com.apple.quarantine', BIN_PATH]); } catch {}
  }

  // Linux 下强制 GDK_BACKEND=x11：Wayland 协议禁止应用强制置顶，桌宠会被
  // VS Code 等任意窗口盖住；走 XWayland 后才能让 _NET_WM_STATE_ABOVE / Dock
  // 类型 hint 生效。在 spawn env 上注入比依赖二进制内 set_var 更可靠，
  // 老版本二进制也能受益。无 XWayland 的纯 Wayland 环境下进程会启动失败 —
  // 这是 Wayland 协议层的限制，没有客户端能绕开。
  const extraEnv: NodeJS.ProcessEnv =
    process.platform === 'linux' ? { GDK_BACKEND: 'x11' } : {};
  const child = spawn(BIN_PATH, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...extraEnv, SEMA_PET_PORT: String(PET_PORT) },
  });
  child.unref();

  // 冷启动（首次安装后第一次跑）较慢：dyld/Gatekeeper 扫描、GTK/AppKit 与窗口
  // 初始化都要时间。放宽到 ~15s，等桌宠真正起来后再注册。
  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ping()) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

function ping(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get({
      host: PET_HOST, port: PET_PORT, path: '/health', timeout: 200,
    }, res => {
      const ok = res.headers[PET_SERVER_HEADER] === PET_SERVER_HEADER_VALUE
        && (res.statusCode ?? 0) < 400;
      res.resume();
      resolve(ok);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
