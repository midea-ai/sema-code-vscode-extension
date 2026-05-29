/**
 * Cross-window single-instance lock for claw.
 *
 * Only one VS Code window may run the claw runtime at a time. We use an atomic
 * exclusive file create (`wx`) on `~/.sema/claw/owner.lock`. If the lock exists
 * and its pid is still alive, the claim fails (caller shows "in use by project
 * X"). If the holder's pid is dead (crash left a stale lock), we take over.
 */
import crypto from "node:crypto";
import fs from "node:fs";

import { clawDir, ownerLockPath } from "./paths";

export interface LockInfo {
  instanceId: string;
  pid: number;
  projectPath: string;
  since: number;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; heldBy: { projectPath: string; pid: number } };

/** `process.kill(pid, 0)`: EPERM => alive (other user), ESRCH => dead. */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** Read the current live lock holder, or null if absent/stale. */
export function peekOwnerLock(): LockInfo | null {
  const info = readLockFile();
  if (!info) return null;
  return isPidAlive(info.pid) ? info : null;
}

function readLockFile(): LockInfo | null {
  try {
    return JSON.parse(fs.readFileSync(ownerLockPath(), "utf-8")) as LockInfo;
  } catch {
    return null;
  }
}

export class OwnerLock {
  private readonly instanceId = crypto.randomUUID();

  constructor(private readonly projectPath: string) {}

  /** Atomically claim the lock; takes over a stale (dead-pid) lock. */
  claim(): ClaimResult {
    fs.mkdirSync(clawDir(), { recursive: true });
    const info: LockInfo = {
      instanceId: this.instanceId,
      pid: process.pid,
      projectPath: this.projectPath,
      since: Date.now(),
    };

    const first = this.tryWrite(info);
    if (first.ok) return { ok: true };
    if (first.held) return { ok: false, heldBy: first.held };

    // Stale lock (dead pid / our own leftover): remove and retry once.
    try {
      fs.unlinkSync(ownerLockPath());
    } catch {
      /* someone else may have just removed it */
    }
    const second = this.tryWrite(info);
    if (second.ok) return { ok: true };
    if (second.held) return { ok: false, heldBy: second.held };
    // Raced and lost to a live holder we couldn't read; report generic busy.
    return { ok: false, heldBy: { projectPath: "未知项目", pid: 0 } };
  }

  /**
   * Attempt one exclusive create. Returns ok on success; held={...} when a
   * LIVE holder occupies it; neither when the existing lock is stale (caller
   * should remove + retry).
   */
  private tryWrite(info: LockInfo): { ok: true } | { ok: false; held?: { projectPath: string; pid: number } } {
    let fd: number;
    try {
      fd = fs.openSync(ownerLockPath(), "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      const existing = readLockFile();
      if (existing) {
        if (existing.instanceId === this.instanceId) return { ok: true }; // already ours (idempotent)
        if (isPidAlive(existing.pid)) {
          return { ok: false, held: { projectPath: existing.projectPath, pid: existing.pid } };
        }
      }
      return { ok: false }; // stale / unreadable → caller removes and retries
    }
    try {
      fs.writeSync(fd, JSON.stringify(info));
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true };
  }

  /** Release only if we still own it (don't clobber a successor's takeover). */
  release(): void {
    const existing = readLockFile();
    if (existing && existing.instanceId === this.instanceId) {
      try {
        fs.unlinkSync(ownerLockPath());
      } catch {
        /* already gone */
      }
    }
  }

  get id(): string {
    return this.instanceId;
  }
}
