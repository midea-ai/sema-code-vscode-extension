/**
 * WeChat QR login (official iLink bot 扫码授权). Lifted from
 * @tencent-weixin/openclaw-weixin (src/auth/login-qr.ts) and adapted for a
 * webview-driven flow:
 *   - terminal display / stdin verify-code reads replaced with injectable
 *     callbacks (`onQrRefresh`, `getVerifyCode`, `onStatus`);
 *   - imports repointed to local api / shims / redact.
 *
 * `startWeixinLoginWithQr` returns the QR payload string (to be rendered) and a
 * sessionKey; `waitForWeixinLogin` long-polls and resolves with the bot token
 * on confirmation.
 */
import { randomUUID } from "node:crypto";

import { apiGetFetch, apiPostFetch } from "./api";
import { listIndexedWeixinAccountIds, loadWeixinAccount, logger } from "./shims";
import { redactToken } from "./redact";

type LoginStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

type ActiveLogin = {
  sessionKey: string;
  id: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  botToken?: string;
  status?: LoginStatus;
  currentApiBaseUrl?: string;
  pendingVerifyCode?: string;
};

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

/** Default `bot_type` for ilink get_bot_qrcode / get_qrcode_status. */
export const DEFAULT_ILINK_BOT_TYPE = "3";

/** Fixed API base URL for all QR code requests. */
const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";

const activeLogins = new Map<string, ActiveLogin>();

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: LoginStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(id);
  }
}

/** Local bot token list (most recent 10) sent with the QR fetch. */
function getLocalBotTokenList(): string[] {
  const accountIds = listIndexedWeixinAccountIds();
  const tokens: string[] = [];
  for (let i = accountIds.length - 1; i >= 0 && tokens.length < 10; i--) {
    const token = loadWeixinAccount(accountIds[i])?.token?.trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  const localTokenList = getLocalBotTokenList();
  logger.info(`fetchQRCode: local_token_list count=${localTokenList.length}`);
  const rawText = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: localTokenList }),
    label: "fetchQRCode",
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string, verifyCode?: string): Promise<StatusResponse> {
  try {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    const rawText = await apiGetFetch({
      baseUrl: apiBaseUrl,
      endpoint,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
    });
    return JSON.parse(rawText) as StatusResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    logger.warn(`pollQRStatus: network/gateway error, will retry: ${String(err)}`);
    return { status: "wait" };
  }
}

export type WeixinQrStartResult = {
  qrcodeUrl?: string;
  message: string;
  sessionKey: string;
};

export type WeixinQrWaitResult = {
  connected: boolean;
  alreadyConnected?: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
};

export async function startWeixinLoginWithQr(opts: {
  force?: boolean;
  accountId?: string;
  botType?: string;
}): Promise<WeixinQrStartResult> {
  const sessionKey = opts.accountId || randomUUID();
  purgeExpiredLogins();

  const existing = activeLogins.get(sessionKey);
  if (!opts.force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return { qrcodeUrl: existing.qrcodeUrl, message: "二维码已生成，请用微信扫描。", sessionKey };
  }

  try {
    const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE;
    const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
    logger.info(`QR code received, qrcode=${redactToken(qrResponse.qrcode)}`);

    const login: ActiveLogin = {
      sessionKey,
      id: randomUUID(),
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    };
    activeLogins.set(sessionKey, login);

    return { qrcodeUrl: qrResponse.qrcode_img_content, message: "用微信扫描二维码以继续连接。", sessionKey };
  } catch (err) {
    logger.error(`Failed to start Weixin login: ${String(err)}`);
    return { message: `发起登录失败：${String(err)}`, sessionKey };
  }
}

const MAX_QR_REFRESH_COUNT = 3;

async function refreshQRCode(
  activeLogin: ActiveLogin,
  botType: string,
  onQrRefresh?: (qrcodeUrl: string) => void,
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
    activeLogin.qrcode = qrResponse.qrcode;
    activeLogin.qrcodeUrl = qrResponse.qrcode_img_content;
    activeLogin.startedAt = Date.now();
    onQrRefresh?.(qrResponse.qrcode_img_content);
    return { success: true };
  } catch (refreshErr) {
    logger.error(`refreshQRCode failed: ${String(refreshErr)}`);
    return { success: false, message: `刷新二维码失败：${String(refreshErr)}` };
  }
}

export async function waitForWeixinLogin(opts: {
  sessionKey: string;
  timeoutMs?: number;
  botType?: string;
  /** Webview-driven verify-code input; isRetry=true means the prior code was wrong. */
  getVerifyCode?: (isRetry: boolean) => Promise<string>;
  /** Called with a fresh QR payload when the previous one expired and was refreshed. */
  onQrRefresh?: (qrcodeUrl: string) => void;
  /** Optional status ticks (e.g. "scaned") for UI feedback. */
  onStatus?: (status: LoginStatus) => void;
}): Promise<WeixinQrWaitResult> {
  const activeLogin = activeLogins.get(opts.sessionKey);
  if (!activeLogin) {
    return { connected: false, message: "当前没有进行中的登录，请先发起扫码。" };
  }
  if (!isLoginFresh(activeLogin)) {
    activeLogins.delete(opts.sessionKey);
    return { connected: false, message: "二维码已过期，请重新生成。" };
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000);
  const deadline = Date.now() + timeoutMs;
  let qrRefreshCount = 1;
  activeLogin.currentApiBaseUrl = FIXED_BASE_URL;

  while (Date.now() < deadline) {
    let statusResponse: StatusResponse;
    try {
      const currentBaseUrl = activeLogin.currentApiBaseUrl ?? FIXED_BASE_URL;
      statusResponse = await pollQRStatus(currentBaseUrl, activeLogin.qrcode, activeLogin.pendingVerifyCode);
    } catch (err) {
      activeLogins.delete(opts.sessionKey);
      return { connected: false, message: `登录失败：${String(err)}` };
    }

    activeLogin.status = statusResponse.status;
    opts.onStatus?.(statusResponse.status);

    switch (statusResponse.status) {
      case "wait":
        break;
      case "scaned":
        if (activeLogin.pendingVerifyCode) activeLogin.pendingVerifyCode = undefined;
        break;
      case "need_verifycode": {
        if (!opts.getVerifyCode) {
          activeLogins.delete(opts.sessionKey);
          return { connected: false, message: "需要输入验证码，但未提供输入通道。" };
        }
        const code = await opts.getVerifyCode(Boolean(activeLogin.pendingVerifyCode));
        activeLogin.pendingVerifyCode = code;
        continue; // poll again immediately with the code
      }
      case "expired": {
        qrRefreshCount += 1;
        if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
          activeLogins.delete(opts.sessionKey);
          return { connected: false, message: "二维码多次失效，连接流程已停止。请稍后再试。" };
        }
        const r = await refreshQRCode(activeLogin, opts.botType || DEFAULT_ILINK_BOT_TYPE, opts.onQrRefresh);
        if (!r.success) {
          activeLogins.delete(opts.sessionKey);
          return { connected: false, message: r.message };
        }
        break;
      }
      case "verify_code_blocked": {
        activeLogin.pendingVerifyCode = undefined;
        qrRefreshCount += 1;
        if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
          activeLogins.delete(opts.sessionKey);
          return { connected: false, message: "多次输入错误，连接流程已停止。请稍后再试。" };
        }
        const r = await refreshQRCode(activeLogin, opts.botType || DEFAULT_ILINK_BOT_TYPE, opts.onQrRefresh);
        if (!r.success) {
          activeLogins.delete(opts.sessionKey);
          return { connected: false, message: r.message };
        }
        break;
      }
      case "binded_redirect": {
        activeLogins.delete(opts.sessionKey);
        return { connected: false, alreadyConnected: true, message: "已连接过，无需重复连接。" };
      }
      case "scaned_but_redirect": {
        if (statusResponse.redirect_host) {
          activeLogin.currentApiBaseUrl = `https://${statusResponse.redirect_host}`;
        }
        break;
      }
      case "confirmed": {
        if (!statusResponse.ilink_bot_id) {
          activeLogins.delete(opts.sessionKey);
          return { connected: false, message: "登录失败：服务器未返回 ilink_bot_id。" };
        }
        activeLogins.delete(opts.sessionKey);
        logger.info(
          `Login confirmed! ilink_bot_id=${statusResponse.ilink_bot_id} user=${redactToken(statusResponse.ilink_user_id)}`,
        );
        return {
          connected: true,
          botToken: statusResponse.bot_token,
          accountId: statusResponse.ilink_bot_id,
          baseUrl: statusResponse.baseurl,
          userId: statusResponse.ilink_user_id,
          message: "已连接到微信。",
        };
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  activeLogins.delete(opts.sessionKey);
  return { connected: false, message: "登录超时，请重试。" };
}
