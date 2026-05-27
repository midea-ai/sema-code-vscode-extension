import * as vscode from 'vscode';
import type { AgentMode } from 'sema-core/types';
import type { SemaSessionWrapper } from '../core/semaSessionWrapper';

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

/**
 * SessionHistoryManager 类 - 管理历史会话
 * 负责保存、加载、删除历史会话
 * 存储结构：使用 workspaceState 按项目隔离，每个项目最多 MAX_SESSIONS 条记录
 */
export class SessionHistoryManager {
    private static readonly STORAGE_KEY = 'sema.sessionHistory';
    private static readonly LEGACY_STORAGE_KEY = 'sema.sessionHistoryV2';
    private static readonly MAX_SESSIONS = 50;
    private context: vscode.ExtensionContext;
    private projectPath: string;
    private getActiveSessionId: () => string | null;
    private getOpenIds: () => string[];

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
    }

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
            } else {
                result.push(message);
            }
        }
        return result;
    }

    /**
     * 从 globalState 旧数据迁移当前项目的会话到 workspaceState（一次性）
     */
    private async migrateFromGlobalStateIfNeeded(): Promise<Session[]> {
        const oldData = this.context.globalState.get<any[]>(SessionHistoryManager.LEGACY_STORAGE_KEY, []);
        const projectData = oldData.find((p: any) => p.projectPath === this.projectPath);
        if (!projectData?.sessions?.length) {
            return [];
        }

        // 迁移到 workspaceState
        await this.context.workspaceState.update(SessionHistoryManager.STORAGE_KEY, projectData.sessions);

        // 从 globalState 移除该项目
        const remaining = oldData.filter((p: any) => p.projectPath !== this.projectPath);
        await this.context.globalState.update(
            SessionHistoryManager.LEGACY_STORAGE_KEY,
            remaining.length ? remaining : undefined
        );

        return projectData.sessions;
    }

    /**
     * 获取当前项目的所有会话（内部使用），自动处理迁移
     */
    private async getSessions(): Promise<Session[]> {
        let sessions = this.context.workspaceState.get<Session[]>(SessionHistoryManager.STORAGE_KEY);
        if (!sessions) {
            sessions = await this.migrateFromGlobalStateIfNeeded();
        }
        return sessions ?? [];
    }

    /**
     * 保存指定会话到历史记录
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

        const now = Date.now();
        const sessions = await this.getSessions();
        const existingIndex = sessions.findIndex(s => s.id === sessionId);

        const agentMode: AgentMode = wrapper.getAgentMode?.() ?? 'Agent';

        if (existingIndex !== -1) {
            // 更新现有会话（保留创建时间）
            sessions[existingIndex] = {
                id: sessionId,
                title,
                createdAt: sessions[existingIndex].createdAt || now,
                updatedAt: now,
                content: [...messages],
                projectPath: this.projectPath,
                agentMode
            };
        } else {
            // 新会话，添加到头部
            sessions.unshift({
                id: sessionId,
                title,
                createdAt: now,
                updatedAt: now,
                content: [...messages],
                projectPath: this.projectPath,
                agentMode
            });

            if (sessions.length > SessionHistoryManager.MAX_SESSIONS) {
                sessions.splice(SessionHistoryManager.MAX_SESSIONS);
            }
        }

        await this.context.workspaceState.update(SessionHistoryManager.STORAGE_KEY, sessions);
    }

    /**
     * 获取当前激活的会话ID
     */
    public getCurrentSessionId(): string | null {
        return this.getActiveSessionId();
    }

    /**
     * 获取所有已在 chat 中打开的会话ID（含活跃会话）
     */
    public getOpenSessionIds(): string[] {
        return this.getOpenIds();
    }

    /**
     * 获取当前项目的所有会话
     */
    public async getAllSessions(): Promise<Session[]> {
        const sessions = await this.getSessions();
        const currentSessionId = this.getActiveSessionId();
        const openIds = new Set(this.getOpenIds());
        // 优先级：活跃(0) > 已打开(1) > 其余(2)，同级按更新时间倒序
        const rank = (s: Session): number => {
            if (s.id === currentSessionId) { return 0; }
            if (openIds.has(s.id)) { return 1; }
            return 2;
        };
        return [...sessions].sort((a, b) => {
            const ra = rank(a);
            const rb = rank(b);
            if (ra !== rb) { return ra - rb; }
            return b.updatedAt - a.updatedAt;
        });
    }

    /**
     * 获取会话列表及当前激活ID（减少重复调用）
     */
    public async getSessionsWithActiveId(): Promise<{ sessions: Session[]; currentSessionId: string | null; openSessionIds: string[] }> {
        return {
            sessions: await this.getAllSessions(),
            currentSessionId: this.getActiveSessionId(),
            openSessionIds: this.getOpenIds()
        };
    }

    /**
     * 根据ID获取特定会话
     */
    public async getSession(sessionId: string): Promise<Session | null> {
        const sessions = await this.getSessions();
        return sessions.find(s => s.id === sessionId) || null;
    }

    /**
     * 删除会话
     */
    public async deleteSession(sessionId: string): Promise<void> {
        const sessions = await this.getSessions();
        const filtered = sessions.filter(s => s.id !== sessionId);
        if (filtered.length < sessions.length) {
            await this.context.workspaceState.update(SessionHistoryManager.STORAGE_KEY, filtered);
        }
    }

    /**
     * 清空当前项目的所有会话历史
     */
    public async clearAllSessions(): Promise<void> {
        await this.context.workspaceState.update(SessionHistoryManager.STORAGE_KEY, undefined);
    }
}
