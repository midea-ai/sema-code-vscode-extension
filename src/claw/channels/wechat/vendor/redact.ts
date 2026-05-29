/**
 * Logging redaction helpers. Lifted verbatim from
 * @tencent-weixin/openclaw-weixin (src/util/redact.ts).
 */
const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;

/** Truncate a string, appending a length indicator when trimmed. */
export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(len=${s.length})`;
}

/** Redact a token/secret: show only the first few chars + total length. */
export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  if (token.length <= prefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}

/** Truncate a JSON body string for safe logging; redacts known sensitive fields. */
export function redactBody(body: string | undefined, maxLen = DEFAULT_BODY_MAX_LEN): string {
  if (!body) return "(empty)";
  const redacted = body.replace(
    /"(context_token|bot_token|token|authorization|Authorization)"\s*:\s*"[^"]*"/g,
    '"$1":"<redacted>"',
  );
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}…(truncated, totalLen=${redacted.length})`;
}

/** Strip query string from a URL, keeping only origin + pathname. */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?<redacted>` : base;
  } catch {
    return truncate(rawUrl, 80);
  }
}
