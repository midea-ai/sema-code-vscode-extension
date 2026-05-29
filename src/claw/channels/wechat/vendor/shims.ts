/**
 * Shims replacing the OpenClaw-SDK / accounts couplings of the lifted
 * openclaw-weixin protocol layer (api.ts, login-qr.ts). These let the pure
 * protocol code run standalone inside the VS Code extension.
 *
 * - logger:      a minimal Logger backed by console (level-gated).
 * - config:      loadConfigBotAgent / loadConfigRouteTag (our own values).
 * - accounts:    list/load/save/register bot credentials. In Phase 1 these are
 *                stubs; Phase 4 wires them to credentials-store.ts.
 */

/** Fixed iLink bot API base URL (mirrors accounts.DEFAULT_BASE_URL). */
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

/** CDN base (not used by the text MVP, kept for parity). */
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

// ---------------------------------------------------------------------------
// logger
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error" | "none";
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: Exclude<LogLevel, "none">): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  withAccount(accountId: string): Logger;
  getLogFilePath(): string;
  close(): void;
}

function makeLogger(prefix: string): Logger {
  const tag = prefix ? `[claw:wechat ${prefix}]` : "[claw:wechat]";
  return {
    debug: (m) => { if (shouldLog("debug")) console.debug(`${tag} ${m}`); },
    info: (m) => { if (shouldLog("info")) console.log(`${tag} ${m}`); },
    warn: (m) => { if (shouldLog("warn")) console.warn(`${tag} ${m}`); },
    error: (m) => { if (shouldLog("error")) console.error(`${tag} ${m}`); },
    withAccount: (accountId: string) => makeLogger(accountId),
    getLogFilePath: () => "",
    close: () => {},
  };
}

export const logger: Logger = makeLogger("");

// ---------------------------------------------------------------------------
// config getters (api.ts buildBaseInfo / headers)
// ---------------------------------------------------------------------------

/** Self-declared bot agent (UA-style), for backend observability only. */
export function loadConfigBotAgent(): string | undefined {
  return "SemaClaw/1.0";
}

/** Optional SKRouteTag header for routing; unused by us. */
export function loadConfigRouteTag(): string | undefined {
  return undefined;
}

// ---------------------------------------------------------------------------
// account storage (login-qr.ts getLocalBotTokenList) — backed by our
// credentials-store. login-qr only reads (list/load); the save-on-confirm path
// lives in qr.ts.
// ---------------------------------------------------------------------------

import { listAccountIds, loadCredentials, saveCredentials } from "../../../credentials-store";

export interface WeixinAccountData {
  token?: string;
  baseUrl?: string;
  userId?: string;
  savedAt?: string;
}

export function listIndexedWeixinAccountIds(): string[] {
  return listAccountIds();
}

export function loadWeixinAccount(accountId: string): WeixinAccountData | null {
  const c = loadCredentials(accountId);
  return c ? { token: c.token, baseUrl: c.baseUrl, userId: c.userId, savedAt: c.savedAt } : null;
}

export function saveWeixinAccount(accountId: string, update: { token?: string; baseUrl?: string; userId?: string }): void {
  if (!update.token) return;
  saveCredentials({
    accountId,
    token: update.token,
    baseUrl: update.baseUrl ?? DEFAULT_BASE_URL,
    userId: update.userId,
  });
}

export function registerWeixinAccountId(_accountId: string): void {
  // saveCredentials already maintains the index; nothing else to do.
}
