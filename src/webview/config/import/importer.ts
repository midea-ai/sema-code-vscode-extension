/**
 * 导入编排：探测来源 / 预览可导项 / 执行导入。只依赖 ImportFs 与 ImportCore，VSCode 与 JB 两端共用。
 *
 * 来源布局（方案第 3 节）：
 * - Claude Code：~/.claude.json 与 .mcp.json 的 mcpServers；.claude/{skills,agents,commands}；settings*.json 的 hooks；CLAUDE.md
 * - Codex：config.toml 的 [mcp_servers.*]；.codex/skills、.agents/skills；~/.codex/AGENTS.md
 * - Cursor：.cursor/mcp.json；.cursor/{skills,agents,commands}
 * 冲突规则固定：目标已有同名文件、目录或 MCP 服务器一律跳过；Hook 按事件 + 命令去重。
 */
import { parseToml } from './toml';
import { HOOK_EVENTS } from '../types/hook';
import type { MCPServerConfig, MCPTransportType } from '../types/mcp';
import type {
    CategoryPreview, ImportCategory, ImportCore, ImportFs, ImportItem, ImportPreview, ImportResult, ImportRoots, ImportScope, ImportSource, SourceStatus,
} from './types';
import { IMPORT_CATEGORIES, IMPORT_SOURCES } from './types';

const SUPPORTED_HOOK_EVENTS = new Set<string>(HOOK_EVENTS);

// ─── 路径 ─────────────────────────────────────────────────────────────────────

function join(sep: string, ...parts: string[]): string {
    const cleaned = parts.filter(Boolean);
    let out = cleaned[0].replace(/[\\/]+$/, '');
    for (const p of cleaned.slice(1)) out += sep + p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    return out;
}

type Join = (...parts: string[]) => string;
const joiner = (roots: ImportRoots): Join => (...p) => join(roots.sep, ...p);

/** 供 UI 展示：home 缩成 ~，项目根缩成 . */
function display(roots: ImportRoots, p: string): string {
    if (roots.home && p.startsWith(roots.home)) return '~' + p.slice(roots.home.length);
    if (roots.project && p.startsWith(roots.project)) return '.' + p.slice(roots.project.length);
    return p;
}

/**
 * 在 ~/.claude.json 的 projects 里找当前项目的条目。键是 Claude Code 的 process.cwd() 原样（Windows 形如 C:\Users\x\repo），
 * 而宿主给的项目根在 Windows 上对不上：VSCode 的 fsPath 盘符小写、JB 的 basePath 是正斜杠，所以 Windows 下按分隔符统一 + 忽略大小写比较。
 */
function findClaudeProject(projects: unknown, roots: ImportRoots): any {
    if (!projects || typeof projects !== 'object' || !roots.project) return undefined;
    const map = projects as Record<string, any>;
    if (map[roots.project] !== undefined) return map[roots.project];
    if (roots.sep !== '\\') return undefined;
    const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const want = norm(roots.project);
    const key = Object.keys(map).find(k => norm(k) === want);
    return key === undefined ? undefined : map[key];
}

/** Sema 落盘根：用户级 ~/.sema，项目级 <项目>/.sema */
function semaRoot(roots: ImportRoots, scope: ImportScope): string {
    return join(roots.sep, scope === 'user' ? roots.home : roots.project!, '.sema');
}

/** 来源根目录，任一存在即视为「已检测到」 */
function sourceRoots(source: ImportSource, roots: ImportRoots): string[] {
    const j = joiner(roots);
    const P = roots.project;
    switch (source) {
        case 'claude': return [j(roots.home, '.claude'), j(roots.home, '.claude.json'), ...(P ? [j(P, '.claude'), j(P, '.mcp.json'), j(P, 'CLAUDE.md')] : [])];
        case 'codex': return [j(roots.home, '.codex'), ...(P ? [j(P, '.codex'), j(P, '.agents')] : [])];
        case 'cursor': return [j(roots.home, '.cursor'), ...(P ? [j(P, '.cursor')] : [])];
    }
}

// ─── 读文件 ───────────────────────────────────────────────────────────────────

async function exists(fs: ImportFs, p: string): Promise<boolean> {
    try { return await fs.exists(p); } catch { return false; }
}

/** 文件不存在或不可读时返回 undefined（readFile 约定抛错，不再额外 exists 一次） */
async function readText(fs: ImportFs, p: string): Promise<string | undefined> {
    try { return await fs.readFile(p); } catch { return undefined; }
}

/** 文件不存在或不是合法 JSON 时返回 undefined */
async function readJson(fs: ImportFs, p: string): Promise<any> {
    const text = await readText(fs, p);
    if (text === undefined) return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
}

async function listMd(fs: ImportFs, j: Join, dir: string, recursive: boolean, prefix: string[] = []): Promise<{ file: string; rel: string[] }[]> {
    const entries = (await fs.readDir(dir)).filter(e => !e.name.startsWith('.'));
    const nested = await Promise.all(entries.map(async e => {
        const full = j(dir, e.name);
        if (e.isDir) return recursive ? listMd(fs, j, full, true, [...prefix, e.name]) : [];
        return /\.md$/i.test(e.name) ? [{ file: full, rel: [...prefix, e.name] }] : [];
    }));
    return nested.flat();
}

// ─── 扫描 ─────────────────────────────────────────────────────────────────────

interface Ctx { fs: ImportFs; roots: ImportRoots; j: Join; cats: Record<ImportCategory, CategoryPreview> }

function copyItem(category: ImportCategory, scope: ImportScope, name: string, src: string, dst: string, dir: boolean): ImportItem {
    return { id: `${category}:${scope}:${name}`, category, scope, name, sourcePath: src, exists: false, payload: { kind: 'copy', src, dst, dir } };
}

/** Skill：来源目录下每个含 SKILL.md 的子目录整目录复制 */
async function scanSkills(ctx: Ctx, dir: string, scope: ImportScope) {
    const { fs, roots, j } = ctx;
    const dirs = (await fs.readDir(dir)).filter(e => e.isDir && !e.name.startsWith('.'));
    const flags = await Promise.all(dirs.map(e => exists(fs, j(dir, e.name, 'SKILL.md'))));
    const skills = dirs.filter((_, i) => flags[i]);
    if (skills.length === 0) return;
    ctx.cats.skill.sourcePaths.push(dir);
    for (const e of skills) {
        ctx.cats.skill.items.push(copyItem('skill', scope, e.name, j(dir, e.name), j(semaRoot(roots, scope), 'skills', e.name), true));
    }
}

/** Agent / Command：md 文件原样复制，命令保留子目录（frontend/test.md → frontend:test 由 core 按路径生成） */
async function scanMd(ctx: Ctx, category: 'agent' | 'command', dir: string, scope: ImportScope) {
    const { fs, roots, j } = ctx;
    const files = await listMd(fs, j, dir, category === 'command');
    if (files.length === 0) return;
    ctx.cats[category].sourcePaths.push(dir);
    const dstDir = j(semaRoot(roots, scope), category === 'agent' ? 'agents' : 'commands');
    for (const { file, rel } of files) {
        const name = rel.join(':').replace(/\.md$/i, '');
        ctx.cats[category].items.push(copyItem(category, scope, name, file, j(dstDir, ...rel), false));
    }
}

/** 规则：CLAUDE.md / Codex AGENTS.md 原样复制为 Sema 的 AGENTS.md，目标已有则不导入 */
function scanRule(ctx: Ctx, src: string, scope: ImportScope) {
    const { roots, j } = ctx;
    const dst = scope === 'user' ? j(semaRoot(roots, 'user'), 'AGENTS.md') : j(roots.project!, 'AGENTS.md');
    ctx.cats.rule.items.push(copyItem('rule', scope, 'AGENTS.md', src, dst, false));
    ctx.cats.rule.sourcePaths.push(src);
}

/** MCP：字段与 Sema 同构，缺 type 时按 command / url 推断 transport；有条目时把来源文件记入 sourcePaths */
function scanMcpServers(ctx: Ctx, servers: unknown, scope: ImportScope, file: string) {
    if (!servers || typeof servers !== 'object') return;
    let found = false;
    for (const [name, raw] of Object.entries(servers as Record<string, any>)) {
        if (!raw || typeof raw !== 'object' || !name.trim()) continue;
        const type = String(raw.type ?? '').toLowerCase();
        const transport: MCPTransportType = type === 'sse' ? 'sse' : (type === 'http' || (!raw.command && raw.url)) ? 'http' : 'stdio';
        const config: Omit<MCPServerConfig, 'scope'> = { name: name.trim(), transport, env: raw.env };
        if (transport === 'stdio') { config.command = raw.command; config.args = raw.args; }
        else { config.url = raw.url; config.headers = raw.headers; }
        if (raw.enabled === false || raw.disabled === true) config.enabled = false;
        for (const [k, v] of Object.entries(config)) if (v === undefined) delete (config as Record<string, unknown>)[k];
        const detail = transport === 'stdio' ? [config.command, ...(config.args ?? [])].filter(Boolean).join(' ') : (config.url ?? '');
        found = true;
        ctx.cats.mcp.items.push({ id: `mcp:${scope}:${config.name}`, category: 'mcp', scope, name: config.name, detail, sourcePath: file, exists: false, payload: { kind: 'mcp', config } });
    }
    if (found) ctx.cats.mcp.sourcePaths.push(file);
}

async function scanMcpJson(ctx: Ctx, file: string, scope: ImportScope) {
    scanMcpServers(ctx, (await readJson(ctx.fs, file))?.mcpServers, scope, file);
}

/** Codex TOML：command/args/env/url/http_headers 对应转换，bearer_token_env_var 转 Authorization 头 */
async function scanMcpToml(ctx: Ctx, file: string, scope: ImportScope) {
    const text = await readText(ctx.fs, file);
    if (text === undefined) return;
    let parsed: Record<string, any>;
    try { parsed = parseToml(text); } catch { return; }
    const servers: Record<string, any> = {};
    for (const [name, raw] of Object.entries(parsed?.mcp_servers ?? {}) as [string, any][]) {
        if (!raw || typeof raw !== 'object') continue;
        const headers = { ...(raw.http_headers ?? {}) };
        if (typeof raw.bearer_token_env_var === 'string' && raw.bearer_token_env_var) headers.Authorization = `Bearer \${${raw.bearer_token_env_var}}`;
        servers[name] = { command: raw.command, args: raw.args, env: raw.env, url: raw.url, headers: Object.keys(headers).length ? headers : undefined, enabled: raw.enabled };
    }
    scanMcpServers(ctx, servers, scope, file);
}

/** Hook：Claude settings.json 的 hooks 字段与 Sema 同构，只取支持的事件与 type=command 的条目 */
async function scanHooks(ctx: Ctx, file: string, scope: ImportScope) {
    const data = await readJson(ctx.fs, file);
    const hooks = data?.hooks;
    if (!hooks || typeof hooks !== 'object') return;
    const dstFile = ctx.j(semaRoot(ctx.roots, scope), 'hooks', 'hooks.json');
    let found = false;
    for (const [event, groups] of Object.entries(hooks as Record<string, any>)) {
        if (!SUPPORTED_HOOK_EVENTS.has(event) || !Array.isArray(groups)) continue;
        for (const g of groups) {
            const matcher = typeof g?.matcher === 'string' && g.matcher.trim() ? g.matcher.trim() : undefined;
            for (const cmd of (Array.isArray(g?.hooks) ? g.hooks : [])) {
                if ((cmd?.type !== undefined && cmd.type !== 'command') || typeof cmd?.command !== 'string' || !cmd.command.trim()) continue;
                const command = cmd.command.trim();
                const id = `hook:${scope}:${event}:${command}`;
                if (ctx.cats.hook.items.some(i => i.id === id)) continue;
                found = true;
                ctx.cats.hook.items.push({
                    id, category: 'hook', scope, name: event, detail: matcher ? `${matcher} · ${command}` : command, sourcePath: file, exists: false,
                    payload: { kind: 'hook', event, matcher, command, timeout: typeof cmd.timeout === 'number' ? cmd.timeout : undefined, dstFile },
                });
            }
        }
    }
    if (found) ctx.cats.hook.sourcePaths.push(file);
}

async function scanSource(fs: ImportFs, roots: ImportRoots, source: ImportSource): Promise<CategoryPreview[]> {
    const cats = {} as Record<ImportCategory, CategoryPreview>;
    for (const c of IMPORT_CATEGORIES) cats[c] = { category: c, sourcePaths: [], items: [] };
    const j = joiner(roots);
    const ctx: Ctx = { fs, roots, j, cats };
    const H = roots.home;
    const P = roots.project;
    if (source === 'claude') {
        // ~/.claude.json 同时承载用户级 mcpServers 与 projects[<项目>].mcpServers，只读一次
        const claudeJsonFile = j(H, '.claude.json');
        const claudeJson = await readJson(fs, claudeJsonFile);
        scanMcpServers(ctx, claudeJson?.mcpServers, 'user', claudeJsonFile);
        await scanSkills(ctx, j(H, '.claude', 'skills'), 'user');
        await scanMd(ctx, 'agent', j(H, '.claude', 'agents'), 'user');
        await scanMd(ctx, 'command', j(H, '.claude', 'commands'), 'user');
        await scanHooks(ctx, j(H, '.claude', 'settings.json'), 'user');
        if (await exists(fs, j(H, '.claude', 'CLAUDE.md'))) scanRule(ctx, j(H, '.claude', 'CLAUDE.md'), 'user');
        if (P) {
            await scanMcpJson(ctx, j(P, '.mcp.json'), 'project');
            scanMcpServers(ctx, findClaudeProject(claudeJson?.projects, roots)?.mcpServers, 'project', claudeJsonFile);
            await scanSkills(ctx, j(P, '.claude', 'skills'), 'project');
            await scanMd(ctx, 'agent', j(P, '.claude', 'agents'), 'project');
            await scanMd(ctx, 'command', j(P, '.claude', 'commands'), 'project');
            await scanHooks(ctx, j(P, '.claude', 'settings.json'), 'project');
            await scanHooks(ctx, j(P, '.claude', 'settings.local.json'), 'project');
            for (const f of [j(P, 'CLAUDE.md'), j(P, '.claude', 'CLAUDE.md')]) {
                if (await exists(fs, f)) { scanRule(ctx, f, 'project'); break; }
            }
        }
    } else if (source === 'codex') {
        await scanMcpToml(ctx, j(H, '.codex', 'config.toml'), 'user');
        await scanSkills(ctx, j(H, '.codex', 'skills'), 'user');
        await scanSkills(ctx, j(H, '.agents', 'skills'), 'user');
        if (await exists(fs, j(H, '.codex', 'AGENTS.md'))) scanRule(ctx, j(H, '.codex', 'AGENTS.md'), 'user');
        if (P) {
            await scanMcpToml(ctx, j(P, '.codex', 'config.toml'), 'project');
            await scanSkills(ctx, j(P, '.agents', 'skills'), 'project');
        }
    } else {
        await scanMcpJson(ctx, j(H, '.cursor', 'mcp.json'), 'user');
        await scanSkills(ctx, j(H, '.cursor', 'skills'), 'user');
        await scanMd(ctx, 'agent', j(H, '.cursor', 'agents'), 'user');
        await scanMd(ctx, 'command', j(H, '.cursor', 'commands'), 'user');
        if (P) {
            await scanMcpJson(ctx, j(P, '.cursor', 'mcp.json'), 'project');
            await scanSkills(ctx, j(P, '.cursor', 'skills'), 'project');
            await scanMd(ctx, 'agent', j(P, '.cursor', 'agents'), 'project');
            await scanMd(ctx, 'command', j(P, '.cursor', 'commands'), 'project');
        }
    }
    // 同 id（如两个 skills 目录下同名）只留第一个
    for (const cat of Object.values(cats)) {
        const seen = new Set<string>();
        cat.items = cat.items.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)));
    }
    return IMPORT_CATEGORIES.map(c => cats[c]);
}

// ─── 目标 hooks.json ─────────────────────────────────────────────────────────

function hookKey(event: string, command: string): string { return `${event}\n${command.trim()}`; }

/** 读目标 hooks.json；文件损坏时 ok=false，执行阶段该文件下的条目整体记失败 */
async function readTargetHooks(fs: ImportFs, file: string): Promise<{ ok: boolean; data: any; keys: Set<string> }> {
    const keys = new Set<string>();
    const text = await readText(fs, file);
    let data: any = { hooks: {} };
    if (text?.trim()) {
        try { data = JSON.parse(text); } catch { return { ok: false, data, keys }; }
        if (!data || typeof data !== 'object') data = {};
        if (!data.hooks || typeof data.hooks !== 'object') data.hooks = {};
    }
    for (const [event, groups] of Object.entries(data.hooks as Record<string, any>)) {
        for (const g of (Array.isArray(groups) ? groups : [])) {
            for (const cmd of (Array.isArray(g?.hooks) ? g.hooks : [])) {
                if (typeof cmd?.command === 'string') keys.add(hookKey(event, cmd.command));
            }
        }
    }
    return { ok: true, data, keys };
}

// ─── 探测 / 预览 / 执行 ───────────────────────────────────────────────────────

export async function detectSources(fs: ImportFs, roots: ImportRoots): Promise<SourceStatus[]> {
    return Promise.all(IMPORT_SOURCES.map(async source => {
        const flags = await Promise.all(sourceRoots(source, roots).map(p => exists(fs, p)));
        return { source, detected: flags.some(Boolean) };
    }));
}

async function mcpNames(core: ImportCore): Promise<Set<string>> {
    const names = new Set<string>();
    try { for (const s of (await core.getMCPServerInfo()) ?? []) { const n = s?.config?.name ?? s?.name; if (typeof n === 'string') names.add(n); } } catch { /* core 未就绪按不存在处理 */ }
    return names;
}

export async function previewImport(fs: ImportFs, roots: ImportRoots, core: ImportCore, source: ImportSource): Promise<ImportPreview> {
    const categories = await scanSource(fs, roots, source);
    const items = categories.flatMap(c => c.items);
    // 三类「已存在」判定各自只查一次：MCP 名单、hooks.json 键集按目标文件缓存、copy 目标并行 exists
    const names = items.some(i => i.payload.kind === 'mcp') ? await mcpNames(core) : new Set<string>();
    const hookFiles = [...new Set(items.flatMap(i => (i.payload.kind === 'hook' ? [i.payload.dstFile] : [])))];
    const hookKeys = new Map(await Promise.all(hookFiles.map(async f => [f, (await readTargetHooks(fs, f)).keys] as const)));
    await Promise.all(items.map(async item => {
        const p = item.payload;
        if (p.kind === 'mcp') item.exists = names.has(item.name);
        else if (p.kind === 'copy') item.exists = await exists(fs, p.dst);
        else item.exists = hookKeys.get(p.dstFile)!.has(hookKey(p.event, p.command));
        item.sourcePath = display(roots, item.sourcePath);
    }));
    for (const cat of categories) cat.sourcePaths = cat.sourcePaths.map(p => display(roots, p));
    return { source, hasProject: !!roots.project, categories };
}

export async function executeImport(fs: ImportFs, roots: ImportRoots, core: ImportCore, items: ImportItem[]): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, failed: 0 };
    const touched = new Set<ImportCategory>();
    const names = items.some(i => i.payload.kind === 'mcp') ? await mcpNames(core) : new Set<string>();
    const hooksByFile = new Map<string, ImportItem[]>();

    for (const item of items) {
        const p = item.payload;
        if (p.kind === 'hook') {
            const list = hooksByFile.get(p.dstFile) ?? [];
            list.push(item);
            hooksByFile.set(p.dstFile, list);
            continue;
        }
        try {
            if (p.kind === 'mcp') {
                if (names.has(item.name)) { result.skipped++; continue; }
                await core.addMCPServer({ ...p.config, scope: item.scope });
                names.add(item.name);
            } else {
                // 预览到执行之间目标可能已被创建，落盘前再确认一次
                if (await exists(fs, p.dst)) { result.skipped++; continue; }
                if (p.dir) await fs.copyDir(p.src, p.dst);
                else await fs.writeFile(p.dst, await fs.readFile(p.src));
            }
            result.imported++;
            touched.add(item.category);
        } catch {
            result.failed++;
        }
    }

    // Hook：按目标文件合并写入，事件 + 命令去重
    for (const [file, list] of hooksByFile) {
        const target = await readTargetHooks(fs, file);
        if (!target.ok) { result.failed += list.length; continue; }
        let added = 0;
        for (const item of list) {
            const p = item.payload as Extract<ImportItem['payload'], { kind: 'hook' }>;
            const key = hookKey(p.event, p.command);
            if (target.keys.has(key)) { result.skipped++; continue; }
            const groups: any[] = Array.isArray(target.data.hooks[p.event]) ? target.data.hooks[p.event] : (target.data.hooks[p.event] = []);
            let group = groups.find(g => Array.isArray(g?.hooks) && (g.matcher ?? undefined) === p.matcher);
            if (!group) { group = p.matcher ? { matcher: p.matcher, hooks: [] } : { hooks: [] }; groups.push(group); }
            group.hooks.push(p.timeout !== undefined ? { type: 'command', command: p.command, timeout: p.timeout } : { type: 'command', command: p.command });
            target.keys.add(key);
            added++;
        }
        if (added === 0) continue;
        try { await fs.writeFile(file, JSON.stringify(target.data, null, 2) + '\n'); result.imported += added; touched.add('hook'); }
        catch { result.failed += added; }
    }

    // 让 core 重新扫描写入过的类别（MCP 走 add 已自带刷新）；刷新失败不影响已落盘结果
    const refresh: Partial<Record<ImportCategory, () => Promise<any>>> = {
        skill: () => core.getSkillsInfo(true),
        agent: () => core.getAgentsInfo(true),
        command: () => core.getCommandsInfo(true),
        hook: () => core.getHooksInfo(true),
        rule: () => core.getRuleInfo(true),
    };
    await Promise.allSettled([...touched].map(c => refresh[c]?.()));
    return result;
}
