/**
 * The bridge between a WeChat channel and the claw agent session — a headless
 * sibling of SemaSessionWrapper: it subscribes to the same session events but,
 * instead of posting to a webview, relays the main agent's output to WeChat.
 * Each completed main-agent message is sent as its OWN WeChat message (so a
 * turn shaped "text → tool → more text" arrives as separate replies); a send
 * queue keeps their order stable.
 *
 * Inbound routing: /cancel → interrupt; y/n → permission answer; everything
 * else (incl. /clear, /compact, which sema-core handles natively) →
 * processUserInput. pick:option / plan:exit are out of MVP scope but
 * acknowledged so the turn never deadlocks silently.
 */
import { MAIN_AGENT_ID } from "sema-core/types";
import type {
  CompactExecData,
  InputProcessingData,
  MessageCompleteData,
  SessionErrorData,
  StateUpdateData,
  ToolExecutionCompleteData,
  ToolPermissionRequestData,
} from "sema-core/event";

import {
  TOOL_NAME_EDIT_NOTEBOOK,
  TOOL_NAME_FETCH_URL,
  TOOL_NAME_PATCH_FILE,
  TOOL_NAME_RUN_SHELL,
  TOOL_NAME_SEARCH_CONTENT,
  TOOL_NAME_SEARCH_FILES,
  TOOL_NAME_SKILL,
  TOOL_NAME_VIEW_FILE,
  TOOL_NAME_WRITE_FILE,
} from "../utils/tool";
import type { ChannelAdapter, NormalizedMessage, ReplyContext } from "./channels/types";
import type { ClawSession } from "./session";
import { loadClawVerbosity } from "./settings";

const YES_TOKENS = new Set(["y", "yes", "是", "好", "好的", "可以", "允许", "同意", "ok", "嗯"]);
const NO_TOKENS = new Set(["n", "no", "否", "不", "不行", "拒绝", "不要"]);

/** 手机端不便打斜杠：自然语言指令 → sema-core 原生命令 的别名表（需整句精确匹配）。 */
const COMMAND_ALIASES: Record<string, string> = {
  "清除上下文": "/clear",
  "清空上下文": "/clear",
  "清理上下文": "/clear",
  "压缩上下文": "/compact",
};

interface PendingPermission {
  toolId: string;
  toolName: string;
  options: Record<string, string>;
}

interface BoundListener {
  event: string;
  fn: (data: unknown) => void;
}

const snippet = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);

/** 文件路径过长时省略前面、保留靠近文件名的尾部（尽量从路径段边界切），如 `…/claw/bridge.ts`。 */
function truncatePathHead(p: string, max = 48): string {
  if (p.length <= max) return p;
  const tail = p.slice(p.length - max);
  const slash = tail.indexOf("/");
  return "…" + (slash >= 0 ? tail.slice(slash) : tail);
}

export class ClawBridge {
  private pendingPermission: PendingPermission | null = null;
  private activeReplyCtx: ReplyContext | null = null;
  private listeners: BoundListener[] = [];
  /** 手机端刚发来、正等待 input:processing 回响的原文；用于把它和电脑端输入区分开。 */
  private pendingPhoneInput: string | null = null;
  /** 串行发送链：保证一个 turn 内多条回复按生成顺序依次到达手机，不乱序。 */
  private sendChain: Promise<void> = Promise.resolve();
  /** 连续的只读探查工具（查看文件 / 搜索 / 列目录 / 查找 / 路径探查）先攒着，遇到非只读输出或 turn 结束（idle）时合并成一条中文汇总发出，避免逐条 🔧 刷屏。归桶集合与 webview GroupedToolBlock 的可分组工具保持一致。 */
  private pendingReads: Array<"文件" | "搜索" | "目录" | "探查"> = [];
  /** 极简档专用：暂存本 turn 最后一段主代理文字，turn 结束（idle）时只发它（结论）。 */
  private lastMainMessage: string | null = null;

  constructor(
    private readonly clawSession: ClawSession,
    private readonly channel: ChannelAdapter,
    private readonly log: (m: string) => void = () => {},
    /** 远程应答权限后回调，宿主据此关闭 chat 页对应会话的权限弹窗。 */
    private readonly onPermissionResolved: () => void = () => {},
  ) {}

  start(): void {
    this.attach();
  }

  dispose(): void {
    this.detach();
    this.pendingPermission = null;
    this.activeReplyCtx = null;
    this.pendingPhoneInput = null;
    this.sendChain = Promise.resolve();
    this.pendingReads = [];
    this.lastMainMessage = null;
  }

  /**
   * 电脑端 chat 已应答 claw 会话的权限时由宿主调用：清掉这边的待确认状态
   * （否则 pendingPermission 会一直挂着，手机端发任何消息都被挡在"请先回复 y/n"），
   * 并把同意/拒绝的结果回传手机，让远端知道电脑替它做了选择。
   */
  onDesktopPermissionAnswered(selected?: string): void {
    if (!this.pendingPermission) return;
    this.pendingPermission = null;
    const refused = !!selected && /refuse|reject|deny|no/i.test(selected);
    this.log(`permission answered on desktop selected=${selected ?? ""} -> ${refused ? "refused" : "agreed"}`);
    this.enqueueSend(refused ? "🚫 已在电脑端拒绝。" : "✅ 已在电脑端允许。");
  }

  // --- session event subscription -------------------------------------------

  private attach(): void {
    const s = this.clawSession.session;
    const add = <T>(event: string, fn: (data: T) => void) => {
      s.on<T>(event, fn);
      this.listeners.push({ event, fn: fn as (d: unknown) => void });
    };

    add<MessageCompleteData>("message:complete", (d) => {
      const isMain = d.agentId === MAIN_AGENT_ID || !d.agentId;
      this.log(`message:complete agent=${d.agentId} main=${isMain} hasTools=${d.hasToolCalls} len=${d.content?.length ?? 0}`);
      // 每条完整的主代理消息单独即时发送（同一 turn 的多段 → 多条）；子代理输出是内部细节，不外发。
      if (isMain && d.content?.trim()) {
        const content = d.content.trim();
        // 极简档：不逐段发，只暂存最后一段，turn 结束（idle）时作为「结论」发出。
        if (loadClawVerbosity() === "minimal") {
          this.lastMainMessage = content;
          return;
        }
        this.flushReadBatch();
        this.enqueueSend(content);
      }
    });

    add<ToolExecutionCompleteData>("tool:execution:complete", (d) => {
      const isMain = d.agentId === MAIN_AGENT_ID || !d.agentId;
      if (!isMain) return; // 子代理内部的工具调用不外发，避免刷屏
      const level = loadClawVerbosity();
      // 简单 / 极简：完全不外发工具通知（只保留文字 / 结论）。
      if (level === "simple" || level === "minimal") return;
      // 只读探查类（查看文件 / 搜索 / 列目录）：仅「详细」档攒着合并汇总；「中等」档不显示只读信息。
      const bucket = readToolBucket(d.toolName, (d.title ?? "").trim());
      if (bucket) {
        if (level === "detailed") this.pendingReads.push(bucket);
        return;
      }
      // 「中等」档只展示文件编辑与终端工具，其余（skill / mcp / fetch 等）不外发。
      if (level === "medium" && !isEditOrShellTool(d.toolName)) return;
      const label = (d.title?.trim() || d.toolName || "").trim();
      if (!label) return;
      this.flushReadBatch();
      // 新建 / 修改文件：直接发文件路径（前面不加任何前缀，过长则省略前面、保留尾部），并带上 +增 -删 行数。
      if (isFileEditTool(d.toolName)) {
        const stat = formatDiffStat(d.content);
        const path = truncatePathHead(label);
        this.enqueueSend(stat ? `${path} ${stat}` : path);
      } else {
        this.enqueueSend(`🔧 ${snippet(label)}`);
      }
    });

    add<InputProcessingData>("input:processing", (d) => {
      const input = (d.originalInput || d.input || "").trim();
      if (!input) return;
      // 手机自己发来的输入已在手机上可见，跳过；其余来源（电脑端 chat）回传给手机，
      // 让两端看到同一段对话。
      if (this.pendingPhoneInput !== null && input === this.pendingPhoneInput) {
        this.pendingPhoneInput = null;
        return;
      }
      // 电脑端用户发的问题始终回传手机，让两端看到同一段对话 —— 不受详略档位影响。
      this.log(`echo desktop input -> phone len=${input.length}`);
      this.enqueueSend(`🖥️ ${input}`);
    });

    add<StateUpdateData>("state:update", (d) => {
      this.log(`state:update -> ${d.state}`);
      // turn 结束：把末尾还攒着的只读探查合并发出（之后无后续输出来触发）。
      if (d.state === "idle") {
        this.flushReadBatch();
        // 极简档：此时把暂存的最后一段（结论）发出。lastMainMessage 仅在极简档被赋值。
        if (this.lastMainMessage) {
          this.enqueueSend(this.lastMainMessage);
          this.lastMainMessage = null;
        }
      }
    });

    add<ToolPermissionRequestData>("tool:permission:request", (d) => {
      this.log(`permission:request tool=${d.toolName} options=${Object.keys(d.options).join("/")}`);
      this.flushReadBatch();
      this.pendingPermission = { toolId: d.toolId, toolName: d.toolName, options: d.options };
      const what = d.title?.trim() || d.toolName;
      this.enqueueSend(permissionPrompt(d.toolName, what));
    });

    add("session:cleared", () => {
      this.log(`session:cleared`);
      this.enqueueSend("已清空上下文。");
    });

    add<CompactExecData>("compact:exec", (d) => {
      this.log(`compact:exec before=${d.tokenBefore} after=${d.tokenCompact} rate=${d.compactRate} err=${d.errMsg ?? ""}`);
      if (d.errMsg && d.errMsg.trim()) {
        this.enqueueSend(`❌ 压缩上下文失败：${d.errMsg}`);
      } else {
        this.enqueueSend("已压缩上下文。");
      }
    });

    // Out of MVP scope, but acknowledge to avoid a silent deadlock.
    add("pick:option:request", () => {
      this.enqueueSend("（远程会话暂不支持选项交互，已跳过）");
    });
    add("plan:exit:request", () => {
      this.enqueueSend("（远程会话暂不支持计划确认，已跳过）");
    });

    add<SessionErrorData>("session:error", (d) => {
      this.log(`session:error type=${d.type} msg=${d.error?.message ?? ""}`);
      this.flushReadBatch();
      this.enqueueSend(`❌ 出错了：${d.error?.message ?? d.type}`);
    });
  }

  private detach(): void {
    const s = this.clawSession.session;
    for (const { event, fn } of this.listeners) s.off(event, fn);
    this.listeners = [];
  }

  // --- inbound routing -------------------------------------------------------

  async onInbound(msg: NormalizedMessage): Promise<void> {
    this.activeReplyCtx = msg.replyCtx;
    // 手机端不便输入斜杠：把自然语言指令映射成 sema-core 原生命令（/clear、/compact）。
    const raw = msg.text.trim();
    const text = COMMAND_ALIASES[raw] ?? raw;
    this.log(`inbound: "${snippet(text)}"${text !== raw ? ` (alias of "${snippet(raw)}")` : ""} (pendingPerm=${!!this.pendingPermission})`);

    if (text === "/cancel") {
      this.clawSession.interrupt();
      this.pendingPermission = null;
      this.lastMainMessage = null;
      this.flushReadBatch();
      this.enqueueSend("已取消当前任务。");
      return;
    }

    if (this.pendingPermission) {
      const low = text.toLowerCase();
      const isYes = YES_TOKENS.has(low);
      const isNo = NO_TOKENS.has(low);
      if (isYes || isNo) {
        const opts = this.pendingPermission.options;
        const selected = isYes
          ? pickKey(opts, ["agree", "allow", "approve", "yes"])
          : pickKey(opts, ["refuse", "reject", "deny", "no"]);
        this.log(`permission answer ${isYes ? "yes" : "no"} -> selected=${selected}`);
        this.clawSession.respondToToolPermission({
          toolId: this.pendingPermission.toolId,
          toolName: this.pendingPermission.toolName,
          selected,
        });
        this.pendingPermission = null;
        // 远程已代为应答 → 关闭 chat 页对应会话的权限弹窗。
        this.onPermissionResolved();
        return; // agent resumes; subsequent message:complete events flush the rest
      }
      this.enqueueSend("请先回复 y / n 确认上一步操作。");
      return;
    }

    // Normal message → new turn. /clear and /compact are handled by sema-core
    // itself inside processUserInput (it emits session:cleared etc.).
    // 标记这条是手机来的，使随后的 input:processing 回响不会被再次发回手机。
    this.pendingPhoneInput = text;
    this.log(`processUserInput -> agent`);
    this.clawSession.processUserInput(text);
  }

  // --- outbound --------------------------------------------------------------

  /** 把攒下的只读探查工具合并成一条中文汇总发出（无则跳过），只报各类总数、不列明细。 */
  private flushReadBatch(): void {
    if (this.pendingReads.length === 0) return;
    const reads = this.pendingReads;
    this.pendingReads = [];
    const files = reads.filter((b) => b === "文件").length;
    const searches = reads.filter((b) => b === "搜索").length;
    const dirs = reads.filter((b) => b === "目录").length;
    const probes = reads.filter((b) => b === "探查").length;
    const parts: string[] = [];
    if (files) parts.push(`读取 ${files} 个文件`);
    if (searches) parts.push(`搜索 ${searches} 次`);
    if (dirs) parts.push(`列出 ${dirs} 个目录`);
    if (probes) parts.push(`探查 ${probes} 次`);
    this.enqueueSend(`🔍 ${parts.join("、")}`);
  }

  /** 按调用顺序串行发送，避免一个 turn 的多条回复在网络上乱序到达。 */
  private enqueueSend(text: string): void {
    this.sendChain = this.sendChain.then(() => this.safeSend(text));
  }

  private async safeSend(text: string): Promise<void> {
    if (!this.activeReplyCtx) {
      this.log("safeSend: no active replyCtx, dropping message");
      return;
    }
    try {
      await this.channel.send({ text, replyCtx: this.activeReplyCtx });
    } catch (e) {
      this.log(`channel.send failed: ${String(e)}`);
    }
  }
}

/**
 * 只读探查类工具归桶，与 webview groupMessages 的可分组工具集合一一对应：
 * 查看文件 → 文件、搜索 → 搜索、ls 列目录 → 目录、find/pwd/探查型 shell → 探查；
 * 其余（写文件 / 其它终端命令等）返回 null，照常单条展示。
 */
function readToolBucket(toolName: string, title: string): "文件" | "搜索" | "目录" | "探查" | null {
  if (toolName === TOOL_NAME_VIEW_FILE) return "文件";
  if (toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT) return "搜索";
  if (toolName === TOOL_NAME_RUN_SHELL) {
    if (isLsCommand(title)) return "目录";
    if (isFindCommand(title) || isPwdCommand(title) || isExploratoryCommand(title)) return "探查";
  }
  return null;
}

/** 文件编辑类工具：新建 / 修改文件 / 改 notebook。 */
function isFileEditTool(toolName: string): boolean {
  return (
    toolName === TOOL_NAME_WRITE_FILE ||
    toolName === TOOL_NAME_PATCH_FILE ||
    toolName === TOOL_NAME_EDIT_NOTEBOOK
  );
}

/** 「中等」档放行的工具：文件编辑与终端命令。 */
function isEditOrShellTool(toolName: string): boolean {
  return isFileEditTool(toolName) || toolName === TOOL_NAME_RUN_SHELL;
}

/**
 * 从工具的 diff content 统计 +增 -删 行数，格式如 "+12 -2" / "+12" / ""（无变更或非 diff 结构）。
 * 与 webview 的 countDiffChanges 同源：type 为 "new" 时用 hunk.newLines，否则按行首 +/- 计数。
 */
function formatDiffStat(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as { type?: string; patch?: Array<{ newLines?: number; lines?: string[] }> };
  if (!Array.isArray(c.patch)) return "";
  let added = 0;
  let removed = 0;
  if (c.type === "new") {
    for (const h of c.patch) added += h.newLines ?? 0;
  } else {
    for (const h of c.patch) {
      for (const line of h.lines ?? []) {
        if (line.startsWith("+")) added++;
        else if (line.startsWith("-")) removed++;
      }
    }
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  return parts.join(" ");
}

// 以下 shell 探查判定与 webview groupMessages.ts 中的同名谓词保持一致，
// 确保「发往手机的读查组」与页面 GroupedToolBlock 的可分组工具集合不漏、不错位。

/** title 形如 `cd a && cd b && ls foo`：跳过开头的 cd 段后剩余命令以 ls 开头即视为列目录。 */
function isLsCommand(title: string): boolean {
  const segs = title.trim().split(/\s+&&\s+/).map((s) => s.trim()).filter(Boolean);
  let i = 0;
  while (i < segs.length - 1 && /^cd(?:\s|$)/.test(segs[i])) i++;
  return /^ls(?:\s|$)/.test(segs[i] ?? "");
}

/** find 查找（排除带 -delete/-exec 等副作用的破坏性用法）。 */
function isFindCommand(title: string): boolean {
  const c = title.trim();
  if (!/^find(?:\s|$)/.test(c)) return false;
  return !/(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(c);
}

/** pwd 打印工作目录（仅允许 -L/-P 选项）。 */
function isPwdCommand(title: string): boolean {
  return /^pwd(?:\s+-(?:L|P))*\s*$/.test(title.trim());
}

/** 由 && 串起的多段命令，且每段都是 ls / find / pwd —— 纯探查链。 */
function isExploratoryCommand(title: string): boolean {
  const segs = title.trim().split(/\s+&&\s+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return false;
  return segs.every((s) => isLsCommand(s) || isFindCommand(s) || isPwdCommand(s));
}

/** 按工具类型给出区分化的权限询问文案（文件编辑 / 终端 / Skill / MCP / Fetch / 其它）。 */
function permissionPrompt(toolName: string, what: string): string {
  let head: string;
  if (
    toolName === TOOL_NAME_WRITE_FILE ||
    toolName === TOOL_NAME_PATCH_FILE ||
    toolName === TOOL_NAME_EDIT_NOTEBOOK
  ) {
    head = `📝 是否允许修改文件：${what}？`;
  } else if (toolName === TOOL_NAME_RUN_SHELL) {
    head = `💻 是否允许执行终端命令：${what}？`;
  } else if (toolName === TOOL_NAME_SKILL) {
    head = `🧩 是否允许运行 Skill：${what}？`;
  } else if (toolName.startsWith("mcp__")) {
    head = `🔌 是否允许调用 MCP 工具：${what}？`;
  } else if (toolName === TOOL_NAME_FETCH_URL) {
    head = `🌐 是否允许访问网页：${what}？`;
  } else {
    head = `⚠️ 是否允许执行：${what}？`;
  }
  return `${head}\n回复 y 允许（仅此次） / n 拒绝`;
}

/** Pick the first present option key from a preference list, else first key. */
function pickKey(options: Record<string, string>, preferred: string[]): string {
  for (const k of preferred) {
    if (k in options) return k;
  }
  return Object.keys(options)[0] ?? "agree";
}
