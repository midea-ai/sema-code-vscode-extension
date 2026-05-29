/**
 * Channel abstraction. Adding a platform = implementing ChannelAdapter; the
 * bridge / session never touch platform specifics. ReplyContext is opaque to
 * the bridge (carries whatever the platform needs to reply).
 */

/** Opaque per-recipient reply context (WeChat: target user + context_token). */
export interface ReplyContext {
  toUserId: string;
  contextToken?: string;
}

/** Inbound message normalized to platform-agnostic shape (text MVP). */
export interface NormalizedMessage {
  text: string;
  fromUserId: string;
  replyCtx: ReplyContext;
}

/** Outbound message: a single consolidated text reply. */
export interface OutboundMessage {
  text: string;
  replyCtx: ReplyContext;
}

export interface ChannelAdapter {
  start(onInbound: (m: NormalizedMessage) => void): Promise<void>;
  stop(): Promise<void>;
  send(out: OutboundMessage): Promise<void>;
}

/** Resolved WeChat bot credentials (from QR bind / hardcoded in Phase 3). */
export interface WeChatCreds {
  platform: "wechat";
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
}

/** 飞书应用凭证：长连接只需 appId / appSecret。 */
export interface FeishuCreds {
  platform: "feishu";
  appId: string;
  appSecret: string;
}

/** 当前活跃的远程渠道凭证（二选一，由 platform 判别）。 */
export type ClawCreds = WeChatCreds | FeishuCreds;
