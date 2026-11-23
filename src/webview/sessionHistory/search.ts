/**
 * 历史会话正文检索：把消息压成可搜文本、做匹配、截取命中片段。
 *
 * 纯函数、无运行时依赖，两端各自喂数据即可：
 * - VSCode 端：扩展宿主读正文文件后调用（SessionHistoryManager.searchSessionBodies）
 * - JB 端：history-controller 用 list 已带回的 content 直接调用
 *
 * 检索是低频需求，这里不做任何索引与缓存；成本只落在用户显式触发的那一次。
 */

/** 单会话最多参与检索的文本长度：从最早的轮次开始累积，超出即截断，保证一次全量扫描有上界 */
export const MAX_SEARCH_TEXT = 20000;
/** 单会话最多回传的命中片段数（列表里展示两行足够） */
const MAX_SNIPPETS = 2;
/** 片段在命中处前后各保留的字符数 */
const SNIPPET_PAD = 36;
/** 命中数展示上限，不必为「几千处」继续计数 */
const MAX_COUNT = 999;

export interface SearchSnippet {
    /** 命中处之前的上下文（已折叠换行） */
    before: string;
    /** 命中的原文（保留大小写） */
    match: string;
    /** 命中处之后的上下文 */
    after: string;
}

export interface SessionSearchHit {
    id: string;
    /** 命中总数（上限 MAX_COUNT） */
    count: number;
    snippets: SearchSnippet[];
}

/**
 * 单条消息里对检索有价值的纯文本。
 * 不含 reasoning 与大段工具输出：噪声大、体积大，命中质量也差。
 */
const messageText = (message: any): string => {
    if (!message) { return ''; }
    if (message.type === 'user') {
        return typeof message.content === 'string' ? message.content : '';
    }
    if (message.type === 'assistant') {
        return typeof message.content?.content === 'string' ? message.content.content : '';
    }
    if (message.type === 'tool') {
        return typeof message.content?.title === 'string' ? message.content.title : '';
    }
    return '';
};

/** 把消息数组压成一段检索文本，超出长度上限即截断 */
export const sessionSearchText = (messages: any[]): string => {
    let text = '';
    for (const message of messages) {
        const piece = messageText(message).trim();
        if (!piece) { continue; }
        text += (text ? '\n' : '') + piece;
        if (text.length >= MAX_SEARCH_TEXT) {
            return text.slice(0, MAX_SEARCH_TEXT);
        }
    }
    return text;
};

const collapse = (s: string): string => s.replace(/\s+/g, ' ');

/** 取命中位置前后的一段原文；index 基于原文，大小写与排版保持可见文本原样 */
const clip = (text: string, index: number, length: number): SearchSnippet => {
    const start = Math.max(0, index - SNIPPET_PAD);
    const end = Math.min(text.length, index + length + SNIPPET_PAD);
    return {
        before: (start > 0 ? '…' : '') + collapse(text.slice(start, index)).trimStart(),
        match: collapse(text.slice(index, index + length)),
        after: collapse(text.slice(index + length, end)).trimEnd() + (end < text.length ? '…' : ''),
    };
};

/**
 * 在单个会话里检索关键词；命中返回片段与次数，未命中返回 null。
 * 只做小写化后的子串匹配（不做分词 / 模糊），保证「为什么这条会出来」始终可解释。
 */
export const searchSessionMessages = (
    id: string,
    messages: any[],
    query: string
): SessionSearchHit | null => {
    const needle = query.trim().toLowerCase();
    if (!needle) { return null; }

    const text = sessionSearchText(messages);
    if (!text) { return null; }
    const hay = text.toLowerCase();

    let count = 0;
    let from = 0;
    const snippets: SearchSnippet[] = [];
    while (count < MAX_COUNT) {
        const index = hay.indexOf(needle, from);
        if (index < 0) { break; }
        count++;
        if (snippets.length < MAX_SNIPPETS) {
            snippets.push(clip(text, index, needle.length));
        }
        from = index + needle.length;
    }

    return count > 0 ? { id, count, snippets } : null;
};
