import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { AgentMode } from 'sema-core/types';
import type { SemaSessionWrapper } from '../core/semaSessionWrapper';
import { CLAW_SESSION_ID } from '../claw/paths';
import { searchSessionMessages, type SessionSearchHit } from '../webview/sessionHistory/search';
import { turnNavItems, type TurnNavItem } from '../webview/chat/utils/turnNav';

/** 附图原图的扩展名 → media_type（core 按文件头识别后落盘为这四种） */
const ATTACHED_IMAGE_MEDIA_TYPES: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

/**
 * 会话数据结构
 */
export interface Session {
    id: string;
    title: string;
    createdAt: number; // 创建时间
    updatedAt: number; // 更新时间
    content: any[]; // 消息历史数组
    projectPath: string; // 项目路径，用于区分不同项目的会话
    agentMode?: AgentMode; // 会话使用的 Agent 模式（旧会话可能为 undefined）
}

/** 索引条目：只含列表页需要的元信息，正文放在单独文件里 */
interface SessionIndexEntry {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    agentMode?: AgentMode;
}

const INDEX_VERSION = 1;

/**
 * SessionHistoryManager - 历史会话的保存与加载
 *
 * 存储结构：工作区存储目录下 `history/index.json` 存列表元信息，
 * `history/<sessionId>.json` 存单个会话的消息数组。
 * 写入按会话串行化，索引使用「重读 → 合并 → 写回」，文件先写临时文件再重命名。
 * 旧的 workspaceState 整体数组会在首次读取时迁移到文件，迁移完成前读取回落到旧键。
 */
export class SessionHistoryManager {
    private static readonly LEGACY_STORAGE_KEY = 'sema.sessionHistory';
    private static readonly LEGACY_V2_KEY = 'sema.sessionHistoryV2';
    private static readonly MAX_SESSIONS = 50;
    /** 参与正文检索的单份存档体积上限：超大存档跳过，避免为它付一次整段解析 */
    private static readonly MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
    /** 悬浮预览展示的轮次数 */
    private static readonly PREVIEW_TURNS = 5;

    private context: vscode.ExtensionContext;
    private projectPath: string;
    private getActiveSessionId: () => string | null;
    private getOpenIds: () => string[];
    private storageDir: string;

    private migrated = false;
    private migratePromise: Promise<void> | null = null;
    /** 迁移未完成时的旧数据回落：读取用它，写入回写旧键 */
    private legacySessions: Session[] | null = null;
    /** 索引写入串行队列：多个会话并发保存时按顺序合并 */
    private indexQueue: Promise<void> = Promise.resolve();
    /** 会话正文写入串行队列，按 sessionId 隔离 */
    private sessionQueues: Map<string, Promise<void>> = new Map();

    constructor(
        context: vscode.ExtensionContext,
        workingDir: string,
        getActiveSessionId: () => string | null,
        getOpenIds: () => string[]
    ) {
        this.context = context;
        this.projectPath = workingDir;
        this.getActiveSessionId = getActiveSessionId;
        this.getOpenIds = getOpenIds;

        // 工作区有独立存储目录时按工作区隔离；无工作区时落在全局存储目录下的项目哈希子目录
        const base = context.storageUri?.fsPath
            ?? path.join(context.globalStorageUri.fsPath, 'workspaces', SessionHistoryManager.hashPath(workingDir));
        this.storageDir = path.join(base, 'history');
    }

    private static hashPath(value: string): string {
        return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
    }

    private indexPath(): string {
        return path.join(this.storageDir, 'index.json');
    }

    /** sessionId 来自 core，编码后作为文件名，避免特殊字符与路径穿越 */
    private sessionPath(sessionId: string): string {
        return path.join(this.storageDir, encodeURIComponent(sessionId) + '.json');
    }

    // ─── 文件读写 ─────────────────────────────────────────────────────────────

    private async readIndex(): Promise<SessionIndexEntry[]> {
        try {
            const raw = await fs.promises.readFile(this.indexPath(), 'utf8');
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
            return list.filter((entry: any) => entry && typeof entry.id === 'string');
        } catch {
            return [];
        }
    }

    /** 先写临时文件再重命名，进程中断不会留下半截 JSON */
    private async writeJsonAtomic(file: string, data: unknown): Promise<void> {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
        await fs.promises.rename(tmp, file);
    }

    private async writeSessionFile(sessionId: string, content: any[]): Promise<void> {
        await this.writeJsonAtomic(this.sessionPath(sessionId), { version: INDEX_VERSION, content });
    }

    private async readSessionFile(sessionId: string): Promise<any[] | null> {
        try {
            const raw = await fs.promises.readFile(this.sessionPath(sessionId), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.content) ? parsed.content : [];
        } catch {
            return null;
        }
    }

    /**
     * 索引更新：重读最新文件后合并本条再写回。返回被移除的会话 id（供调用方清理正文文件）。
     */
    private queueIndexWrite(
        mutate: (sessions: SessionIndexEntry[]) => SessionIndexEntry[] | Promise<SessionIndexEntry[]>
    ): Promise<string[]> {
        const run = this.indexQueue.then(async () => {
            const sessions = await this.readIndex();
            const next = await mutate(sessions);
            await this.writeJsonAtomic(this.indexPath(), { version: INDEX_VERSION, sessions: next });
            const kept = new Set(next.map(s => s.id));
            return sessions.filter(s => !kept.has(s.id)).map(s => s.id);
        });
        this.indexQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    /** 同一会话的写入排队执行；不同会话互不阻塞 */
    private queueSessionWrite<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
        const prev = this.sessionQueues.get(sessionId) ?? Promise.resolve();
        const next = prev.then(run, run);
        this.sessionQueues.set(sessionId, next.then(() => undefined, () => undefined));
        return next;
    }

    // ─── 迁移 ─────────────────────────────────────────────────────────────────

    private async ensureMigrated(): Promise<void> {
        if (this.migrated) return;
        if (!this.migratePromise) {
            this.migratePromise = this.migrateLegacy().then(
                () => {
                    this.migrated = true;
                    this.migratePromise = null;
                },
                (error) => {
                    // 迁移失败：保留旧键，读取走回落，下次调用重试
                    console.error('Error migrating session history:', error);
                    this.migratePromise = null;
                }
            );
        }
        await this.migratePromise;
    }

    private async migrateLegacy(): Promise<void> {
        let source: Session[] | null = null;
        let fromGlobal = false;

        const legacy = this.context.workspaceState.get<Session[]>(SessionHistoryManager.LEGACY_STORAGE_KEY);
        if (Array.isArray(legacy) && legacy.length > 0) {
            source = legacy;
        } else {
            const oldData = this.context.globalState.get<any[]>(SessionHistoryManager.LEGACY_V2_KEY, []);
            const projectData = oldData.find((p: any) => p?.projectPath === this.projectPath);
            if (projectData?.sessions?.length) {
                source = projectData.sessions;
                fromGlobal = true;
            }
        }

        if (!source || source.length === 0) {
            this.legacySessions = null;
            // 没有旧数据：只有目录缺失时补一个空索引，避免每次读取都走异常分支
            if (!fs.existsSync(this.indexPath())) {
                await this.writeJsonAtomic(this.indexPath(), { version: INDEX_VERSION, sessions: [] });
            }
            return;
        }

        this.legacySessions = source;
        const entries: SessionIndexEntry[] = [];
        for (const session of source) {
            if (!session?.id) continue;
            const content = Array.isArray(session.content) ? session.content : [];
            await this.writeSessionFile(session.id, content);
            entries.push({
                id: session.id,
                title: session.title || '',
                createdAt: session.createdAt || Date.now(),
                updatedAt: session.updatedAt || 0,
                agentMode: session.agentMode,
            });
        }
        await this.writeJsonAtomic(this.indexPath(), { version: INDEX_VERSION, sessions: entries });

        await this.context.workspaceState.update(SessionHistoryManager.LEGACY_STORAGE_KEY, undefined);
        if (fromGlobal) {
            const remaining = this.context.globalState
                .get<any[]>(SessionHistoryManager.LEGACY_V2_KEY, [])
                .filter((p: any) => p?.projectPath !== this.projectPath);
            await this.context.globalState.update(
                SessionHistoryManager.LEGACY_V2_KEY,
                remaining.length ? remaining : undefined
            );
        }
        this.legacySessions = null;
    }

    // ─── 消息清理 ─────────────────────────────────────────────────────────────

    /**
     * 过滤不完整的 assistant 消息，并将 running 状态的 Task 标记为 interrupted
     * 合并两次遍历为一次，减少开销
     */
    private sanitizeMessages(messages: any[]): any[] {
        const result: any[] = [];
        for (const message of messages) {
            if (message.type === 'assistant') {
                const isCompleted = message.content?.completed === true;
                const hasContent = message.content?.content && message.content.content.length > 0;
                if (!isCompleted && !hasContent) {
                    continue; // 过滤掉不完整的 assistant 消息
                }
            }
            if (message.type === 'tool' && message.toolName === 'Agent' && message.content?.status === 'running') {
                result.push({ ...message, content: { ...message.content, status: 'interrupted' } });
            } else if (message.type === 'user' && Array.isArray(message.attachments) && message.attachments.some((a: any) => a?.path && a?.data)) {
                // 附图有原图路径（core input:processing 带回）的不存 base64，加载历史时按路径读回，见 restoreAttachments
                result.push({
                    ...message,
                    attachments: message.attachments.map((a: any) => (a?.path ? { type: a.type, media_type: a.media_type, path: a.path } : a)),
                });
            } else {
                result.push(message);
            }
        }
        return result;
    }

    /**
     * 存档里只留了原图路径的附图：读回原图补上 base64，气泡显示、回退回填与存档前一致。
     * media_type 按原图扩展名取（存档里记的是压缩后的类型，可能与原图不同）；
     * 原图已被清理的图去掉；旧存档自带 base64 的不动
     */
    private restoreAttachments(messages: any[]): any[] {
        return messages.map(message => {
            if (message?.type !== 'user' || !Array.isArray(message.attachments)
                || !message.attachments.some((a: any) => a?.path && !a?.data)) {
                return message;
            }
            const attachments = message.attachments.flatMap((a: any) => {
                if (!a?.path || a.data) return [a];
                try {
                    const mediaType = ATTACHED_IMAGE_MEDIA_TYPES[path.extname(a.path).toLowerCase()] ?? a.media_type;
                    return [{ ...a, media_type: mediaType, data: fs.readFileSync(a.path).toString('base64') }];
                } catch {
                    return [];
                }
            });
            return { ...message, attachments: attachments.length > 0 ? attachments : undefined };
        });
    }

    // ─── 保存 / 读取 ──────────────────────────────────────────────────────────

    /**
     * 保存指定会话：写正文文件，再更新索引元信息。
     */
    public async saveSession(wrapper?: SemaSessionWrapper): Promise<void> {
        if (!wrapper) {
            return;
        }
        const sessionId = wrapper.sessionId;
        const title = wrapper.title;

        if (!sessionId || !title) {
            return;
        }

        const rawMessages = wrapper.getMessageHistory() || [];
        if (rawMessages.length === 0) {
            return;
        }

        const messages = this.sanitizeMessages(rawMessages);
        if (messages.length === 0) {
            return;
        }

        await this.ensureMigrated();
        const agentMode: AgentMode = wrapper.getAgentMode?.() ?? 'Agent';

        // 迁移未完成：继续写旧键，保证数据不丢
        if (this.legacySessions) {
            await this.saveToLegacyKey({ sessionId, title, messages, agentMode });
            return;
        }

        await this.queueSessionWrite(sessionId, async () => {
            const now = Date.now();
            await this.writeSessionFile(sessionId, messages);
            const removed = await this.queueIndexWrite((sessions) => {
                const existing = sessions.find(s => s.id === sessionId);
                const entry: SessionIndexEntry = {
                    id: sessionId,
                    title,
                    createdAt: existing?.createdAt || now,
                    updatedAt: now,
                    agentMode,
                };
                return [entry, ...sessions.filter(s => s.id !== sessionId)].slice(0, SessionHistoryManager.MAX_SESSIONS);
            });
            await this.removeSessionFiles(removed);
        });
    }

    private async saveToLegacyKey(data: { sessionId: string; title: string; messages: any[]; agentMode: AgentMode }): Promise<void> {
        const now = Date.now();
        const sessions = (this.legacySessions || []).slice();
        const index = sessions.findIndex(s => s.id === data.sessionId);
        if (index !== -1) {
            sessions[index] = {
                ...sessions[index],
                title: data.title,
                updatedAt: now,
                content: [...data.messages],
                agentMode: data.agentMode,
            };
        } else {
            sessions.unshift({
                id: data.sessionId,
                title: data.title,
                createdAt: now,
                updatedAt: now,
                content: [...data.messages],
                projectPath: this.projectPath,
                agentMode: data.agentMode,
            });
            if (sessions.length > SessionHistoryManager.MAX_SESSIONS) {
                sessions.splice(SessionHistoryManager.MAX_SESSIONS);
            }
        }
        this.legacySessions = sessions;
        await this.context.workspaceState.update(SessionHistoryManager.LEGACY_STORAGE_KEY, sessions);
    }

    private async removeSessionFiles(ids: string[]): Promise<void> {
        for (const id of ids) {
            try {
                await fs.promises.rm(this.sessionPath(id), { force: true });
            } catch {
                // ignore
            }
        }
    }

    public getCurrentSessionId(): string | null {
        return this.getActiveSessionId();
    }

    public getOpenSessionIds(): string[] {
        return this.getOpenIds();
    }

    /**
     * 获取当前项目的所有会话（列表页只需要元信息，content 返回空数组）
     */
    public async getAllSessions(): Promise<Session[]> {
        await this.ensureMigrated();
        const entries: Array<{ id: string; title: string; createdAt: number; updatedAt: number; agentMode?: AgentMode; content: any[] }> =
            this.legacySessions
                ? this.legacySessions.map(s => ({ ...s, content: [] }))
                : (await this.readIndex()).map(e => ({ ...e, content: [] }));

        const currentSessionId = this.getActiveSessionId();
        const openIds = new Set(this.getOpenIds());
        const rank = (s: { id: string }): number => {
            if (s.id === currentSessionId) { return 0; }
            if (openIds.has(s.id)) { return 1; }
            return 2;
        };
        // claw 远程会话不进历史列表：它由远程连接驱动、不能像普通会话那样从历史「点开恢复」
        return entries
            .filter(s => s.id !== CLAW_SESSION_ID)
            .map(s => ({ ...s, projectPath: this.projectPath }))
            .sort((a, b) => {
                const ra = rank(a);
                const rb = rank(b);
                if (ra !== rb) { return ra - rb; }
                return b.updatedAt - a.updatedAt;
            });
    }

    public async getSessionsWithActiveId(): Promise<{ sessions: Session[]; currentSessionId: string | null; openSessionIds: string[] }> {
        return {
            sessions: await this.getAllSessions(),
            currentSessionId: this.getActiveSessionId(),
            openSessionIds: this.getOpenIds()
        };
    }

    /**
     * 根据 id 读取单个会话（正文按需读文件）
     */
    public async getSession(sessionId: string): Promise<Session | null> {
        await this.ensureMigrated();

        if (this.legacySessions) {
            const found = this.legacySessions.find(s => s.id === sessionId);
            // 返回副本：读回的图片只进内存，不改动回落数据里的对象
            return found ? { ...found, content: this.restoreAttachments(found.content || []) } : null;
        }

        const entries = await this.readIndex();
        const entry = entries.find(e => e.id === sessionId);
        if (!entry) {
            return null;
        }
        const content = await this.readSessionFile(sessionId);
        if (content === null) {
            return null;
        }
        return {
            ...entry,
            content: this.restoreAttachments(content),
            projectPath: this.projectPath,
        };
    }

    /**
     * 正文检索：逐份读会话正文并匹配，只回命中片段。
     *
     * 只在用户显式触发（回车）时调用，不建索引、不做缓存——检索是低频需求，
     * 成本只落在这一次调用上，不用它的人（以及保存 / 刷新列表路径）零增量。
     */
    public async searchSessionBodies(query: string): Promise<SessionSearchHit[]> {
        const needle = query.trim();
        if (!needle) { return []; }
        await this.ensureMigrated();

        // 迁移未完成的回落数据正文就在内存里；否则只用索引里的 id，正文按需读
        const legacy = this.legacySessions
            ? new Map(this.legacySessions.map(s => [s.id, s.content] as [string, any[]]))
            : null;
        const ids = legacy
            ? Array.from(legacy.keys())
            : (await this.readIndex()).map(entry => entry.id);

        const hits: SessionSearchHit[] = [];
        for (const id of ids) {
            if (id === CLAW_SESSION_ID) { continue; }
            const content = legacy ? legacy.get(id) : await this.readSearchableSession(id);
            if (!content) { continue; }
            const hit = searchSessionMessages(id, content, needle);
            if (hit) { hits.push(hit); }
        }
        return hits;
    }

    /**
     * 单条会话的悬浮预览：最近 5 轮的标题与结论。
     *
     * 与正文检索同一套读法：悬浮时才读这一份正文，不缓存、不预读；超过体积上限的存档直接没有预览。
     */
    public async getSessionPreview(sessionId: string): Promise<TurnNavItem[]> {
        await this.ensureMigrated();
        const content = this.legacySessions
            ? this.legacySessions.find(s => s.id === sessionId)?.content ?? null
            : await this.readSearchableSession(sessionId);
        if (!content) { return []; }
        return turnNavItems(content, false).slice(-SessionHistoryManager.PREVIEW_TURNS);
    }

    /** 读一份正文用于检索/预览；体积超过上限的存档直接跳过（返回 null） */
    private async readSearchableSession(sessionId: string): Promise<any[] | null> {
        try {
            const stat = await fs.promises.stat(this.sessionPath(sessionId));
            if (stat.size > SessionHistoryManager.MAX_SEARCH_FILE_BYTES) { return null; }
        } catch {
            return null;
        }
        return this.readSessionFile(sessionId);
    }

    public async deleteSession(sessionId: string): Promise<void> {
        await this.ensureMigrated();

        if (this.legacySessions) {
            this.legacySessions = this.legacySessions.filter(s => s.id !== sessionId);
            await this.context.workspaceState.update(SessionHistoryManager.LEGACY_STORAGE_KEY, this.legacySessions);
            return;
        }

        await this.queueIndexWrite(sessions => sessions.filter(s => s.id !== sessionId));
        await this.removeSessionFiles([sessionId]);
    }

    /**
     * 清空当前项目的所有会话历史
     */
    public async clearAllSessions(): Promise<void> {
        await this.context.workspaceState.update(SessionHistoryManager.LEGACY_STORAGE_KEY, undefined);
        this.legacySessions = null;
        this.migrated = true;
        await fs.promises.rm(this.storageDir, { recursive: true, force: true });
    }
}
