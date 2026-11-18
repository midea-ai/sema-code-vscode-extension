/**
 * 代码审查用的 git 查询：有无改动、最近提交、把审查请求解析成具体范围。
 * 全部走 VS Code 内置 git 扩展的公开 API（vscode.git），不自己调 git 命令。
 * 只认「工作目录所在的仓库」：core 的 shell 以工作目录为 cwd，审查者在那里跑 git。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { ReviewRequest, ReviewScope, ReviewInfo, ReviewCommit, ReviewUnavailableReason } from '../utils/review';
import { toDateKey } from '../webview/common/usageFormat';

// ── vscode.git 公开 API 的最小类型（对应其 git.d.ts，只列用到的成员）──
interface GitChange { uri: vscode.Uri }
interface GitCommit { hash: string; message: string; parents: string[]; authorDate?: Date; authorName?: string }
interface GitRepositoryState {
    HEAD?: { commit?: string };
    mergeChanges: GitChange[];
    indexChanges: GitChange[];
    workingTreeChanges: GitChange[];
    /** git.untrackedChanges 设为 separate 时未跟踪文件在这里；较旧的 VS Code 没有该字段 */
    untrackedChanges?: GitChange[];
}
interface GitRepository {
    rootUri: vscode.Uri;
    state: GitRepositoryState;
    log(options?: { maxEntries?: number }): Promise<GitCommit[]>;
    getCommit(ref: string): Promise<GitCommit>;
    status(): Promise<void>;
}
interface GitAPI {
    state: 'uninitialized' | 'initialized';
    getRepository(uri: vscode.Uri): GitRepository | null;
}
interface GitExtensionExports { enabled: boolean; getAPI(version: 1): GitAPI }

export type ResolvedReviewScope =
    | { ok: true; scope: ReviewScope }
    | { ok: false; reason: ReviewUnavailableReason };

const MAX_COMMITS = 50;
/** git 扩展刚激活时仓库还没扫完，最多等这么久 */
const REPO_WAIT_MS = 3000;

const subjectOf = (message: string): string => (message || '').split('\n')[0].trim();

export class GitReviewManager {
    constructor(private readonly workingDir: string) { }

    private async getApi(): Promise<GitAPI | null> {
        try {
            const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
            if (!ext) return null;
            const exports = ext.isActive ? ext.exports : await ext.activate();
            return exports?.enabled ? exports.getAPI(1) : null;
        } catch (error) {
            console.error('[review] git extension unavailable:', error);
            return null;
        }
    }

    /** 工作目录所在的仓库；git 扩展还在初始化时稍等。取不到时返回原因 */
    private async getRepository(): Promise<GitRepository | 'noGit' | 'noRepo'> {
        const api = await this.getApi();
        if (!api) return 'noGit';
        const uri = vscode.Uri.file(this.workingDir);
        const deadline = Date.now() + REPO_WAIT_MS;
        let repo = api.getRepository(uri);
        while (!repo && api.state !== 'initialized' && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 150));
            repo = api.getRepository(uri);
        }
        return repo ?? 'noRepo';
    }

    /** 未提交改动涉及的文件（已暂存 + 未暂存 + 未跟踪 + 冲突），相对仓库根、去重 */
    private changedFiles(repo: GitRepository): string[] {
        const { state } = repo;
        const root = repo.rootUri.fsPath;
        const seen = new Set<string>();
        for (const change of [...state.mergeChanges, ...state.indexChanges, ...state.workingTreeChanges, ...(state.untrackedChanges ?? [])]) {
            seen.add(path.relative(root, change.uri.fsPath).replace(/\\/g, '/'));
        }
        return [...seen].sort();
    }

    /** 斜杠面板第一步用：有没有仓库、有没有未提交的改动、有没有提交（只用来置灰选项） */
    public async getInfo(): Promise<ReviewInfo> {
        const repo = await this.getRepository();
        if (typeof repo === 'string') return { reason: repo, files: 0, hasCommits: false };
        return { files: this.changedFiles(repo).length, hasCommits: !!repo.state.HEAD?.commit };
    }

    public async getRecentCommits(): Promise<ReviewCommit[]> {
        const repo = await this.getRepository();
        if (typeof repo === 'string') return [];
        try {
            const commits = await repo.log({ maxEntries: MAX_COMMITS });
            return commits.map(c => ({
                hash: c.hash,
                subject: subjectOf(c.message),
                date: c.authorDate ? toDateKey(c.authorDate) : '',
                author: c.authorName ?? '',
            }));
        } catch (error) {
            // 空仓库（还没有提交）时 log 会报错
            console.warn('[review] git log failed:', error);
            return [];
        }
    }

    /** 把审查请求解析成具体范围；范围为空或提交不存在时返回原因 */
    public async resolve(request: Exclude<ReviewRequest, { kind: 'invalid' }>): Promise<ResolvedReviewScope> {
        const repo = await this.getRepository();
        if (typeof repo === 'string') return { ok: false, reason: repo };
        const root = repo.rootUri.fsPath;

        if (request.kind === 'uncommitted') {
            // 右键触发时面板状态可能略旧，先刷新一次
            try { await repo.status(); } catch { /* 用现有状态 */ }
            const files = this.changedFiles(repo);
            if (files.length === 0) return { ok: false, reason: 'noChanges' };
            return { ok: true, scope: { kind: 'uncommitted', root, files, hasHead: !!repo.state.HEAD?.commit } };
        }

        try {
            const commit = await repo.getCommit(request.ref);
            return {
                ok: true,
                scope: {
                    kind: 'commit',
                    root,
                    hash: commit.hash,
                    subject: subjectOf(commit.message),
                    isMerge: commit.parents.length > 1,
                },
            };
        } catch {
            return { ok: false, reason: 'commitNotFound' };
        }
    }
}
