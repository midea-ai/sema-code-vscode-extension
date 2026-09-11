import { pet } from './pet-client';
import { PetState } from './pet-types';
import { t } from '../webview/common/i18n/core';

/** 桌宠订阅的事件源（SemaSession 满足该接口） */
interface PetEventSource {
  on(event: string, listener: (data: any) => void): unknown;
  off(event: string, listener: (data: any) => void): unknown;
}

// 气泡文案按触发时的语言取值（不能做模块顶层常量，否则切换语言不生效）
const ATTENTION_BUBBLES = {
  get permission() { return t('pet.permission'); },
  get pick()       { return t('pet.pick'); },
  get plan()       { return t('pet.plan'); },
};

/**
 * 状态优先级：桌宠只有一个，多会话并发时展示优先级最高的状态。
 * 任一会话需要关注 → attention；任一会话忙 → thinking/working；全部空闲 → idle。
 */
const STATE_PRIORITY: Record<PetState, number> = {
  sleeping:  0,
  idle:      1,
  working:   2,
  thinking:  3,
  attention: 4,
};

/** 每个会话当前的桌宠状态。桌宠展示所有会话聚合后的结果。 */
const sessionStates = new Map<string, PetState>();

/** 重新计算聚合状态并推送给桌宠。 */
function pushAggregateState(): void {
  let best: PetState | null = null;
  for (const state of sessionStates.values()) {
    if (best === null || STATE_PRIORITY[state] > STATE_PRIORITY[best]) {
      best = state;
    }
  }
  pet.state(best ?? 'idle');
}

/** 更新某个会话的桌宠状态，并刷新聚合结果。 */
export function setPetSessionState(sessionId: string, state: PetState): void {
  sessionStates.set(sessionId, state);
  pushAggregateState();
}

/** 移除某个会话的状态记录（会话关闭 / 解绑时调用）。 */
function removePetSession(sessionId: string): void {
  if (sessionStates.delete(sessionId)) {
    pushAggregateState();
  }
}

/**
 * 把桌宠状态绑定到指定会话。桌宠会同时监听所有会话，
 * 返回解绑函数，会话关闭时调用。
 */
export function wirePetEvents(sessionId: string, session: PetEventSource): () => void {
  const set = (state: PetState) => setPetSessionState(sessionId, state);
  const raiseAttention = (message: string): void => {
    set('attention');
    pet.say(message, { kind: 'attention', sticky: true });
  };

  const handlers: Array<[string, (data: any) => void]> = [
    ['input:processing',        () => set('thinking')],
    ['message:complete',        (d: any) => { if (d?.hasToolCalls) set('working'); }],
    ['state:update',            (d: any) => { if (d?.state === 'idle') set('idle'); }],
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
    removePetSession(sessionId);
  };
}
