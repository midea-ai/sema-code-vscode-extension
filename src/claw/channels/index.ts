/** Channel factory. 远程同一时刻只有一个活着，按凭证的 platform 二选一。 */
import { WeChatAdapter } from "./wechat/adapter";
import { FeishuAdapter } from "./feishu/adapter";
import type { ChannelAdapter, ClawCreds } from "./types";

export function createChannel(creds: ClawCreds, log?: (m: string) => void): ChannelAdapter {
  if (creds.platform === "feishu") {
    return new FeishuAdapter(creds, log);
  }
  return new WeChatAdapter(creds, log);
}

export type {
  ChannelAdapter,
  ClawCreds,
  FeishuCreds,
  NormalizedMessage,
  OutboundMessage,
  ReplyContext,
  WeChatCreds,
} from "./types";
