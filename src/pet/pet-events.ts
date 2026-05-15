import { pet } from './pet-client';

interface EventSubscribable {
  on(event: string, listener: (data: any) => void): unknown;
}

const ATTENTION_BUBBLE = '需要权限确认，点我查看';

function raiseAttention(): void {
  pet.state('attention');
  pet.say(ATTENTION_BUBBLE, { kind: 'attention', sticky: true });
}

export function wirePetEvents(semaCore: EventSubscribable): void {
  semaCore.on('input:processing',         () => pet.state('thinking'));
  semaCore.on('message:complete',         (d: any) => { if (d?.hasToolCalls) pet.state('working'); });
  semaCore.on('state:update',             (d: any) => { if (d?.state === 'idle') pet.state('idle'); });
  semaCore.on('tool:permission:request',  () => raiseAttention());
  semaCore.on('pick:option:request',      () => raiseAttention());
  semaCore.on('plan:exit:request',        () => raiseAttention());
}
