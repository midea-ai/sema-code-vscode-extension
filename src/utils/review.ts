/**
 * 代码审查（/review 与 Source Control 标题栏的「Review in SemaCode」）的纯逻辑：
 * 命令解析、发给主代理的指令模板。宿主与 webview 共用，不依赖 vscode / DOM。
 *
 * 执行方式：插件算好审查范围，给当前会话发一条固定指令，让主代理用 Reviewer 子代理执行并原样带回结果；
 * 审查结果作为 sub_agent 工具返回值进入主会话上下文，界面由 AgentBlock 直接渲染子代理的最后一条回复，
 * 所以指令要求主代理不复述。
 *
 * Reviewer 子代理本身（审查规范与输出版式）定义在 reviewerAgent.ts，只进宿主包。
 */
/** 斜杠命令名（不含 /） */
export const REVIEW_COMMAND = 'review';
/** 宿主内置的审查子代理名；斜杠面板的子代理分组里不显示它 */
export const REVIEWER_AGENT_NAME = 'Reviewer';

/** 审查请求：未提交的改动 / 某次提交；invalid 为认不出的参数 */
export type ReviewRequest =
    | { kind: 'uncommitted' }
    | { kind: 'commit'; ref: string }
    | { kind: 'invalid' };

/** 已解析好的审查范围（宿主查完 git 后的结果） */
export type ReviewScope =
    | {
        kind: 'uncommitted';
        /** 仓库根目录 */
        root: string;
        /** 有改动的文件，相对仓库根、/ 分隔，已去重 */
        files: string[];
        /** 仓库是否已有提交（没有时不能 diff HEAD） */
        hasHead: boolean;
    }
    | {
        kind: 'commit';
        root: string;
        hash: string;
        subject: string;
        isMerge: boolean;
    };

/** 审查不可用的原因 */
export type ReviewUnavailableReason = 'noGit' | 'noRepo' | 'noChanges' | 'commitNotFound';

/** 斜杠面板「审查范围」一步用到的信息（宿主 reviewInfoLoaded） */
export interface ReviewInfo {
    /** 有值表示没法审查：git 不可用 / 工作目录不在仓库里 */
    reason?: 'noGit' | 'noRepo';
    /** 未提交改动涉及的文件数（为 0 时该选项置灰） */
    files: number;
    /** 仓库是否已有提交（没有时「某次提交」选项置灰） */
    hasCommits: boolean;
}

/** 斜杠面板「选择一次提交」里的一条（宿主 reviewCommitsLoaded） */
export interface ReviewCommit {
    hash: string;
    subject: string;
    /** 本地日期 YYYY-MM-DD */
    date: string;
    author: string;
}

/** 指令里最多列出的改动文件数，超出只给数量（审查者自己会跑 git status） */
const MAX_LISTED_FILES = 100;

/**
 * 解析输入是否为 /review 命令。不是则返回 null。
 *   /review | /review uncommitted | /review current changes → 未提交的改动（后者是气泡里的写法）
 *   /review commit <sha>[: 任意说明文字]   → 某次提交（sha 之后的文字忽略，气泡里用来放提交标题）
 */
export function parseReviewCommand(text: string): ReviewRequest | null {
    const m = text.trim().match(/^\/review(?:\s+([\s\S]*))?$/);
    if (!m) return null;
    const args = (m[1] ?? '').trim();
    if (args === '' || args === 'uncommitted' || args === 'current changes') return { kind: 'uncommitted' };
    // sha 后可以紧跟冒号（气泡里的 `commit <sha>: <标题>`）
    const commit = args.match(/^commit\s+([^\s:]+)/);
    // 只认十六进制 sha 或 HEAD / HEAD~n / HEAD^：其余写法（含以 - 开头的）一律不接受
    if (commit && /^(?:[0-9a-fA-F]{4,40}|HEAD(?:[~^]\d*)*)$/.test(commit[1])) {
        return { kind: 'commit', ref: commit[1] };
    }
    return { kind: 'invalid' };
}

/** 气泡里显示、也是输入历史 / 回退回填的文本：保持可被 parseReviewCommand 再次解析 */
export function reviewDisplayText(scope: ReviewScope): string {
    if (scope.kind === 'uncommitted') return `/${REVIEW_COMMAND} current changes`;
    const hash = scope.hash.slice(0, 7);
    return `/${REVIEW_COMMAND} commit ${scope.subject ? `${hash}: ${scope.subject}` : hash}`;
}

function reviewerTask(scope: ReviewScope): string {
    const lines: string[] = [];
    if (scope.kind === 'uncommitted') {
        lines.push(`Scope: uncommitted changes (staged, unstaged, and untracked files) in the repository at ${scope.root}.`);
        lines.push(scope.hasHead
            ? 'Read the change with `git status --short -uall` and `git diff HEAD`, then read each untracked file in full. Skip binary, generated, and lock files.'
            : 'The repository has no commits yet. Read the change with `git status --short -uall`, `git diff --cached`, and `git diff`, then read each untracked file in full. Skip binary, generated, and lock files.');
        const listed = scope.files.slice(0, MAX_LISTED_FILES);
        lines.push(`Files changed when the review was requested (${scope.files.length}):`);
        lines.push(...listed.map(f => `- ${f}`));
        if (scope.files.length > listed.length) {
            lines.push(`- (${scope.files.length - listed.length} more; see git status)`);
        }
    } else {
        lines.push(`Scope: the changes introduced by commit ${scope.hash} ("${scope.subject}") in the repository at ${scope.root}.`);
        lines.push(scope.isMerge
            ? `Read the change with \`git show ${scope.hash}\`. This is a merge commit: use \`git show -m --first-parent ${scope.hash}\` when the combined diff is empty.`
            : `Read the change with \`git show ${scope.hash}\`.`);
    }
    return lines.join('\n');
}

/**
 * 发给主代理的指令。title 是子代理块上显示的任务名，doneLine 是主代理收尾的那一句（都已按界面语言取好）。
 */
export function buildReviewInstruction(scope: ReviewScope, title: string, doneLine: string): string {
    return [
        `Run a code review by delegating to the \`${REVIEWER_AGENT_NAME}\` sub-agent. Do exactly the following and nothing else:`,
        '',
        `1. Call the sub_agent tool exactly once, in the foreground (not in the background), with agent_type "${REVIEWER_AGENT_NAME}" and title ${JSON.stringify(title)}. Pass the text inside <reviewer_task> as its instructions, verbatim: do not add, remove, or rephrase anything. Do not run any command or read any file yourself first.`,
        `2. When it returns, do not repeat, summarize, or comment on its result: the interface already shows the full review to the user. Reply with exactly one line: ${doneLine}`,
        '3. If the sub-agent fails or returns no review, say so in one line instead. Do not write a review yourself.',
        '4. Do not fix or change anything unless the user asks afterwards.',
        '',
        '<reviewer_task>',
        reviewerTask(scope),
        '</reviewer_task>',
    ].join('\n');
}
