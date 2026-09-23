/**
 * 超长粘贴转存的附件文件：<semaRoot>/attachments/<uuid>/pasted-text.txt（与 webui 同一目录约定）。
 * 写入 / 删除 / 读取 / 退场；与会话无关，不走 core。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

const FILE_NAME = 'pasted-text.txt';
/** 退场阈值：attachments/ 下子目录超过此数按 mtime 删最旧的 */
const MAX_DIRS = 100;
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** 与 core getSemaRootDir 一致：SEMA_ROOT 环境变量优先，默认 ~/.sema */
function attachmentsRoot(): string {
    const semaRoot = process.env.SEMA_ROOT ? path.resolve(process.env.SEMA_ROOT) : path.join(os.homedir(), '.sema');
    return path.join(semaRoot, 'attachments');
}

/** 落盘一段粘贴文本，返回绝对路径；顺带执行退场 */
export function savePastedText(text: string): { path: string } {
    if (!text) throw new Error('empty text');
    const root = attachmentsRoot();
    const dir = path.join(root, randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, FILE_NAME);
    fs.writeFileSync(file, text, 'utf8');
    evict(root);
    return { path: file };
}

/** 只接受本模块写出的形状 <root>/<uuid>/pasted-text.txt，返回 uuid 目录；其余返回 null */
function ownedDir(p: string): string | null {
    const root = attachmentsRoot();
    const rel = path.relative(root, path.resolve(p));
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || !UUID_RE.test(parts[0]) || parts[1] !== FILE_NAME) return null;
    return path.join(root, parts[0]);
}

/** 删除整个 uuid 目录；路径不合法直接忽略 */
export function removePastedText(p: string): void {
    const dir = ownedDir(p);
    if (!dir) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

/** 读回正文（fork 回填）；不是本模块的文件或已被退场清理返回 null */
export function readPastedText(p: string): string | null {
    if (!ownedDir(p)) return null;
    try {
        return fs.readFileSync(path.resolve(p), 'utf8');
    } catch {
        return null;
    }
}

function evict(root: string): void {
    try {
        const dirs = fs.readdirSync(root, { withFileTypes: true })
            .filter(d => d.isDirectory() && UUID_RE.test(d.name))
            .map(d => { try { return { name: d.name, mtime: fs.statSync(path.join(root, d.name)).mtimeMs }; } catch { return null; } })
            .filter((x): x is { name: string; mtime: number } => !!x)
            .sort((a, b) => b.mtime - a.mtime);
        for (const d of dirs.slice(MAX_DIRS)) fs.rmSync(path.join(root, d.name), { recursive: true, force: true });
    } catch { /* 退场失败不影响本次写入 */ }
}
