export const PET_HOST = '127.0.0.1';
export const PET_PORT = 24700;
export const PET_SERVER_HEADER = 'x-sema-pet';
export const PET_SERVER_HEADER_VALUE = 'server';

export const PET_DIR_NAME = '.sema/pet';
export const PET_RUNTIME_FILE = 'runtime.json';

export type PetState = 'idle' | 'thinking' | 'working' | 'attention' | 'sleeping';

export interface RegisterPayload {
  sessionId: string;
  cwd: string;
  clientPid?: number;
}

export interface UnregisterPayload {
  sessionId: string;
}

export interface StatePayload {
  sessionId: string;
  state: PetState;
  ts: number;
}

export interface SayOptions {
  kind?: 'info' | 'attention';
  ttlMs?: number;
  sticky?: boolean;
}

export interface SayPayload extends SayOptions {
  sessionId: string;
  text: string;
}

export type PetCommand =
  | { type: 'focus'; sessionId: string }
  | { type: 'noop' };

export interface PetRuntimeInfo {
  port: number;
  pid: number;
  startedAt: number;
}
