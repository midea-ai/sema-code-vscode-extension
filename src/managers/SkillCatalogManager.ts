/**
 * Skill 市场：扫描扩展自带的 resources/skills/ 内置资源清单，提供目录列表与安装 / 卸载（对齐 sema-core webui 的 ecosystem.ts，只做 skill）。
 *   - 本地目录形式 resources/skills/<id>/（含 SKILL.md，可选 card.json）：安装 = 整目录复制
 *   - 远程配置形式 resources/skills/<id>.json（card + source）：安装 = 从 GitHub 拉 zip 包取子目录
 *   - 安装目标：用户级 ~/.sema/skills/<id> 或项目级 <workspace>/.sema/skills/<id>；同名目录存在即视为已安装
 *   - card.defaultInstall 的技能在扩展激活时自动装到用户级，已处理 id 由调用方持久化（用户卸载后不再重装）
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import AdmZip from 'adm-zip';

export type CatalogScope = 'project' | 'user';

/** 市场卡片（发给 webview） */
export interface CatalogSkill {
    id: string;
    name: string;
    description: string;
    category?: string;
    /** SKILL.md frontmatter 的 name（core 按它加载 / 禁用），可能与安装目录名 id 不同 */
    skillName: string;
    /** 远程资源：来源仓库（owner/name）及可跳转的 GitHub 页面地址 */
    repo?: string;
    repoUrl?: string;
    installedUser: boolean;
    installedProject: boolean;
}

interface Card { name?: string; description?: string; category?: string; order?: number; defaultInstall?: boolean }
/** ref 不填时用 HEAD；第三方仓库建议钉死 commit，内容不可变 */
interface RemoteSource { repo: string; ref: string; path: string }
interface SkillRes { id: string; card: Card; skillName: string; dir?: string; source?: RemoteSource }

/** 远程资源包大小上限 */
const ZIP_MAX = 100 * 1024 * 1024;

/** 进行中的 zip 下载：同仓库同 ref 的并行安装共享一次下载（模块级，多个实例共用） */
const inflightZips = new Map<string, Promise<Buffer>>();

function readJson(file: string): any {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

function parseRemoteSource(v: any): RemoteSource | null {
    if (!/^[\w.-]+\/[\w.-]+$/.test(v?.repo || '')) return null;
    const ref = v?.ref == null || v.ref === '' ? 'HEAD' : v.ref;
    if (typeof ref !== 'string' || !/^[\w./-]+$/.test(ref)) return null;
    if (typeof v?.path !== 'string' || !v.path || v.path.includes('..')) return null;
    return { repo: v.repo, ref, path: v.path.replace(/^\/+|\/+$/g, '') };
}

/** SKILL.md frontmatter 兜底解析：card.json 缺失时取 name/description 当展示文案 */
function parseFrontmatter(file: string): Card {
    try {
        const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!m) return {};
        const lines = m[1].split(/\r?\n/);
        const pick = (key: string) => {
            const idx = lines.findIndex(l => l.startsWith(`${key}:`));
            if (idx === -1) return undefined;
            const inline = lines[idx].slice(key.length + 1).trim();
            // 块标量：|（保留换行）或 >（折叠为空格），兼容 |- >- |+ >+ 变体
            if (/^[|>][+-]?$/.test(inline)) {
                const block: string[] = [];
                for (let i = idx + 1; i < lines.length; i++) {
                    if (lines[i].trim() === '') { block.push(''); continue; }
                    if (!/^\s/.test(lines[i])) break;
                    block.push(lines[i].trim());
                }
                while (block.length && !block[block.length - 1]) block.pop();
                return block.join(inline[0] === '>' ? ' ' : '\n') || undefined;
            }
            return inline.replace(/^["']|["']$/g, '') || undefined;
        };
        return { name: pick('name'), description: pick('description') };
    } catch { return {}; }
}

/** 下载 GitHub 仓库 zip 包（codeload 无 API 限流），自动跟随重定向，60s 超时；按 repo@ref 去重进行中的请求 */
function downloadZip(source: RemoteSource): Promise<Buffer> {
    const key = `${source.repo}@${source.ref}`;
    const inflight = inflightZips.get(key);
    if (inflight) return inflight;
    const task = new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Download timed out, check your network and retry')), 60_000);
        const fail = (e: Error) => { clearTimeout(timer); reject(new Error(`Download failed (${source.repo}): ${e.message}`)); };
        const get = (url: string) => {
            const mod = url.startsWith('https') ? https : http;
            (mod as typeof https).get(url, { headers: { 'User-Agent': 'sema-vscode' } }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { get(res.headers.location); return; }
                if (res.statusCode !== 200) { res.resume(); fail(new Error(`HTTP ${res.statusCode}`)); return; }
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (c: Buffer) => {
                    size += c.length;
                    if (size > ZIP_MAX) { res.destroy(new Error('Skill package too large')); return; }
                    chunks.push(c);
                });
                res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
                res.on('error', fail);
            }).on('error', fail);
        };
        get(`https://codeload.github.com/${source.repo}/zip/${encodeURIComponent(source.ref)}`);
    });
    inflightZips.set(key, task);
    // 完成即移除（成功失败都清，失败后重试会重新下载）；两参 then 避免派生出未处理的 rejection
    const clean = () => { inflightZips.delete(key); };
    task.then(clean, clean);
    return task;
}

export class SkillCatalogManager {
    /** @param resourcesDir 扩展根目录下的 resources/（内含 skills/） */
    constructor(private readonly resourcesDir: string) {}

    private skillDir(scope: CatalogScope, id: string, workspaceRoot?: string): string {
        if (scope === 'project') {
            if (!workspaceRoot) throw new Error('No workspace folder is open');
            return path.join(workspaceRoot, '.sema', 'skills', id);
        }
        return path.join(os.homedir(), '.sema', 'skills', id);
    }

    /** 扫描内置资源。id 取子目录名 / 文件名（无路径分隔符），install/uninstall 按 id 在扫描结果中找回，天然白名单 */
    private scan(): SkillRes[] {
        const out: SkillRes[] = [];
        const skillsRoot = path.join(this.resourcesDir, 'skills');
        if (!fs.existsSync(skillsRoot)) return out;
        for (const e of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
            if (e.isDirectory()) {
                const dir = path.join(skillsRoot, e.name);
                if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
                const fm = parseFrontmatter(path.join(dir, 'SKILL.md'));
                const card: Card = readJson(path.join(dir, 'card.json')) || fm;
                out.push({ id: e.name, dir, card, skillName: fm.name || e.name });
            } else if (e.isFile() && e.name.endsWith('.json')) {
                const conf = readJson(path.join(skillsRoot, e.name));
                const source = parseRemoteSource(conf?.source);
                if (!source) continue;
                const skillName = (typeof conf.skillName === 'string' && conf.skillName.trim()) || source.path.split('/').pop() || '';
                out.push({ id: e.name.replace(/\.json$/, ''), card: conf.card || {}, source, skillName });
            }
        }
        // 组内展示顺序：card.order 小的在前（缺省排最后），同序按 id 字母序
        return out.sort((a, b) => ((a.card.order ?? Infinity) - (b.card.order ?? Infinity)) || a.id.localeCompare(b.id));
    }

    private find(id: string): SkillRes {
        const r = this.scan().find(x => x.id === id);
        if (!r) throw new Error(`Skill resource not found: ${id}`);
        return r;
    }

    listCatalog(workspaceRoot?: string): CatalogSkill[] {
        return this.scan().map(r => ({
            id: r.id,
            name: r.card.name || r.id,
            description: r.card.description || '',
            category: r.card.category,
            skillName: r.skillName,
            repo: r.source?.repo,
            repoUrl: r.source ? `https://github.com/${r.source.repo}/tree/${r.source.ref}/${r.source.path}` : undefined,
            installedUser: fs.existsSync(this.skillDir('user', r.id)),
            installedProject: !!workspaceRoot && fs.existsSync(this.skillDir('project', r.id, workspaceRoot)),
        }));
    }

    /** 拉取远程技能：先在临时目录解压校验，成功后才替换目标目录（失败不留半截） */
    private async fetchRemoteSkill(r: SkillRes, dest: string): Promise<void> {
        const source = r.source!;
        const zip = new AdmZip(await downloadZip(source));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sema-skill-'));
        try {
            // zip 顶层是 <repo>-<ref> 单目录，名字随 ref 形态变化，取首个条目的第一段即可
            const entries = zip.getEntries();
            const top = entries[0]?.entryName.split('/')[0];
            const prefix = top ? `${top}/${source.path}/` : '';
            // 只解压目标子目录，避免整仓落盘
            for (const entry of entries) {
                if (prefix && entry.entryName.startsWith(prefix) && !entry.isDirectory) {
                    zip.extractEntryTo(entry, tmp, true, true);
                }
            }
            const srcDir = prefix ? path.join(tmp, top!, source.path) : '';
            if (!srcDir || !fs.existsSync(path.join(srcDir, 'SKILL.md'))) throw new Error(`${source.path}/SKILL.md not found in package`);
            fs.rmSync(dest, { recursive: true, force: true });
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.cpSync(srcDir, dest, { recursive: true });
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }

    /** 安装；同名已存在且未确认覆盖时返回 needConfirm，由调用方二次确认后带 overwrite 重发 */
    async install(id: string, scope: CatalogScope, overwrite: boolean, workspaceRoot?: string): Promise<true | { needConfirm: true }> {
        const r = this.find(id);
        const dest = this.skillDir(scope, r.id, workspaceRoot);
        if (fs.existsSync(dest) && !overwrite) return { needConfirm: true };
        if (r.dir) {
            fs.rmSync(dest, { recursive: true, force: true });
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.cpSync(r.dir, dest, { recursive: true });
        } else {
            await this.fetchRemoteSkill(r, dest);
        }
        return true;
    }

    /** 卸载：删掉用户级与项目级（若有）的同名目录；返回 skillName 供调用方清理禁用残留 */
    uninstall(id: string, workspaceRoot?: string): string {
        const r = this.find(id);
        fs.rmSync(this.skillDir('user', r.id), { recursive: true, force: true });
        if (workspaceRoot) fs.rmSync(this.skillDir('project', r.id, workspaceRoot), { recursive: true, force: true });
        return r.skillName;
    }

    /**
     * 默认安装：card.defaultInstall 的技能里挑出未处理过的，装到用户级。
     * 用户级已有同名目录视为已处理（不覆盖）；下载失败的不计入，下次激活重试。
     * 返回本轮处理完的 id，由调用方持久化（用户之后卸载也不再重装）。
     */
    async installDefaultSkills(handled: string[]): Promise<string[]> {
        const pending = this.scan().filter(r => !!r.card.defaultInstall && !handled.includes(r.id));
        const done = await Promise.all(pending.map(async r => {
            try {
                if (!fs.existsSync(this.skillDir('user', r.id))) await this.install(r.id, 'user', false);
                return r.id;
            } catch (e) {
                console.error(`[skill-catalog] default skill ${r.id} install failed:`, (e as Error)?.message || e);
                return null;
            }
        }));
        return done.filter((x): x is string => !!x);
    }
}
