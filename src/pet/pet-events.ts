import { pet } from './pet-client';

interface EventSubscribable {
  on(event: string, listener: (data: any) => void): unknown;
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

export function wirePetEvents(semaCore: EventSubscribable): void {
  semaCore.on('input:processing',         () => pet.state('thinking'));
  semaCore.on('message:complete',         (d: any) => { if (d?.hasToolCalls) pet.state('working'); });
  semaCore.on('state:update',             (d: any) => { if (d?.state === 'idle') pet.state('idle'); });
  semaCore.on('tool:permission:request',  () => raiseAttention(ATTENTION_BUBBLES.permission));
  semaCore.on('pick:option:request',      () => raiseAttention(ATTENTION_BUBBLES.pick));
  semaCore.on('plan:exit:request',        () => raiseAttention(ATTENTION_BUBBLES.plan));
}
