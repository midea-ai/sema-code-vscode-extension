/**
 * 极简 TOML 解析（纯函数，无依赖），只为读 Codex 的 config.toml。
 * 覆盖：注释、[table] / [[array]]、裸键 / 引号键 / 点分键、基本与字面字符串（含多行）、
 * 整数 / 浮点 / 布尔、数组（可跨行）、内联表；日期时间原样按字符串保留。
 * 不做 TOML 全量校验：语法错误时抛错，由调用方转成解析失败说明。
 */
// 粘性正则：从 pos 原地匹配，避免每个键 / 值都 slice 剩余全文（大 config.toml 下退化为 O(n²)）
const BARE_KEY_RE = /[A-Za-z0-9_-]+/y;
const SCALAR_RE = /[^\s,\]}#]+/y;

function matchAt(re: RegExp, src: string, pos: number): string | undefined {
    re.lastIndex = pos;
    return re.exec(src)?.[0];
}

export function parseToml(text: string): Record<string, any> {
    const root: Record<string, any> = {};
    let current = root;
    const src = text.replace(/\r\n/g, '\n');
    let pos = 0;

    const peek = () => src[pos];
    const eof = () => pos >= src.length;
    const skipWs = () => { while (!eof() && (src[pos] === ' ' || src[pos] === '\t')) pos++; };
    const skipComment = () => { if (src[pos] === '#') { while (!eof() && src[pos] !== '\n') pos++; } };
    const skipWsNl = () => {
        for (;;) {
            skipWs();
            skipComment();
            if (src[pos] === '\n') { pos++; continue; }
            break;
        }
    };
    const fail = (msg: string): never => {
        const line = src.slice(0, pos).split('\n').length;
        throw new Error(`TOML line ${line}: ${msg}`);
    };

    const readBasicString = (): string => {
        // 已在开头的 "
        if (src.startsWith('"""', pos)) {
            pos += 3;
            if (src[pos] === '\n') pos++;
            let out = '';
            while (!eof() && !src.startsWith('"""', pos)) {
                if (src[pos] === '\\') {
                    if (src[pos + 1] === '\n') { pos += 2; while (!eof() && /[ \t\n]/.test(src[pos])) pos++; continue; }
                    out += readEscape();
                    continue;
                }
                out += src[pos++];
            }
            if (eof()) fail('unterminated string');
            pos += 3;
            return out;
        }
        pos++;
        let out = '';
        while (!eof() && src[pos] !== '"') {
            if (src[pos] === '\n') fail('newline in string');
            if (src[pos] === '\\') { out += readEscape(); continue; }
            out += src[pos++];
        }
        if (eof()) fail('unterminated string');
        pos++;
        return out;
    };

    const readEscape = (): string => {
        const c = src[pos + 1];
        pos += 2;
        switch (c) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            case 'b': return '\b';
            case 'f': return '\f';
            case '"': return '"';
            case '\\': return '\\';
            case 'u': { const h = src.slice(pos, pos + 4); pos += 4; return String.fromCodePoint(parseInt(h, 16)); }
            case 'U': { const h = src.slice(pos, pos + 8); pos += 8; return String.fromCodePoint(parseInt(h, 16)); }
            default: return c ?? '';
        }
    };

    const readLiteralString = (): string => {
        if (src.startsWith("'''", pos)) {
            pos += 3;
            if (src[pos] === '\n') pos++;
            const end = src.indexOf("'''", pos);
            if (end < 0) fail('unterminated string');
            const out = src.slice(pos, end);
            pos = end + 3;
            return out;
        }
        pos++;
        const end = src.indexOf("'", pos);
        if (end < 0 || src.slice(pos, end).includes('\n')) fail('unterminated string');
        const out = src.slice(pos, end);
        pos = end + 1;
        return out;
    };

    const readKey = (): string[] => {
        const parts: string[] = [];
        for (;;) {
            skipWs();
            if (src[pos] === '"') parts.push(readBasicString());
            else if (src[pos] === "'") parts.push(readLiteralString());
            else {
                const m = matchAt(BARE_KEY_RE, src, pos) ?? fail('invalid key');
                parts.push(m);
                pos += m.length;
            }
            skipWs();
            if (src[pos] === '.') { pos++; continue; }
            return parts;
        }
    };

    const readValue = (): any => {
        skipWs();
        const c = peek();
        if (c === '"') return readBasicString();
        if (c === "'") return readLiteralString();
        if (c === '[') {
            pos++;
            const arr: any[] = [];
            for (;;) {
                skipWsNl();
                if (src[pos] === ']') { pos++; return arr; }
                arr.push(readValue());
                skipWsNl();
                if (src[pos] === ',') { pos++; continue; }
                if (src[pos] === ']') { pos++; return arr; }
                fail('expected , or ] in array');
            }
        }
        if (c === '{') {
            pos++;
            const obj: Record<string, any> = {};
            skipWs();
            if (src[pos] === '}') { pos++; return obj; }
            for (;;) {
                const key = readKey();
                skipWs();
                if (src[pos] !== '=') fail('expected = in inline table');
                pos++;
                const value = readValue();
                assign(obj, key, value);
                skipWs();
                if (src[pos] === ',') { pos++; skipWs(); continue; }
                if (src[pos] === '}') { pos++; return obj; }
                fail('expected , or } in inline table');
            }
        }
        const raw = matchAt(SCALAR_RE, src, pos) ?? fail('expected value');
        pos += raw.length;
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (/^[+-]?(inf|nan)$/.test(raw)) return raw.includes('nan') ? NaN : (raw.startsWith('-') ? -Infinity : Infinity);
        if (/^[+-]?(0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+)$/.test(raw)) return Number(raw.replace(/_/g, ''));
        if (/^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw.replace(/_/g, ''));
        // 日期时间等其他标量原样保留
        return raw;
    };

    const assign = (obj: Record<string, any>, key: string[], value: any) => {
        let cur = obj;
        for (let i = 0; i < key.length - 1; i++) {
            const k = key[i];
            if (cur[k] === undefined) cur[k] = {};
            else if (typeof cur[k] !== 'object' || Array.isArray(cur[k])) fail(`key ${k} is not a table`);
            cur = cur[k];
        }
        cur[key[key.length - 1]] = value;
    };

    const enterTable = (key: string[], isArray: boolean) => {
        let cur = root;
        for (let i = 0; i < key.length; i++) {
            const k = key[i];
            const last = i === key.length - 1;
            if (last && isArray) {
                if (cur[k] === undefined) cur[k] = [];
                if (!Array.isArray(cur[k])) fail(`key ${k} is not an array of tables`);
                const t: Record<string, any> = {};
                cur[k].push(t);
                cur = t;
                continue;
            }
            if (cur[k] === undefined) cur[k] = {};
            const next = cur[k];
            cur = Array.isArray(next) ? next[next.length - 1] : next;
            if (!cur || typeof cur !== 'object') fail(`key ${k} is not a table`);
        }
        current = cur;
    };

    for (;;) {
        skipWsNl();
        if (eof()) break;
        if (src[pos] === '[') {
            const isArray = src.startsWith('[[', pos);
            pos += isArray ? 2 : 1;
            const key = readKey();
            skipWs();
            if (!src.startsWith(isArray ? ']]' : ']', pos)) fail('expected ] after table name');
            pos += isArray ? 2 : 1;
            enterTable(key, isArray);
        } else {
            const key = readKey();
            skipWs();
            if (src[pos] !== '=') fail('expected =');
            pos++;
            const value = readValue();
            assign(current, key, value);
        }
        skipWs();
        skipComment();
        if (!eof() && src[pos] !== '\n') fail('unexpected content after value');
    }
    return root;
}
