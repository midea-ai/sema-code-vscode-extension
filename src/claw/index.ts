/**
 * Lazy chunk entry. Everything heavy (owner-lock, session, bridge, channel,
 * vendor protocol, qrcode) lives behind this module, which the always-loaded
 * ClawCoordinator pulls in via `await import('./index')` only when the user
 * binds or enables claw. Idle users never load it.
 */
import type { SemaSession } from "sema-core";

import { createChannel } from "./channels";
import type { ChannelAdapter, ClawCreds } from "./channels/types";
import { ClawBridge } from "./bridge";
import { OwnerLock } from "./owner-lock";
import { ClawSession } from "./session";
import type { SemaProcessWrapper } from "../core/semaProcessWrapper";

export { startBind, waitBind } from "./channels/wechat/qr";
export type { QrStart, WaitBindCallbacks } from "./channels/wechat/qr";

export interface ModuleEnableResult {
  ok: boolean;
  error?: string;
  occupiedBy?: { projectPath: string };
}

/**
 * 让宿主（SemaSidebarProvider）把 claw 会话以 UI tab 形式接入聊天界面。
 * attach 携带已创建的 SemaSession，宿主据此包一个 SemaSessionWrapper 显示出来；
 * detach 在会话销毁前触发，宿主据此移除 tab。
 */
export interface ClawSessionHooks {
  onSessionAttach?: (session: SemaSession) => void;
  onSessionDetach?: (sessionId: string) => void;
  /** 远程应答权限后触发，宿主据此关闭 chat 页对应会话的权限弹窗。 */
  onPermissionResolved?: (sessionId: string) => void;
}

export class ClawModule {
  private readonly lock: OwnerLock;
  private clawSession?: ClawSession;
  private bridge?: ClawBridge;
  private channel?: ChannelAdapter;
  private running = false;

  constructor(
    private readonly processWrapper: SemaProcessWrapper,
    private readonly workingDir: string,
    private readonly log: (m: string) => void = () => {},
    private readonly hooks: ClawSessionHooks = {},
  ) {
    this.lock = new OwnerLock(workingDir);
  }

  async enable(creds: ClawCreds): Promise<ModuleEnableResult> {
    if (this.running) return { ok: true };

    const claim = this.lock.claim();
    if (!claim.ok) {
      return { ok: false, occupiedBy: { projectPath: claim.heldBy.projectPath } };
    }

    try {
      this.clawSession = await ClawSession.open(this.processWrapper);
      // 让聊天界面以普通 tab 形式显示这个远程会话（与 bridge 发回微信互不干扰）。
      this.hooks.onSessionAttach?.(this.clawSession.session);
      this.channel = createChannel(creds, this.log);
      this.bridge = new ClawBridge(this.clawSession, this.channel, this.log, () => {
        if (this.clawSession) this.hooks.onPermissionResolved?.(this.clawSession.session.sessionId);
      });
      this.bridge.start();
      await this.channel.start((m) => {
        this.bridge!.onInbound(m).catch((e) => this.log(`onInbound error: ${String(e)}`));
      });
      this.running = true;
      return { ok: true };
    } catch (e) {
      await this.teardown();
      this.lock.release();
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async disable(): Promise<void> {
    await this.teardown();
    this.lock.release();
    this.running = false;
  }

  /** 转发"电脑端已应答权限"给 bridge：清待确认状态并回传结果给手机。 */
  onDesktopPermissionAnswered(selected?: string): void {
    this.bridge?.onDesktopPermissionAnswered(selected);
  }

  private async teardown(): Promise<void> {
    try {
      await this.channel?.stop();
    } catch (e) {
      this.log(`channel.stop error: ${String(e)}`);
    }
    this.bridge?.dispose();
    if (this.clawSession) {
      this.hooks.onSessionDetach?.(this.clawSession.session.sessionId);
    }
    this.clawSession?.dispose();
    this.channel = undefined;
    this.bridge = undefined;
    this.clawSession = undefined;
  }
}
