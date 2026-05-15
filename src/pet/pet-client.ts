import * as http from 'http';
import * as vscode from 'vscode';
import {
  PET_HOST, PET_PORT,
  PET_SERVER_HEADER, PET_SERVER_HEADER_VALUE,
  PetState, RegisterPayload, StatePayload, SayPayload, SayOptions,
  PetCommand,
} from './pet-types';
import { handlePetFocus } from './pet-focus-handler';

const POST_TIMEOUT_MS = 100;
const REGISTER_TIMEOUT_MS = 2000;     // 首次 register 桌宠刚 spawn 完可能还没完全 warm，给 2 秒
const REGISTER_RETRY = 3;
const REGISTER_RETRY_INTERVAL_MS = 200;
const LONG_POLL_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 200;
const SAY_MAX_CHARS = 40;

function truncateSay(text: string): string {
  const codepoints = Array.from(text);
  if (codepoints.length <= SAY_MAX_CHARS) return text;
  return codepoints.slice(0, SAY_MAX_CHARS).join('') + '…';
}

class PetClient {
  private sessionId = vscode.env.sessionId;
  private registered = false;
  private disposed = false;
  private polling = false;
  // 在 register 完成前事件订阅可能就开始推送，缓存最后一次 state，register 成功后重放，
  // 避免首次启用桌宠时丢失启动窗口期内的状态变化。
  private pendingState: PetState | null = null;

  async register(cwd: string): Promise<boolean> {
    const payload = { sessionId: this.sessionId, cwd } satisfies RegisterPayload;
    for (let i = 0; i < REGISTER_RETRY; i++) {
      const ok = await this.post('/session/register', payload, REGISTER_TIMEOUT_MS);
      if (ok) {
        this.registered = true;
        this.disposed = false;
        this.startLongPoll();
        if (this.pendingState) {
          const replay = this.pendingState;
          this.pendingState = null;
          void this.post('/state', {
            sessionId: this.sessionId, state: replay, ts: Date.now(),
          } satisfies StatePayload);
        }
        return true;
      }
      await new Promise(r => setTimeout(r, REGISTER_RETRY_INTERVAL_MS));
    }
    return false;
  }

  state(state: PetState): void {
    if (this.disposed) return;
    if (!this.registered) {
      this.pendingState = state;
      return;
    }
    void this.post('/state', {
      sessionId: this.sessionId, state, ts: Date.now(),
    } satisfies StatePayload);
  }

  say(text: string, opts: SayOptions = {}): void {
    if (!this.registered || this.disposed) return;
    void this.post('/say', {
      sessionId: this.sessionId, text: truncateSay(text), ...opts,
    } satisfies SayPayload);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingState = null;
    if (this.registered) {
      this.registered = false;
      await this.post('/session/unregister', { sessionId: this.sessionId });
    }
  }

  private post<T extends object>(pathname: string, body: T, timeoutMs: number = POST_TIMEOUT_MS): Promise<boolean> {
    return new Promise(resolve => {
      let payload: string;
      try { payload = JSON.stringify(body); }
      catch { return resolve(false); }

      const req = http.request({
        host: PET_HOST, port: PET_PORT, path: pathname, method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      }, res => {
        const ok = res.headers[PET_SERVER_HEADER] === PET_SERVER_HEADER_VALUE
          && (res.statusCode ?? 0) < 400;
        res.resume();
        res.on('end', () => resolve(ok));
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
      req.write(payload);
      req.end();
    });
  }

  private startLongPoll(): void {
    if (this.polling) return;
    this.polling = true;
    void (async () => {
      while (!this.disposed) {
        try {
          const cmd = await this.getCommand();
          if (cmd?.type === 'focus' && cmd.sessionId === this.sessionId) {
            handlePetFocus();
          }
        } catch {}
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
      this.polling = false;
    })();
  }

  private getCommand(): Promise<PetCommand | null> {
    return new Promise(resolve => {
      const req = http.get({
        host: PET_HOST, port: PET_PORT,
        path: `/command?sessionId=${encodeURIComponent(this.sessionId)}`,
        timeout: LONG_POLL_TIMEOUT_MS,
      }, res => {
        if (res.headers[PET_SERVER_HEADER] !== PET_SERVER_HEADER_VALUE) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body) as PetCommand); }
          catch { resolve(null); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    });
  }
}

export const pet = new PetClient();
