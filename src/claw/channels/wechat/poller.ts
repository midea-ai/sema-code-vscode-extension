/**
 * Long-poll loop driving getUpdates (rewrite of openclaw-weixin monitor.ts,
 * without the OpenClaw SDK). Runs until the abort signal fires.
 *
 * getUpdates itself swallows client-side long-poll timeouts (returns an empty
 * ret=0 response), so a normal idle poll just loops. We only back off on real
 * errors and stop on session-expired (errcode -14).
 */
import { getUpdates } from "./vendor/api";
import type { GetUpdatesResp, WeixinMessage } from "./vendor/types";

const RETRY_DELAY_MS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const SESSION_EXPIRED_ERRCODE = -14;

export interface PollerOpts {
  baseUrl: string;
  token: string;
  abortSignal: AbortSignal;
  initialCursor?: string;
  onMessage: (msg: WeixinMessage) => void;
  onCursor?: (cursor: string) => void;
  /** Called when the server reports the bot session expired (-14). */
  onSessionExpired?: () => void;
  log?: (m: string) => void;
}

export async function runPoller(opts: PollerOpts): Promise<void> {
  const log = opts.log ?? (() => {});
  let cursor = opts.initialCursor ?? "";
  let failures = 0;

  while (!opts.abortSignal.aborted) {
    let resp: GetUpdatesResp;
    try {
      resp = await getUpdates({
        baseUrl: opts.baseUrl,
        token: opts.token,
        get_updates_buf: cursor,
        abortSignal: opts.abortSignal,
      });
    } catch (err) {
      if (opts.abortSignal.aborted) break;
      failures += 1;
      log(`getUpdates failed (#${failures}): ${String(err)}`);
      await sleep(failures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, opts.abortSignal);
      continue;
    }
    if (opts.abortSignal.aborted) break;
    failures = 0;

    if (resp.errcode !== undefined && resp.errcode !== 0) {
      log(`getUpdates errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`);
    }
    if (resp.errcode === SESSION_EXPIRED_ERRCODE) {
      // -14 = bot session expired. Do NOT permanently stop — back off briefly
      // and keep polling so a transient expiry self-recovers.
      log(`session expired (errcode -14); backing off and retrying`);
      opts.onSessionExpired?.();
      await sleep(RETRY_DELAY_MS, opts.abortSignal);
      continue;
    }

    if (resp.get_updates_buf !== undefined && resp.get_updates_buf !== cursor) {
      cursor = resp.get_updates_buf;
      opts.onCursor?.(cursor);
    }

    const msgs = resp.msgs ?? [];
    if (msgs.length > 0) {
      log(`getUpdates: ${msgs.length} message(s) received`);
    }
    for (const msg of msgs) {
      try {
        opts.onMessage(msg);
      } catch (e) {
        log(`onMessage handler error: ${String(e)}`);
      }
    }
  }
}

/** Abortable sleep. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
