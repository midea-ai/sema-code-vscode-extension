import type { SemaSession } from 'sema-core';

/**
 * 会话级事件清单（挂在 SemaSession 上，与 VSCode SemaSessionWrapper 转发的事件对齐）。
 * SemaCore.on 只接收进程级事件，会话级事件必须绑在 SemaSession 上。
 */
export const SESSION_EVENTS = [
  'session:ready', 'session:error', 'session:interrupted', 'session:cleared',
  'state:update',
  'input:received', 'input:processing',
  'message:text:chunk', 'message:thinking:chunk', 'message:complete',
  'tool:permission:request', 'tool:permission:auto',
  'tool:execution:complete', 'tool:execution:chunk', 'tool:execution:error',
  'task:agent:start', 'task:agent:end', 'task:start', 'task:end', 'task:transfer',
  'todos:update', 'topic:update',
  'pick:option:request', 'plan:exit:request', 'plan:implement',
  'compact:exec',
  'conversation:usage', 'file:reference',
  'permissionLevel:update', 'quickchat:response',
];

/** 事件推送回调：把会话事件写回对应的 gRPC 流，并带上所属 session_id */
export type EventPush = (event: string, data: any, sessionId: string) => void;

/**
 * SessionBinder —— 把单个 SemaSession 的会话级事件桥接到 gRPC 流。
 *
 * 每个会话（对应 UI 一个标签）一个实例，转发出去的每条事件都带 session_id，
 * 供宿主按标签分发。对齐 VSCode 中「一个 webview 消息通道按 sessionId 路由多会话」。
 */
export class SessionBinder {
  private handlers: Array<{ event: string; fn: (data: any) => void }> = [];

  constructor(
    public readonly sessionId: string,
    private session: SemaSession,
    private push: EventPush,
  ) {}

  bind(): void {
    for (const event of SESSION_EVENTS) {
      const fn = (data: any) => this.push(event, data, this.sessionId);
      (this.session as any).on(event, fn);
      this.handlers.push({ event, fn });
    }
  }

  unbind(): void {
    for (const { event, fn } of this.handlers) {
      try { (this.session as any).off?.(event, fn); } catch { /* ignore */ }
    }
    this.handlers = [];
  }
}
