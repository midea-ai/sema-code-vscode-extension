// 桌宠 HTTP 客户端 —— 镜像 src/pet/pet-client.ts 的 post()，去掉 vscode 依赖。
//
// 与 VSCode 端不同：这里没有常驻的 PetClient 单例（hook 是短进程），
// 每个函数都是独立的一次性请求，sessionId 由调用方（hook.js 从 stdin）传入。

'use strict';

const http = require('http');
const {
  PET_HOST, PET_PORT,
  PET_SERVER_HEADER, PET_SERVER_HEADER_VALUE,
  SAY_MAX_CHARS,
} = require('./protocol');

const POST_TIMEOUT_MS = 150;          // fire-and-forget，短超时不拖慢 Claude
const REGISTER_TIMEOUT_MS = 2000;     // 桌宠刚 spawn 完可能还没 warm，给 2 秒
const REGISTER_RETRY = 3;
const REGISTER_RETRY_INTERVAL_MS = 200;

function truncateSay(text) {
  const codepoints = Array.from(String(text));
  if (codepoints.length <= SAY_MAX_CHARS) return codepoints.join('');
  return codepoints.slice(0, SAY_MAX_CHARS).join('') + '…';
}

// 通用 POST：成功（响应头带 x-sema-pet:server 且状态码 < 400）resolve(true)，否则 false。
function post(pathname, body, timeoutMs = POST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let payload;
    try { payload = JSON.stringify(body); }
    catch { return resolve(false); }

    const req = http.request({
      host: PET_HOST, port: PET_PORT, path: pathname, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, (res) => {
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

// 注册会话（带重试），成功返回 true。
async function register(sessionId, cwd, clientPid) {
  const payload = { sessionId, cwd };
  if (Number.isInteger(clientPid)) payload.clientPid = clientPid;
  for (let i = 0; i < REGISTER_RETRY; i++) {
    if (await post('/session/register', payload, REGISTER_TIMEOUT_MS)) return true;
    await new Promise((r) => setTimeout(r, REGISTER_RETRY_INTERVAL_MS));
  }
  return false;
}

// 推送状态。state ∈ idle|thinking|working|attention|sleeping
function state(sessionId, st) {
  return post('/state', { sessionId, state: st, ts: Date.now() });
}

// 气泡。opts: { kind?: 'info'|'attention', ttlMs?: number, sticky?: boolean }
function say(sessionId, text, opts = {}) {
  return post('/say', { sessionId, text: truncateSay(text), ...opts });
}

// 注销会话。最后一个会话注销后桌宠自动退出。
function unregister(sessionId) {
  return post('/session/unregister', { sessionId });
}

module.exports = { register, state, say, unregister, truncateSay };
