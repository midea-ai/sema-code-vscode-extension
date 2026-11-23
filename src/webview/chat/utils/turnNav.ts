import type { Message } from '../types';

const MAX_CHARS = 400; // 小面板最多显示三行，取这么多字符足够截断

export interface TurnNavItem {
    /** 用户输入（或轮次开头块的文案）的纯文字 */
    title: string;
    /** 本轮以已完成的文字结论收尾时的结论纯文字；以工具 / 报错 / 确认等收尾或仍在运行则无 */
    conclusion?: string;
}

/** 压成一段纯文字：去掉各行行首的标题 / 列表 / 引用标记与行内强调符号，换行并成空格 */
const plainText = (s: string): string => (s || '').slice(0, MAX_CHARS * 2).split('\n')
    .map(x => x.trim().replace(/^(?:[#>*\-+]|\d+\.)\s*/, ''))
    .filter(Boolean).join(' ').replace(/[*_`]+/g, '').slice(0, MAX_CHARS);

const isGoalRound = (m: Message) => m.type === 'user' && m.source === 'goal' && m.goal?.action === 'round';

/** 轮末不参与「以什么收尾」判断的消息：目标达成 / 后台任务结束等系统提示 */
const isTrailer = (m: Message) => m.type === 'system' && ['goal_achieved', 'task_end', 'file_reference'].includes(m.content?.type);

/**
 * 从消息列表算出导航条目（与 App 的轮次分组一致：每条用户输入开一轮，目标自动续轮、运行中轮内注入的输入并入所在轮）。
 * 开头没有用户输入的前置消息不算一轮；最后一轮正在运行时不给结论。
 *
 * 纯函数：聊天页的轮次指示条与历史会话的悬浮预览共用，保证两边「轮次」语义一致。
 */
export const turnNavItems = (messages: Message[], processing: boolean): TurnNavItem[] => {
    const turns: Message[][] = [];
    for (const m of messages) {
        if (m.type === 'user' && !isGoalRound(m) && !m.injected) turns.push([m]);
        else if (turns.length) turns[turns.length - 1].push(m);
    }
    return turns.map((turn, i) => {
        const o = turn[0];
        const title = plainText(o.content) || o.pastes?.[0]?.preview || (o.attachments?.length ? 'Image' : '');
        const item: TurnNavItem = { title };
        if (processing && i === turns.length - 1) return item;
        const rest = turn.slice(1).filter(m => !isTrailer(m));
        const last = rest[rest.length - 1];
        if (last?.type === 'assistant' && last.content?.completed !== false && last.content?.content?.trim()) item.conclusion = plainText(last.content.content);
        return item;
    });
};
