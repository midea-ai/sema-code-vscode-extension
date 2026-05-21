import * as http from 'http';
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
const ZIP_NAME = `sema-pet-${PLATFORM_KEY}.zip`;
const BIN_DIR = path.join(PET_DIR, 'bin', PLATFORM_KEY);
const BIN_NAME = process.platform === 'win32' ? 'SemaPet.exe' : 'SemaPet';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const RESOURCE_BUNDLE_PATH = path.join(BIN_DIR, 'SemaPet_SemaPet.bundle');
const INSTALLED_META_PATH = path.join(BIN_DIR, '.installed-meta.json');
const SPAWN_READY_TIMEOUT_MS = 15000;  // 冷启动首启较慢，放宽就绪等待上限

interface InstalledMeta {
  zipSize: number;
  zipMtimeMs: number;
}

export function readRuntimeInfo(): PetRuntimeInfo | null {
  try { return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8')); }
  catch { return null; }
}

export function killPet(): void {
  const info = readRuntimeInfo();
  if (!info?.pid) return;
  try { process.kill(info.pid, 'SIGTERM'); } catch {}
}

/**
 * 确保桌宠在跑：
 *   1. ping 健康检查通过 → 已在跑
 *   2. 本地无二进制 或 bundled zip 指纹与已安装不一致（升级）→ 从扩展内置 zip 解压
 *   3. spawn 二进制 → ping 等待就绪
 *
 * 桌宠当前支持 macOS / Windows / Linux，其他平台直接返回 false（UI 端已禁用开关）。
 */
export async function ensurePetRunning(extensionPath: string): Promise<boolean> {
  if (
    process.platform !== 'darwin' &&
    process.platform !== 'win32' &&
    process.platform !== 'linux'
  ) {
    return false;
  }
  if (await ping()) return true;

  const bundledZip = path.join(extensionPath, 'dist', 'pet', ZIP_NAME);
  if (needsInstall(bundledZip)) {
    const ok = extractFromExtension(bundledZip);
    if (!ok) return false;
  }

  return await spawnBinary();
}

function readInstalledMeta(): InstalledMeta | null {
  try { return JSON.parse(fs.readFileSync(INSTALLED_META_PATH, 'utf8')); }
  catch { return null; }
}

function needsInstall(bundledZip: string): boolean {
  if (!fs.existsSync(BIN_PATH)) return true;
  if (process.platform === 'darwin' && !fs.existsSync(RESOURCE_BUNDLE_PATH)) return true;
  let stat: fs.Stats;
  try { stat = fs.statSync(bundledZip); } catch { return false; }
  const meta = readInstalledMeta();
  // 老用户：二进制存在但无指纹，视为旧版本，强制重装一次
  if (!meta) return true;
  return meta.zipSize !== stat.size || meta.zipMtimeMs !== stat.mtimeMs;
}

function extractFromExtension(bundledZip: string): boolean {
  if (!fs.existsSync(bundledZip)) {
    console.error('[pet] bundled zip not found:', bundledZip);
    return false;
  }
  try {
    // 清理旧版本残留，避免新版本文件名变化造成的污染
    if (fs.existsSync(BIN_DIR)) {
      try { fs.rmSync(BIN_DIR, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const zip = new AdmZip(bundledZip);
    zip.extractAllTo(BIN_DIR, true);
    try { fs.chmodSync(BIN_PATH, 0o755); } catch {}
    if (process.platform === 'darwin') {
      try { spawnSync('xattr', ['-dr', 'com.apple.quarantine', BIN_PATH]); } catch {}
    }
    if (!fs.existsSync(BIN_PATH)) return false;
    try {
      const stat = fs.statSync(bundledZip);
      const meta: InstalledMeta = { zipSize: stat.size, zipMtimeMs: stat.mtimeMs };
      fs.writeFileSync(INSTALLED_META_PATH, JSON.stringify(meta));
    } catch (e) {
      console.error('[pet] write installed meta failed:', e);
    }
    return true;
  } catch (e) {
    console.error('[pet] extract failed:', e);
    return false;
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
  // 初始化都要时间。老的 ~1.5s 上限会让首启没来得及就绪就放弃、进而漏掉注册
  // （桌宠进程是 detached 的，仍会在后台起来并显示，但项目没注册进去 → 活跃会话为空）。
  // 放宽到 ~15s，等桌宠真正起来后再注册。
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
