/**
 * WeixinMessage -> NormalizedMessage (text-only MVP). Mirrors the text path of
 * openclaw-weixin's inbound.bodyFromItemList; media items are ignored.
 */
import { MessageItemType } from "./vendor/types";
import type { WeixinMessage } from "./vendor/types";
import type { NormalizedMessage } from "../types";

/** Extract plain text from a message's item list (text + voice-to-text). */
function bodyFromItemList(msg: WeixinMessage): string {
  const parts: string[] = [];
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      // Server-provided speech-to-text, when present.
      parts.push(item.voice_item.text);
    }
    // image / file / video items are out of scope for the text MVP.
  }
  return parts.join("\n").trim();
}

/** Returns null when the message has no usable text or no sender. */
export function normalize(msg: WeixinMessage): NormalizedMessage | null {
  const fromUserId = msg.from_user_id ?? "";
  if (!fromUserId) return null;
  const text = bodyFromItemList(msg);
  if (!text) return null;
  return {
    text,
    fromUserId,
    replyCtx: { toUserId: fromUserId, contextToken: msg.context_token },
  };
}
