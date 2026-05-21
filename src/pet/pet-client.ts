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
const POLL_INTERVAL_MS = 20;
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

  async register(cwd: string): Promise<boolean> {
    const payload = {
      sessionId: this.sessionId, cwd, clientPid: process.pid,
    } satisfies RegisterPayload;
    for (let i = 0; i < REGISTER_RETRY; i++) {
      if (await this.post('/session/register', payload, REGISTER_TIMEOUT_MS)) {
        this.registered = true;
        this.disposed = false;
        this.startLongPoll();
        return true;
      }
      await new Promise(r => setTimeout(r, REGISTER_RETRY_INTERVAL_MS));
    }
    return false;
  }

  // 注册前的事件一律不缓存、不重放：桌宠就绪并注册成功后，后续状态变化才会送达。
  // （桌宠是否就绪由 ensurePetRunning 的就绪等待保证，注册不会抢在桌宠起来之前。）
  state(state: PetState): void {
    if (this.disposed || !this.registered) return;
    void this.post('/state', {
      sessionId: this.sessionId, state, ts: Date.now(),
    } satisfies StatePayload);
  }

  say(text: string, opts: SayOptions = {}): void {
    if (this.disposed || !this.registered) return;
    void this.post('/say', {
      sessionId: this.sessionId, text: truncateSay(text), ...opts,
    } satisfies SayPayload);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
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
