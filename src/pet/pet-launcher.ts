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
 * 桌宠当前仅支持 macOS，其他平台直接返回 false（UI 端已禁用开关）。
 */
export async function ensurePetRunning(extensionPath: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
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
  if (!fs.existsSync(BIN_PATH) || !fs.existsSync(RESOURCE_BUNDLE_PATH)) return true;
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

  const child = spawn(BIN_PATH, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SEMA_PET_PORT: String(PET_PORT) },
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 50));
    if (await ping()) return true;
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
