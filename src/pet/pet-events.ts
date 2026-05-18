import { pet } from './pet-client';

/** 桌宠订阅的事件源（SemaSession 满足该接口） */
interface PetEventSource {
  on(event: string, listener: (data: any) => void): unknown;
  off(event: string, listener: (data: any) => void): unknown;
}

const ATTENTION_BUBBLES = {
  permission: '需要权限确认，点我查看',
  pick:       '我有点疑问，点我聊聊',
  plan:       '计划写好啦，点我开干',
} as const;

function raiseAttention(message: string): void {
  pet.state('attention');
  pet.say(message, { kind: 'attention', sticky: true });
}

/**
 * 把桌宠状态绑定到指定会话。返回解绑函数，切换 active 会话时调用。
 */
export function wirePetEvents(session: PetEventSource): () => void {
  const handlers: Array<[string, (data: any) => void]> = [
    ['input:processing',        () => pet.state('thinking')],
    ['message:complete',        (d: any) => { if (d?.hasToolCalls) pet.state('working'); }],
    ['state:update',            (d: any) => { if (d?.state === 'idle') pet.state('idle'); }],
    ['tool:permission:request', () => raiseAttention(ATTENTION_BUBBLES.permission)],
    ['pick:option:request',     () => raiseAttention(ATTENTION_BUBBLES.pick)],
    ['plan:exit:request',       () => raiseAttention(ATTENTION_BUBBLES.plan)],
  ];

  for (const [event, fn] of handlers) {
    session.on(event, fn);
  }

  return () => {
    for (const [event, fn] of handlers) {
      session.off(event, fn);
    }
  };
}
