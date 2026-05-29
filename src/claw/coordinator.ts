/**
 * Always-loaded, ultra-thin coordinator. Holds only the enabled flag + a
 * reference to the lazily-loaded runtime, and does lightweight fs reads for
 * `bound` status. The heavy runtime (and `qrcode`) is pulled in via dynamic
 * `import('./index')` only on enable() / startBind() — idle users pay nothing.
 *
 * Its static deps are limited to credentials-store (fs) + paths; the type-only
 * import of ClawModule is erased and does NOT load the chunk.
 */
import {
  clearCredentials,
  getActivePlatform,
  isBound,
  loadActiveClawCreds,
  saveFeishuCredentials,
  type ClawPlatform,
} from "./credentials-store";
import { loadClawVerbosity, saveClawVerbosity, type ClawVerbosity } from "./settings";
import type { ClawModule, ClawSessionHooks } from "./index";
import type { SemaProcessWrapper } from "../core/semaProcessWrapper";

export interface ClawStatus {
  bound: boolean;
  enabled: boolean;
  /** 当前绑定的远程平台（微信 / 飞书，二选一）；未绑定为 null。 */
  platform: ClawPlatform | null;
  /** 信息显示详略档位（发回手机端的内容多少）。 */
  verbosity: ClawVerbosity;
}

export interface ClawEnableResult {
  ok: boolean;
  error?: string;
  occupiedBy?: { projectPath: string };
}

export interface BindEventHandlers {
  onVerifyCodeNeeded: () => void;
  onQrRefresh: (qrcodeDataUrl: string) => void;
  onResult: (r: { connected: boolean; accountId?: string; message: string }) => void;
}

export class ClawCoordinator {
  private runtime: ClawModule | null = null;
  private enabled = false;
  private pendingVerifyResolve: ((code: string) => void) | null = null;

  constructor(
    private readonly processWrapper: SemaProcessWrapper,
    private readonly workingDir: string,
    private readonly log: (m: string) => void = () => {},
    private readonly sessionHooks: ClawSessionHooks = {},
  ) {}

  getStatus(): ClawStatus {
    return {
      bound: isBound(),
      enabled: this.enabled,
      platform: getActivePlatform(),
      verbosity: loadClawVerbosity(),
    };
  }

  /** 绑定飞书：存 appId/appSecret 并把活跃平台切到飞书（纯 fs，不触发懒载重 chunk）。 */
  bindFeishu(appId: string, appSecret: string): void {
    saveFeishuCredentials({ appId, appSecret });
  }

  /** 读/写信息显示详略档（纯 fs，不触发懒载重 chunk；运行中的 bridge 下次取用即生效）。 */
  getVerbosity(): ClawVerbosity {
    return loadClawVerbosity();
  }

  setVerbosity(level: ClawVerbosity): void {
    saveClawVerbosity(level);
  }

  async enable(): Promise<ClawEnableResult> {
    if (this.enabled) return { ok: true };
    const creds = loadActiveClawCreds();
    if (!creds) return { ok: false, error: "未绑定，请先绑定微信或飞书" };

    const mod = await import("./index.js"); // lazy: loads the heavy chunk
    const runtime = new mod.ClawModule(this.processWrapper, this.workingDir, this.log, this.sessionHooks);
    this.runtime = runtime;
    const res = await runtime.enable(creds);
    if (res.ok) {
      this.enabled = true;
      return { ok: true };
    }
    this.runtime = null;
    return { ok: false, error: res.error, occupiedBy: res.occupiedBy };
  }

  async disable(): Promise<void> {
    if (this.runtime) {
      await this.runtime.disable();
      this.runtime = null;
    }
    this.enabled = false;
  }

  /** Window close / reload. No-op (beyond enabled=false) if never enabled. */
  async dispose(): Promise<void> {
    await this.disable();
  }

  /** 电脑端 chat 应答了 claw 会话的权限：清 bridge 待确认状态并把结果回传手机。 */
  notifyDesktopPermissionAnswered(selected?: string): void {
    this.runtime?.onDesktopPermissionAnswered(selected);
  }

  // --- bind flow (lazy) ------------------------------------------------------

  async startBind(): Promise<{ qrcodeDataUrl?: string; message: string; sessionKey: string }> {
    const mod = await import("./index.js");
    const r = await mod.startBind();
    return { qrcodeDataUrl: r.qrcodeDataUrl, message: r.message, sessionKey: r.sessionKey };
  }

  /** Drives the long-poll bind; reports verify-code prompt / refresh / result. */
  async waitBind(sessionKey: string, handlers: BindEventHandlers): Promise<void> {
    const mod = await import("./index.js");
    const result = await mod.waitBind(sessionKey, {
      getVerifyCode: () =>
        new Promise<string>((resolve) => {
          this.pendingVerifyResolve = resolve;
          handlers.onVerifyCodeNeeded();
        }),
      onQrRefresh: (dataUrl: string) => handlers.onQrRefresh(dataUrl),
    });
    this.pendingVerifyResolve = null;
    handlers.onResult({ connected: result.connected, accountId: result.accountId, message: result.message });
  }

  submitVerifyCode(code: string): void {
    if (this.pendingVerifyResolve) {
      this.pendingVerifyResolve(code);
      this.pendingVerifyResolve = null;
    }
  }

  unbind(): void {
    clearCredentials();
  }
}
