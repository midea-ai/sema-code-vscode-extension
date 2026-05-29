/**
 * 飞书 ChannelAdapter：用官方 SDK 的 WSClient 起长连接收事件（无需公网回调），
 * 用 Client 发送整段文本回复。与微信 adapter 对等——只是接入方式不同，bridge /
 * session 完全复用，发送内容逻辑不变。
 *
 * start: WSClient.start({eventDispatcher}) 订阅 im.message.receive_v1
 * stop : WSClient.close({force}) 断长连接（停心跳 / 停重连 / 关 socket）
 * send : client.im.message.create，receive_id_type='chat_id'
 *
 * 回调里只把消息丢给 onInbound（同步返回、不等 agent 跑完），满足飞书长连接
 * 「消息需 3 秒内处理」的要求；结果由 bridge 异步发回。
 */
import * as Lark from "@larksuiteoapi/node-sdk";

import { normalizeFeishu } from "./normalize";
import type { ChannelAdapter, FeishuCreds, NormalizedMessage, OutboundMessage } from "../types";

const snippet = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);

/** 超过此长度才用交互卡片渲染 markdown；短消息（工具通知 / 权限询问 / 路径）走纯文本，更轻。 */
const CARD_LENGTH_THRESHOLD = 200;

export class FeishuAdapter implements ChannelAdapter {
  private wsClient?: Lark.WSClient;
  private client?: Lark.Client;

  constructor(
    private readonly creds: FeishuCreds,
    private readonly log: (m: string) => void = () => {},
  ) {}

  async start(onInbound: (m: NormalizedMessage) => void): Promise<void> {
    const base = { appId: this.creds.appId, appSecret: this.creds.appSecret };
    this.client = new Lark.Client(base);
    this.wsClient = new Lark.WSClient({ ...base, loggerLevel: Lark.LoggerLevel.info });

    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: unknown) => {
        const n = normalizeFeishu(data as Parameters<typeof normalizeFeishu>[0]);
        if (!n) {
          this.log("skip feishu msg (non-p2p / no text)");
          return;
        }
        this.log(`inbound from=${n.fromUserId}: "${snippet(n.text)}"`);
        // 非阻塞：丢给 bridge 异步处理，回调立刻返回（满足飞书 3s 限制）。
        onInbound(n);
      },
    });

    this.wsClient.start({ eventDispatcher: dispatcher });
    this.log("feishu ws client started");
  }

  async stop(): Promise<void> {
    try {
      this.wsClient?.close({ force: true });
    } catch (e) {
      this.log(`ws close failed: ${String(e)}`);
    }
    this.wsClient = undefined;
    this.client = undefined;
  }

  async send(out: OutboundMessage): Promise<void> {
    if (!this.client) {
      this.log("send: no client (not started)");
      return;
    }
    // 长回复用交互卡片渲染 markdown（加粗 / 列表 / 链接 / 行内代码等）；
    // 短消息用纯文本，避免短通知被包成偏重的卡片。
    const useCard = out.text.length > CARD_LENGTH_THRESHOLD;
    try {
      await this.client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: out.replyCtx.toUserId,
          msg_type: useCard ? "interactive" : "text",
          content: useCard
            ? JSON.stringify(buildMarkdownCard(out.text))
            : JSON.stringify({ text: out.text }),
        },
      });
      this.log(`sendMessage to=${out.replyCtx.toUserId} len=${out.text.length} card=${useCard}`);
    } catch (e) {
      this.log(`feishu send failed: ${String(e)}`);
    }
  }
}

/** 把一段文本包成飞书交互卡片（markdown 元素渲染）。 */
function buildMarkdownCard(text: string): unknown {
  return {
    config: { wide_screen_mode: true },
    elements: [{ tag: "markdown", content: text }],
  };
}
