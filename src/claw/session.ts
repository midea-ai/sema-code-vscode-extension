/**
 * The single claw agent session: a fixed-id session ('__claw__') multiplexed
 * onto the window's existing SemaCore (via SemaProcessWrapper) — NOT a second
 * SemaCore. Permission level 'Ask' so risky tools still prompt (over WeChat).
 *
 * /clear and /compact are NOT handled here — they are native sema-core commands
 * routed through processUserInput by the bridge, and core resolves which
 * history file to load from the bare sessionId.
 */
import type { SemaSession } from "sema-core";
import type { ToolPermissionResponse } from "sema-core/event";

import type { SemaProcessWrapper } from "../core/semaProcessWrapper";
import { CLAW_SESSION_ID } from "./paths";

export class ClawSession {
  private constructor(
    public readonly session: SemaSession,
    private readonly processWrapper: SemaProcessWrapper,
  ) {}

  static async open(processWrapper: SemaProcessWrapper): Promise<ClawSession> {
    const result = await processWrapper.createSession({
      sessionId: CLAW_SESSION_ID,
      permissionLevel: "Ask",
    });
    if (!result.ok) {
      throw new Error(`claw 会话创建失败：${result.error}`);
    }
    return new ClawSession(result.session, processWrapper);
  }

  processUserInput(text: string): void {
    this.session.processUserInput(text);
  }

  interrupt(): void {
    this.session.interrupt();
  }

  respondToToolPermission(response: ToolPermissionResponse): boolean {
    return this.session.respondToToolPermission(response);
  }

  dispose(): void {
    this.processWrapper.closeSession(CLAW_SESSION_ID);
  }
}
