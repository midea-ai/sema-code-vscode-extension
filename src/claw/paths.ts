/**
 * Filesystem paths for the claw module's own state under ~/.sema/claw.
 *
 * We honor the SEMA_ROOT env override the same way sema-core does, so claw's
 * state sits next to sema-core's. We do NOT replicate sema-core's history file
 * naming: loading the claw session is done by passing the bare sessionId
 * ('__claw__') to createSession, and /clear is a native core command — core
 * resolves the actual (date-prefixed) history file itself.
 */
import os from "node:os";
import path from "node:path";

/** Fixed sessionId for the single claw agent session. */
export const CLAW_SESSION_ID = "__claw__";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

/** ~/.sema (or $SEMA_ROOT). Mirrors sema-core getSemaRootDir(). */
export function getSemaRootDir(): string {
  const custom = process.env.SEMA_ROOT;
  return custom ? path.resolve(custom) : expandHome("~/.sema");
}

/** ~/.sema/claw — claw's own state dir (lock, credentials, cursors). */
export function clawDir(): string {
  return path.join(getSemaRootDir(), "claw");
}

export function ownerLockPath(): string {
  return path.join(clawDir(), "owner.lock");
}

export function credentialsDir(): string {
  return path.join(clawDir(), "credentials");
}

/** ~/.sema/claw/settings.json — claw 自身的轻量偏好（如信息显示详略档位）。 */
export function clawSettingsPath(): string {
  return path.join(clawDir(), "settings.json");
}

export function credentialsIndexPath(): string {
  return path.join(credentialsDir(), "index.json");
}

/** ~/.sema/claw/feishu.json — 飞书应用凭证（appId / appSecret）。 */
export function feishuCredentialsPath(): string {
  return path.join(clawDir(), "feishu.json");
}

/** ~/.sema/claw/active.json — 当前绑定的远程平台（wechat / feishu，二选一）。 */
export function activePlatformPath(): string {
  return path.join(clawDir(), "active.json");
}

export function cursorsDir(): string {
  return path.join(clawDir(), "cursors");
}
