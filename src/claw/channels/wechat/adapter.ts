/**
 * WeChat ChannelAdapter: long-poll inbound via the poller, consolidated text
 * outbound via sendMessage. notifyStart on start, notifyStop on stop. The
 * in-flight long-poll is aborted on stop so disable() returns promptly.
 */
import { notifyStart, notifyStop, sendMessage } from "./vendor/api";
import { MessageItemType, MessageState, MessageType } from "./vendor/types";
import type { SendMessageReq } from "./vendor/types";
import { generateId } from "./vendor/random";
import { runPoller } from "./poller";
import { normalize } from "./normalize";
import type { ChannelAdapter, NormalizedMessage, OutboundMessage, WeChatCreds } from "../types";

export class WeChatAdapter implements ChannelAdapter {
  private abort?: AbortController;
  private pollPromise?: Promise<void>;

  constructor(
    private readonly creds: WeChatCreds,
    private readonly log: (m: string) => void = () => {},
  ) {}

  async start(onInbound: (m: NormalizedMessage) => void): Promise<void> {
    this.abort = new AbortController();
    try {
      await notifyStart({ baseUrl: this.creds.baseUrl, token: this.creds.token });
    } catch (e) {
      this.log(`notifyStart failed (ignored): ${String(e)}`);
    }
    this.pollPromise = runPoller({
      baseUrl: this.creds.baseUrl,
      token: this.creds.token,
      abortSignal: this.abort.signal,
      log: this.log,
      onMessage: (msg) => {
        const from = msg.from_user_id ?? "?";
        // Only forward inbound USER messages; ignore our own BOT echoes.
        if (msg.message_type !== undefined && msg.message_type !== MessageType.USER) {
          this.log(`skip non-user msg type=${msg.message_type} from=${from}`);
          return;
        }
        const n = normalize(msg);
        if (!n) {
          this.log(`skip msg (no text) from=${from} items=${msg.item_list?.length ?? 0}`);
          return;
        }
        this.log(`inbound from=${from}: "${n.text.length > 60 ? n.text.slice(0, 60) + "…" : n.text}"`);
        onInbound(n);
      },
    });
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    try {
      await this.pollPromise;
    } catch {
      /* poller exits on abort */
    }
    try {
      await notifyStop({ baseUrl: this.creds.baseUrl, token: this.creds.token });
    } catch (e) {
      this.log(`notifyStop failed (ignored): ${String(e)}`);
    }
  }

  async send(out: OutboundMessage): Promise<void> {
    // 对齐官方 bot 发送协议：必须带 message_type=BOT / message_state=FINISH / client_id，
    // 否则服务器会接收（返回空响应）却不把消息投递给用户。
    const clientId = generateId("sema-claw");
    const body: SendMessageReq = {
      msg: {
        from_user_id: "",
        to_user_id: out.replyCtx.toUserId,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: out.text } }],
        context_token: out.replyCtx.contextToken ?? undefined,
      },
    };
    const raw = await sendMessage({ baseUrl: this.creds.baseUrl, token: this.creds.token, body });
    this.log(`sendMessage to=${out.replyCtx.toUserId} ctxToken=${out.replyCtx.contextToken ? "yes" : "MISSING"} resp=${raw || "(empty)"}`);
  }
}
