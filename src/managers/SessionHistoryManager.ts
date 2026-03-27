import * as vscode from 'vscode';

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
    private semaWrapper: any;

    constructor(context: vscode.ExtensionContext, workingDir: string, semaWrapper: any) {
        this.context = context;
        this.projectPath = workingDir;
        this.semaWrapper = semaWrapper;
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
     * 保存会话到历史记录
     */
    public async saveSession(messageHistory?: any[]): Promise<void> {
        const sessionId = this.semaWrapper.currentSessionId;
        const title = this.semaWrapper.title;

        if (!sessionId || !title) {
            return;
        }

        const rawMessages = messageHistory || this.semaWrapper.messageHistory || [];

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

        if (existingIndex !== -1) {
            // 更新现有会话（保留创建时间）
            sessions[existingIndex] = {
                id: sessionId,
                title,
                createdAt: sessions[existingIndex].createdAt || now,
                updatedAt: now,
                content: [...messages],
                projectPath: this.projectPath
            };
        } else {
            // 新会话，添加到头部
            sessions.unshift({
                id: sessionId,
                title,
                createdAt: now,
                updatedAt: now,
                content: [...messages],
                projectPath: this.projectPath
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
        return this.semaWrapper.currentSessionId;
    }

    /**
     * 获取当前项目的所有会话
     */
    public async getAllSessions(): Promise<Session[]> {
        const sessions = await this.getSessions();
        const currentSessionId = this.semaWrapper.currentSessionId;
        return [...sessions].sort((a, b) => {
            if (a.id === currentSessionId) { return -1; }
            if (b.id === currentSessionId) { return 1; }
            return b.updatedAt - a.updatedAt;
        });
    }

    /**
     * 获取会话列表及当前激活ID（减少重复调用）
     */
    public async getSessionsWithActiveId(): Promise<{ sessions: Session[]; currentSessionId: string | null }> {
        return {
            sessions: await this.getAllSessions(),
            currentSessionId: this.semaWrapper.currentSessionId
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
