import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import AdmZip = require('adm-zip');

/**
 * ripgrep 供应器：使扩展摆脱打包各平台 rg 二进制，达成单包全平台通用 VSIX。
 *
 * 查找优先级（前 4 步同步完成，在 SemaCore 实例化前即可把 rg 目录前置进本进程 PATH）：
 *   1. SEMA_RG_PATH 显式覆盖（离线 / 内网）
 *   2. VS Code 本体内置的 rg（vscode.env.appRoot，覆盖 99.9% 场景、全架构离线可用）
 *   3. 系统 PATH 中已安装的 rg
 *   4. ~/.sema/rg/<version>/<triple>/ 私有缓存（与 JetBrains / SDK 共享目录）
 *   5. 后台按需从 GitHub Release（或 SEMA_RG_BASE_URL 镜像）下载到私有缓存
 */

const RG_VERSION = '14.1.0';
const DEFAULT_BASE = 'https://github.com/BurntSushi/ripgrep/releases/download';
const IS_WINDOWS = process.platform === 'win32';
const RG_NAME = IS_WINDOWS ? 'rg.exe' : 'rg';
const DOWNLOAD_TIMEOUT_MS = 180_000;

let inflightDownload: Promise<void> | null = null;

function assetFor(): { triple: string; zip: boolean } | null {
    const arch = process.arch;
    switch (process.platform) {
        case 'darwin':
            if (arch === 'arm64') return { triple: 'aarch64-apple-darwin', zip: false };
            if (arch === 'x64') return { triple: 'x86_64-apple-darwin', zip: false };
            return null;
        case 'win32':
            // win arm64 走 x64 仿真
            if (arch === 'x64' || arch === 'arm64') return { triple: 'x86_64-pc-windows-msvc', zip: true };
            return null;
        case 'linux':
            if (arch === 'arm64') return { triple: 'aarch64-unknown-linux-gnu', zip: false };
            if (arch === 'x64') return { triple: 'x86_64-unknown-linux-musl', zip: false };
            return null;
        default:
            return null;
    }
}

function canExecute(file: string): boolean {
    try {
        fs.accessSync(file, IS_WINDOWS ? fs.constants.F_OK : fs.constants.X_OK);
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

function prependPath(dir: string): void {
    const current = process.env.PATH ?? '';
    const parts = current.split(path.delimiter).filter(Boolean);
    if (parts[0] === dir) return;
    process.env.PATH = [dir, ...parts.filter(p => p !== dir)].join(path.delimiter);
}

function whichRg(): string | null {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, RG_NAME);
        if (canExecute(candidate)) return candidate;
    }
    return null;
}

/** 探测 VS Code 自身安装目录下内置的 ripgrep 二进制（兼容历史 asar、平铺及 1.18+ 平台子包布局）。 */
function findVscodeBundledRg(appRoot?: string): string | null {
    if (!appRoot) return null;
    const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
    const candidates = [
        path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', RG_NAME),
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', RG_NAME),
        path.join(appRoot, 'node_modules', platformPkg, 'bin', RG_NAME),
        path.join(appRoot, 'node_modules.asar.unpacked', platformPkg, 'bin', RG_NAME),
    ];
    for (const candidate of candidates) {
        if (canExecute(candidate)) return candidate;
    }
    return null;
}

function httpDownload(urlStr: string, dest: string, redirects = 6): Promise<void> {
    return new Promise((resolve, reject) => {
        const mod = urlStr.startsWith('http://') ? http : https;
        const req = mod.get(urlStr, { headers: { 'User-Agent': 'sema-vscode-extension' } }, (res) => {
            const code = res.statusCode ?? 0;
            if (code >= 300 && code < 400 && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error('Too many redirects'));
                return resolve(httpDownload(res.headers.location, dest, redirects - 1));
            }
            if (code !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${code}: ${urlStr}`));
            }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve()));
            out.on('error', reject);
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('Download timed out')));
    });
}

function extractArchive(archive: string, destDir: string, isZip: boolean): void {
    fs.mkdirSync(destDir, { recursive: true });
    if (isZip) {
        const zip = new AdmZip(archive);
        zip.extractAllTo(destDir, true);
        return;
    }
    const tar = spawnSync('tar', ['xf', archive, '-C', destDir], { timeout: DOWNLOAD_TIMEOUT_MS });
    if (tar.status !== 0) {
        throw new Error(`tar extract failed (${tar.status}): ${archive}`);
    }
}

function dequarantine(file: string): void {
    if (process.platform !== 'darwin') return;
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', file], { timeout: 10_000 });
}

function findFileRecursive(root: string, name: string): string | null {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const p = path.join(root, entry.name);
        if (entry.isFile() && entry.name === name) return p;
        if (entry.isDirectory()) {
            const found = findFileRecursive(p, name);
            if (found) return found;
        }
    }
    return null;
}

async function downloadRg(cacheDir: string, asset: { triple: string; zip: boolean }): Promise<string> {
    const base = (process.env.SEMA_RG_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '');
    const fileName = `ripgrep-${RG_VERSION}-${asset.triple}.${asset.zip ? 'zip' : 'tar.gz'}`;
    const url = `${base}/${RG_VERSION}/${fileName}`;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sema-rg-'));
    try {
        const archive = path.join(tmp, fileName);
        await httpDownload(url, archive);
        const extractDir = path.join(tmp, 'x');
        extractArchive(archive, extractDir, asset.zip);
        const rg = findFileRecursive(extractDir, RG_NAME);
        if (!rg) throw new Error(`Binary ${RG_NAME} not found in archive`);
        fs.mkdirSync(cacheDir, { recursive: true });
        const dest = path.join(cacheDir, RG_NAME);
        const incoming = `${dest}.${process.pid}.incoming`;
        try {
            // 在缓存目录内完成准备后原子替换，避免暴露未写完的二进制。
            fs.copyFileSync(rg, incoming);
            if (!IS_WINDOWS) {
                fs.chmodSync(incoming, 0o755);
                dequarantine(incoming);
            }
            fs.renameSync(incoming, dest);
        } catch (e) {
            try { fs.rmSync(incoming, { force: true }); } catch { /* ignore */ }
            throw e;
        }
        return cacheDir;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

/**
 * 确保本进程 PATH 中存在可用的 ripgrep（供 sema-core 的 search_content 工具直接命中）。
 * 前 4 步同步执行，无需 await 即可在 SemaCore 初始化前生效；仅当全部缺失时才异步下载。
 */
export function ensureRipgrep(appRoot?: string): Promise<void> {
    // 1) 显式指定（内网 / 离线）
    const override = process.env.SEMA_RG_PATH;
    if (override) {
        try {
            const dir = fs.existsSync(override) && fs.statSync(override).isDirectory()
                ? override
                : path.dirname(override);
            if (canExecute(path.join(dir, RG_NAME))) {
                prependPath(dir);
                return Promise.resolve();
            }
        } catch { /* fall through */ }
        console.warn(`[ripgrep] SEMA_RG_PATH specified but ${RG_NAME} not executable: ${override}`);
    }

    // 2) VS Code 本体内置 ripgrep
    const vscodeRg = findVscodeBundledRg(appRoot);
    if (vscodeRg) {
        prependPath(path.dirname(vscodeRg));
        return Promise.resolve();
    }

    // 3) 系统 PATH 已有 ripgrep
    if (whichRg()) {
        return Promise.resolve();
    }

    // 4) ~/.sema/rg 私有缓存命中
    const asset = assetFor();
    if (!asset) {
        console.warn(`[ripgrep] unsupported platform/arch: ${process.platform}/${process.arch}`);
        return Promise.resolve();
    }
    const cacheDir = path.join(os.homedir(), '.sema', 'rg', RG_VERSION, asset.triple);
    if (canExecute(path.join(cacheDir, RG_NAME))) {
        prependPath(cacheDir);
        return Promise.resolve();
    }

    // 5) 极端兜底：后台按需下载（单飞去重，失败告警不阻塞启动）
    if (!inflightDownload) {
        inflightDownload = downloadRg(cacheDir, asset)
            .then((dir) => {
                prependPath(dir);
            })
            .catch((e: unknown) => {
                console.warn(`[ripgrep] download failed: ${e instanceof Error ? e.message : String(e)}`);
            })
            .finally(() => {
                inflightDownload = null;
            });
    }
    return inflightDownload;
}
