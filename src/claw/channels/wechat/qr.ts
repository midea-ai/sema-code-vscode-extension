/**
 * QR-bind orchestration: wraps the lifted login-qr flow, encodes the QR payload
 * to a PNG data URL (server-side, so the webview just renders an <img>), and
 * persists credentials on confirmation.
 */
import QRCode from "qrcode";

import { startWeixinLoginWithQr, waitForWeixinLogin } from "./vendor/login-qr";
import type { WeixinQrWaitResult } from "./vendor/login-qr";
import { saveCredentials } from "../../credentials-store";
import { DEFAULT_BASE_URL } from "./vendor/shims";

export interface QrStart {
  /** PNG data URL ready for <img>; undefined if encoding failed (use rawPayload). */
  qrcodeDataUrl?: string;
  rawPayload?: string;
  message: string;
  sessionKey: string;
}

export interface WaitBindCallbacks {
  getVerifyCode?: (isRetry: boolean) => Promise<string>;
  onQrRefresh?: (qrcodeDataUrl: string, rawPayload: string) => void;
}

async function encodeQr(payload: string): Promise<string | undefined> {
  try {
    return await QRCode.toDataURL(payload, { margin: 1, width: 240 });
  } catch {
    return undefined;
  }
}

export async function startBind(): Promise<QrStart> {
  const r = await startWeixinLoginWithQr({ botType: "3" });
  const qrcodeDataUrl = r.qrcodeUrl ? await encodeQr(r.qrcodeUrl) : undefined;
  return { qrcodeDataUrl, rawPayload: r.qrcodeUrl, message: r.message, sessionKey: r.sessionKey };
}

export async function waitBind(sessionKey: string, cb: WaitBindCallbacks = {}): Promise<WeixinQrWaitResult> {
  const result = await waitForWeixinLogin({
    sessionKey,
    timeoutMs: 480_000,
    getVerifyCode: cb.getVerifyCode,
    onQrRefresh: cb.onQrRefresh
      ? (payload) => {
          void encodeQr(payload).then((dataUrl) => cb.onQrRefresh!(dataUrl ?? payload, payload));
        }
      : undefined,
  });

  if (result.connected && result.botToken && result.accountId) {
    saveCredentials({
      accountId: result.accountId,
      token: result.botToken,
      baseUrl: result.baseUrl || DEFAULT_BASE_URL,
      userId: result.userId,
    });
  }
  return result;
}
