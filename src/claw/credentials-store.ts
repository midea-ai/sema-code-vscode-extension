/**
 * Claw 远程凭证存储（~/.sema/claw/，mode 0600）。
 *
 * 远程同一时刻只有一个活着，微信 / 飞书二选一：
 *   - 微信：credentials/ 下按账号存（保留 index 列表给 vendor login-qr 复用）。
 *   - 飞书：feishu.json 存 appId / appSecret。
 *   - active.json 记当前绑定的是哪个平台；绑定其一即把 active 切过去。
 * isBound / loadActiveClawCreds 都按 active 平台解析，对上层屏蔽平台差异。
 */
import fs from "node:fs";
import path from "node:path";

import {
  activePlatformPath,
  credentialsDir,
  credentialsIndexPath,
  feishuCredentialsPath,
} from "./paths";
import type { ClawCreds, FeishuCreds } from "./channels/types";

export type ClawPlatform = "wechat" | "feishu";

export interface StoredCredentials {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
}

function safeReadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson600(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
}

// --- active platform -------------------------------------------------------

/** 当前绑定的远程平台；无 active 标记时，若已有微信凭证则回退 'wechat'（兼容老用户）。 */
export function getActivePlatform(): ClawPlatform | null {
  const v = safeReadJson<{ platform?: ClawPlatform }>(activePlatformPath());
  if (v?.platform === "wechat" || v?.platform === "feishu") return v.platform;
  return listAccountIds().length > 0 ? "wechat" : null;
}

export function setActivePlatform(p: ClawPlatform): void {
  writeJson600(activePlatformPath(), { platform: p });
}

function clearActivePlatform(): void {
  try {
    fs.rmSync(activePlatformPath(), { force: true });
  } catch {
    /* ignore */
  }
}

// --- WeChat ----------------------------------------------------------------

/** Filesystem-safe filename for an accountId like `hex@im.bot`. */
function credFile(accountId: string): string {
  return path.join(credentialsDir(), `${accountId.replace(/[^A-Za-z0-9._-]/g, "-")}.json`);
}

export function listAccountIds(): string[] {
  return safeReadJson<string[]>(credentialsIndexPath()) ?? [];
}

export function loadCredentials(accountId: string): StoredCredentials | null {
  return safeReadJson<StoredCredentials>(credFile(accountId));
}

/** The most recently bound WeChat account (single-account MVP). */
export function loadActiveCredentials(): StoredCredentials | null {
  const ids = listAccountIds();
  return ids.length > 0 ? loadCredentials(ids[ids.length - 1]) : null;
}

export function saveCredentials(c: {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
}): void {
  const data: StoredCredentials = { ...c, savedAt: new Date().toISOString() };
  writeJson600(credFile(c.accountId), data);
  const ids = listAccountIds();
  if (!ids.includes(c.accountId)) {
    ids.push(c.accountId);
    writeJson600(credentialsIndexPath(), ids);
  }
  // 绑定微信即把活跃平台切到微信（覆盖之前可能绑定的飞书）。
  setActivePlatform("wechat");
}

// --- Feishu ----------------------------------------------------------------

export function saveFeishuCredentials(c: { appId: string; appSecret: string }): void {
  writeJson600(feishuCredentialsPath(), { ...c, savedAt: new Date().toISOString() });
  setActivePlatform("feishu");
}

export function loadFeishuCredentials(): FeishuCreds | null {
  const c = safeReadJson<{ appId?: string; appSecret?: string }>(feishuCredentialsPath());
  if (!c?.appId || !c?.appSecret) return null;
  return { platform: "feishu", appId: c.appId, appSecret: c.appSecret };
}

// --- unified ---------------------------------------------------------------

/** 是否已绑定任一平台。 */
export function isBound(): boolean {
  return loadActiveClawCreds() !== null;
}

/** 按当前活跃平台解析出可直接交给 createChannel 的凭证。 */
export function loadActiveClawCreds(): ClawCreds | null {
  const platform = getActivePlatform();
  if (platform === "feishu") {
    return loadFeishuCredentials();
  }
  if (platform === "wechat") {
    const w = loadActiveCredentials();
    return w
      ? { platform: "wechat", accountId: w.accountId, token: w.token, baseUrl: w.baseUrl, userId: w.userId }
      : null;
  }
  return null;
}

/** 解绑当前活跃平台的凭证并清掉 active 标记。 */
export function clearCredentials(): void {
  if (getActivePlatform() === "feishu") {
    try {
      fs.rmSync(feishuCredentialsPath(), { force: true });
    } catch {
      /* ignore */
    }
  } else {
    for (const id of listAccountIds()) {
      try {
        fs.rmSync(credFile(id), { force: true });
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(credentialsIndexPath(), { force: true });
    } catch {
      /* ignore */
    }
  }
  clearActivePlatform();
}
