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
 * 按项目存储的数据结构
 */
interface ProjectData {
    projectPath: string;
    lastUpdatedAt: number; // 项目最后更新时间，用于淘汰旧项目
    sessions: Session[];
}

/**
 * SessionHistoryManager 类 - 管理历史会话
 * 负责保存、加载、删除历史会话
 * 存储结构：按项目分组，最多保留 MAX_PROJECTS 个项目，每个项目最多 MAX_SESSIONS 条记录
 */
export class SessionHistoryManager {
    private static readonly STORAGE_KEY = 'sema.sessionHistoryV2';
    private static readonly MAX_SESSIONS = 50;  // 每个项目最多保留50条会话历史
    private static readonly MAX_PROJECTS = 20;  // 最多保留20个项目
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
            if (message.type === 'tool' && message.toolName === 'Task' && message.content?.status === 'running') {
                result.push({ ...message, content: { ...message.content, status: 'interrupted' } });
            } else {
                result.push(message);
            }
        }
        return result;
    }

    /**
     * 保存会话到历史记录
     */
    public async saveSession(messageHistory?: any[]): Promise<void> {
        const sessionId = this.semaWrapper.currentSessionId;
        const title = this.semaWrapper.title;

        // 提前检查必要字段
        if (!sessionId || !title) {
            return;
        }

        const rawMessages = messageHistory || this.semaWrapper.messageHistory || [];

        if (rawMessages.length === 0) {
            return;
        }

        // 过滤不完整消息 + 标记 interrupted（单次遍历）
        const messages = this.sanitizeMessages(rawMessages);

        if (messages.length === 0) {
            return;
        }

        const now = Date.now();
        const allProjects = await this.getAllProjectsRaw();

        // 查找当前项目
        let projectIndex = allProjects.findIndex(p => p.projectPath === this.projectPath);
        if (projectIndex === -1) {
            // 新项目：如果超过最大项目数，删除最旧的项目
            if (allProjects.length >= SessionHistoryManager.MAX_PROJECTS) {
                allProjects.sort((a, b) => a.lastUpdatedAt - b.lastUpdatedAt);
                allProjects.splice(0, allProjects.length - SessionHistoryManager.MAX_PROJECTS + 1);
            }
            allProjects.push({ projectPath: this.projectPath, lastUpdatedAt: now, sessions: [] });
            projectIndex = allProjects.length - 1;
        }

        const projectData = allProjects[projectIndex];
        const existingIndex = projectData.sessions.findIndex(s => s.id === sessionId);

        if (existingIndex !== -1) {
            // 更新现有会话（保留创建时间）
            projectData.sessions[existingIndex] = {
                id: sessionId,
                title: title,
                createdAt: projectData.sessions[existingIndex].createdAt || now,
                updatedAt: now,
                content: [...messages],
                projectPath: this.projectPath
            };
        } else {
            // 新会话，添加到头部
            const session: Session = {
                id: sessionId,
                title: title,
                createdAt: now,
                updatedAt: now,
                content: [...messages],
                projectPath: this.projectPath
            };
            projectData.sessions.unshift(session);

            // 超过每项目最大数量，删除最旧的
            if (projectData.sessions.length > SessionHistoryManager.MAX_SESSIONS) {
                projectData.sessions.splice(SessionHistoryManager.MAX_SESSIONS);
            }
        }

        projectData.lastUpdatedAt = now;
        await this.context.globalState.update(SessionHistoryManager.STORAGE_KEY, allProjects);
    }

    /**
     * 获取所有项目数据（内部使用）
     */
    private async getAllProjectsRaw(): Promise<ProjectData[]> {
        return this.context.globalState.get<ProjectData[]>(SessionHistoryManager.STORAGE_KEY, []);
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
        const allProjects = await this.getAllProjectsRaw();
        const projectData = allProjects.find(p => p.projectPath === this.projectPath);
        if (!projectData) {
            return [];
        }

        const currentSessionId = this.semaWrapper.currentSessionId;
        return [...projectData.sessions].sort((a, b) => {
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
        const allProjects = await this.getAllProjectsRaw();
        const projectData = allProjects.find(p => p.projectPath === this.projectPath);
        if (!projectData) {
            return null;
        }
        return projectData.sessions.find(s => s.id === sessionId) || null;
    }

    /**
     * 删除会话
     */
    public async deleteSession(sessionId: string): Promise<void> {
       // console.log(`删除会话: ${sessionId}`)
        const allProjects = await this.getAllProjectsRaw();
        const projectIndex = allProjects.findIndex(p => p.projectPath === this.projectPath);
        if (projectIndex === -1) {
            return;
        }

        const projectData = allProjects[projectIndex];
        const originalLength = projectData.sessions.length;
        projectData.sessions = projectData.sessions.filter(s => s.id !== sessionId);

        if (projectData.sessions.length < originalLength) {
            await this.context.globalState.update(SessionHistoryManager.STORAGE_KEY, allProjects);
        }
    }

    /**
     * 清空当前项目的所有会话历史
     */
    public async clearAllSessions(): Promise<void> {
       // console.log(`清空会话: ${this.projectPath}`)
        const allProjects = await this.getAllProjectsRaw();
        const filtered = allProjects.filter(p => p.projectPath !== this.projectPath);
        await this.context.globalState.update(SessionHistoryManager.STORAGE_KEY, filtered);
    }
}



