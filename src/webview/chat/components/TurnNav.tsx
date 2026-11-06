import React, { useEffect, useRef, useState } from 'react';
import { Message } from '../types';

const MAX_TICKS = 30;
const TICK_H = 7; // 每条短横线占的行高（线 2px + 间距 5px，与 .turn-nav-tick 一致）
const NAV_PAD = 12; // 指示条上下内边距之和（与 .turn-nav 一致）
const MIN_TICKS = 5;
const MAX_CHARS = 400; // 小面板最多显示三行，取这么多字符足够截断
/** 少于这么多轮不显示指示条 */
export const MIN_TURNS = 2;

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

interface TurnNavProps {
    /** 消息滚动容器（#output-container），里面每轮是带 data-turn 的 .turn-group */
    containerRef: React.RefObject<HTMLDivElement | null>;
    items: TurnNavItem[];
}

/**
 * 消息流左缘的轮次指示条（与 core webui 同款）：一条短横线对应一轮输入，当前轮（用户输入正吸顶的那轮）加粗；
 * 悬停某条短横线在其右侧弹出该轮的小面板（单行输入 + 可选结论最多三行），移开即消失；点击跳到该轮用户输入。
 * 当前轮按 [data-turn] 轮次容器算：最后一个顶边不低于滚动位置的；滚到底时取最后一轮（末轮太短时顶边永远到不了视口顶）。
 */
const TurnNav: React.FC<TurnNavProps> = ({ containerRef, items }) => {
    const [cur, setCur] = useState(0);
    const [hovered, setHovered] = useState<number | null>(null);
    // 点击钉住的轮：目标轮顶边滚不到视口顶（已到底、末尾内容不足一屏）时按滚动位置算出的仍是别的轮，
    // 记下点击后的滚动位置，位置没变就一直显示点中的那轮，用户再滚动（或内容增高带动滚动）即解除
    const pinned = useRef<{ idx: number; top: number } | null>(null);
    // 一次最多画几条：上限 30，消息区矮时按高度缩减（留出上下各一个行高的余量，不让指示条溢出消息区）
    const [maxTicks, setMaxTicks] = useState(MAX_TICKS);
    const count = items.length;

    // 轮次容器相对滚动内容顶部的位置（不用 offsetTop：offsetParent 是外层定位容器，与滚动内容不对应）
    const turnTop = (list: HTMLDivElement, el: Element) => el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;

    useEffect(() => {
        const list = containerRef.current;
        if (!list) return;
        let raf = 0;
        const update = () => {
            raf = 0;
            setMaxTicks(Math.max(MIN_TICKS, Math.min(MAX_TICKS, Math.floor((list.clientHeight - NAV_PAD - 2 * TICK_H) / TICK_H))));
            const turns = list.querySelectorAll<HTMLElement>('[data-turn]');
            if (!turns.length) return;
            if (pinned.current) {
                if (pinned.current.top === list.scrollTop) { setCur(pinned.current.idx); return; }
                pinned.current = null;
            }
            if (list.scrollHeight - list.scrollTop - list.clientHeight <= 1) { setCur(Number(turns[turns.length - 1].dataset.turn)); return; }
            let best = Number(turns[0].dataset.turn);
            for (const el of Array.from(turns)) {
                if (turnTop(list, el) > list.scrollTop + 1) break;
                best = Number(el.dataset.turn);
            }
            setCur(best);
        };
        const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
        schedule();
        list.addEventListener('scroll', schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(list);
        if (list.firstElementChild) ro.observe(list.firstElementChild);
        return () => { list.removeEventListener('scroll', schedule); ro.disconnect(); cancelAnimationFrame(raf); };
    }, [containerRef, count]);

    const go = (idx: number) => {
        const list = containerRef.current;
        const el = list?.querySelector<HTMLElement>(`[data-turn="${idx}"]`);
        if (!list || !el) return;
        // 只改滚动位置，贴底状态交给 App 的 scroll 监听按滚动方向判定（向上跳离底、向下跳到底附近恢复贴底）
        list.scrollTop = turnTop(list, el);
        pinned.current = { idx, top: list.scrollTop }; // 读回的是钳位后的实际位置
        setCur(idx);
    };

    // 轮数多时指示条只画当前轮附近的一段
    const tickFrom = count > maxTicks ? Math.min(count - maxTicks, Math.max(0, cur - Math.floor(maxTicks / 2))) : 0;
    const ticks = Array.from({ length: Math.min(count, maxTicks) }, (_, i) => tickFrom + i);
    const tip = hovered != null ? items[hovered] : null;

    return (
        <div className="turn-nav" onMouseLeave={() => setHovered(null)}>
            {ticks.map(i => (
                <button key={i} className="turn-nav-tick" onClick={() => go(i)} onMouseEnter={() => setHovered(i)} tabIndex={-1}>
                    <span className={`turn-nav-bar${i === cur ? ' current' : ''}`} />
                    {/* 小面板：挂在当前悬停的短横线右侧、垂直居中；不接鼠标事件，免得挡住相邻短横线的悬停 */}
                    {hovered === i && tip && (
                        <span className="turn-nav-tip">
                            <span className="turn-nav-tip-title">{tip.title || ' '}</span>
                            {tip.conclusion && <span className="turn-nav-tip-conclusion">{tip.conclusion}</span>}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
};

export default TurnNav;
