/**
 * 飞书 im.message.receive_v1 事件 -> NormalizedMessage（纯文本 MVP，对齐微信 normalize）。
 *
 * claw 定位是「本人的远程」：只处理与机器人的单人私聊（p2p），群聊一律忽略——
 * 更安全、也和微信单聊语义一致。回复用 chat_id，放进 replyCtx.toUserId；adapter
 * 发送时固定 receive_id_type='chat_id'。
 */
import type { NormalizedMessage } from "../types";

/** 飞书事件 data 的最小结构（只取本 MVP 用到的字段）。 */
interface FeishuReceiveData {
  sender?: { sender_id?: { open_id?: string } };
  message?: {
    chat_id?: string;
    chat_type?: string; // 'p2p' | 'group'
    message_type?: string; // 'text' | 'image' | ...
    content?: string; // JSON 串，文本为 {"text":"..."}
  };
}

/** 解析飞书文本私聊消息；非 p2p / 非文本 / 无文本时返回 null。 */
export function normalizeFeishu(data: FeishuReceiveData): NormalizedMessage | null {
  const msg = data.message;
  if (!msg?.chat_id) return null;
  // 只收单人私聊；群聊（含被 @）一律不响应。
  if (msg.chat_type !== "p2p") return null;
  // 纯文本 MVP：图片 / 文件 / 富文本暂不处理。
  if (msg.message_type && msg.message_type !== "text") return null;

  let text = "";
  try {
    text = JSON.parse(msg.content || "{}").text ?? "";
  } catch {
    text = "";
  }
  text = text.trim();
  if (!text) return null;

  const fromUserId = data.sender?.sender_id?.open_id ?? msg.chat_id;
  return { text, fromUserId, replyCtx: { toUserId: msg.chat_id } };
}
