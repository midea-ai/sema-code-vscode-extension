import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useT, useLang, setLang, LANGS } from '../common/i18n/react';
import type { SessionSearchHit } from './search';
import type { TurnNavItem } from '../chat/utils/turnNav';

interface Session {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    content: any[];
    projectPath: string;
    agentMode?: 'Agent' | 'Plan' | 'Design';
}

interface VscodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

interface AppProps {
    vscode: VscodeApi;
}

/** 面板与鼠标的间隔 */
const PREVIEW_GAP = 12;
const PREVIEW_EDGE = 8;

/** 悬停多久才弹预览：太短会在扫过列表或点删除时误弹 */
const PREVIEW_HOVER_DELAY = 500;

/** 标题里命中关键词的部分加底色；query 为空时原样输出 */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
    const needle = query.trim().toLowerCase();
    if (!needle) { return <>{text}</>; }
    const hay = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let from = 0;
    let index = hay.indexOf(needle);
    while (index >= 0) {
        if (index > from) { parts.push(text.slice(from, index)); }
        parts.push(<mark key={index}>{text.slice(index, index + needle.length)}</mark>);
        from = index + needle.length;
        index = hay.indexOf(needle, from);
    }
    if (parts.length === 0) { return <>{text}</>; }
    parts.push(text.slice(from));
    return <>{parts}</>;
};

const App: React.FC<AppProps> = ({ vscode }) => {
    const t = useT();
    const lang = useLang();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [openSessionIds, setOpenSessionIds] = useState<string[]>([]);
    // 检索：输入只过滤标题，正文检索要按回车显式触发（低频需求，不缓存、不在击键路径上读盘）
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [bodyHits, setBodyHits] = useState<Record<string, SessionSearchHit>>({});
    /** 已检索过正文的关键词：与当前输入一致时正文结果才有效 */
    const [bodyQuery, setBodyQuery] = useState('');
    const requestRef = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    // 悬浮预览：鼠标停留片刻后按需读这一条会话的正文（不预读、不在列表刷新时读）
    const [preview, setPreview] = useState<{
        sessionId: string;
        turns: TurnNavItem[];
        pointer: { x: number; y: number };
    } | null>(null);
    const previewElement = useRef<HTMLDivElement>(null);
    const hoverRef = useRef<string | null>(null);
    const hoverTimer = useRef<number | null>(null);
    const previewPointer = useRef<{ sessionId: string; x: number; y: number } | null>(null);
    /** 已算好的那一条（只保留最近一次），鼠标在同一条上来回移动时不再重复读盘 */
    const previewTurns = useRef<{ sessionId: string; turns: TurnNavItem[] } | null>(null);

    useEffect(() => {
        // 接收来自扩展的消息
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'updateSessions':
                    setSessions(message.sessions || []);
                    if (message.currentSessionId !== undefined) {
                        setCurrentSessionId(message.currentSessionId);
                    }
                    setOpenSessionIds(message.openSessionIds || []);
                    // 列表更新意味着正文可能变了，悬浮预览的旧结果不再可信
                    previewTurns.current = null;
                    setPreview(null);
                    break;
                case 'sessionPreviewResult': {
                    const turns: TurnNavItem[] = message.turns || [];
                    previewTurns.current = { sessionId: message.sessionId, turns };
                    const pointer = previewPointer.current;
                    if (hoverRef.current === message.sessionId && pointer?.sessionId === message.sessionId) {
                        setPreview({
                            sessionId: message.sessionId,
                            turns,
                            pointer,
                        });
                    }
                    break;
                }
                case 'searchResults': {
                    // 只认最后一次请求的结果，避免旧查询的结果覆盖当前列表
                    if (message.requestId !== requestRef.current) { return; }
                    setSearching(false);
                    const map: Record<string, SessionSearchHit> = {};
                    for (const hit of message.results || []) { map[hit.id] = hit; }
                    setBodyHits(map);
                    setBodyQuery(message.query || '');
                    break;
                }
                case 'langUpdate':
                    setLang(message.lang);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);

        // 通知扩展组件已准备好
        vscode.postMessage({ type: 'webviewReady' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    // 滚动时预览跟随不上卡片，直接收起（不做重定位，避免滚动中反复弹）
    useEffect(() => {
        const hide = () => {
            hoverRef.current = null;
            previewPointer.current = null;
            if (hoverTimer.current) {
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = null;
            }
            setPreview(null);
        };
        window.addEventListener('scroll', hide, true);
        return () => window.removeEventListener('scroll', hide, true);
    }, []);

    const clearSearch = () => {
        requestRef.current++;
        setQuery('');
        setSearching(false);
        setBodyHits({});
        setBodyQuery('');
    };

    const changeQuery = (value: string) => {
        setQuery(value);
        // 关键词变了就丢掉上一次的正文命中，重新按回车再检
        if (value.trim() !== bodyQuery) {
            requestRef.current++;
            setSearching(false);
            setBodyHits({});
            setBodyQuery('');
        }
    };

    const runSearch = () => {
        const keyword = query.trim();
        if (!keyword) { return; }
        const requestId = ++requestRef.current;
        setSearching(true);
        setBodyHits({});
        setBodyQuery('');
        vscode.postMessage({ type: 'searchSessions', requestId, query: keyword });
    };

    const keyword = query.trim();
    const lowerKeyword = keyword.toLowerCase();
    // 标题命中（零成本）+ 正文命中（显式触发后才有）取并集，展示顺序沿用列表原有排序
    const visibleSessions = keyword
        ? sessions.filter(session => session.title.toLowerCase().includes(lowerKeyword) || Boolean(bodyHits[session.id]))
        : sessions;

    // 内容到达后按实际面板尺寸定位，避免靠近底边时面板盖住鼠标或被截断。
    useLayoutEffect(() => {
        const element = previewElement.current;
        if (!element || !preview) { return; }
        const position = () => {
            const { x, y } = preview.pointer;
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            const maxLeft = Math.max(PREVIEW_EDGE, window.innerWidth - width - PREVIEW_EDGE);
            const maxTop = Math.max(PREVIEW_EDGE, window.innerHeight - height - PREVIEW_EDGE);
            const fitsRight = x + PREVIEW_GAP + width + PREVIEW_EDGE <= window.innerWidth;
            const fitsLeft = x - PREVIEW_GAP - width >= PREVIEW_EDGE;
            const left = fitsRight ? x + PREVIEW_GAP
                : fitsLeft ? x - PREVIEW_GAP - width
                    : Math.min(maxLeft, Math.max(PREVIEW_EDGE, x - width / 2));
            const below = y + PREVIEW_GAP;
            const above = y - PREVIEW_GAP - height;
            const top = below <= maxTop ? below
                : above >= PREVIEW_EDGE ? above
                    : Math.min(maxTop, Math.max(PREVIEW_EDGE, below));
            element.style.left = `${left}px`;
            element.style.top = `${top}px`;
            element.style.visibility = 'visible';
        };
        position();
        window.addEventListener('resize', position);
        return () => window.removeEventListener('resize', position);
    }, [preview]);

    /** 到点弹预览；pointer 是鼠标位置，调用方保证此刻鼠标在卡片内 */
    const schedulePreview = (sessionId: string, pointer: { x: number; y: number }) => {
        if (hoverTimer.current) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        hoverRef.current = sessionId;
        previewPointer.current = { sessionId, ...pointer };
        const known = previewTurns.current;
        if (known?.sessionId === sessionId) {
            // 这一条刚算过（鼠标在同一张卡片上来回移动）：到点直接显示，不再读盘
            hoverTimer.current = window.setTimeout(() => {
                hoverTimer.current = null;
                if (hoverRef.current !== sessionId) { return; }
                setPreview({ sessionId, turns: known.turns, pointer });
            }, PREVIEW_HOVER_DELAY);
            return;
        }
        setPreview(null);
        // 停留足够久才请求：扫过列表、顺路点按钮时不弹预览，也不触发读盘
        hoverTimer.current = window.setTimeout(() => {
            hoverTimer.current = null;
            if (hoverRef.current !== sessionId) { return; }
            vscode.postMessage({ type: 'sessionPreview', sessionId });
        }, PREVIEW_HOVER_DELAY);
    };

    const hoverSession = (event: React.MouseEvent, sessionId: string) => {
        schedulePreview(sessionId, { x: event.clientX, y: event.clientY });
    };

    const leaveSession = () => {
        hoverRef.current = null;
        previewPointer.current = null;
        if (hoverTimer.current) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        setPreview(null);
    };

    const loadSession = (sessionId: string) => {
        vscode.postMessage({
            type: 'loadSession',
            sessionId: sessionId
        });
    };

    const deleteSession = (event: React.MouseEvent, sessionId: string) => {
        event.stopPropagation();
        vscode.postMessage({
            type: 'deleteSession',
            sessionId: sessionId
        });
    };

    const formatTime = (timestamp: number): string => {
        const now = new Date();
        const date = new Date(timestamp);

        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const diffTime = Math.abs(now.getTime() - timestamp);
        const diffDays = Math.floor((today.getTime() - targetDay.getTime()) / (24 * 60 * 60 * 1000));

        const locale = LANGS[lang].dateLocale;
        const timeStr = date.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit'
        });

        // 1分钟内：刚刚
        if (diffTime < 60 * 1000) {
            return t('history.justNow');
        }
        // 1小时内：X分钟前
        else if (diffTime < 60 * 60 * 1000) {
            const minutes = Math.floor(diffTime / (60 * 1000));
            return t('history.minutesAgo', { n: minutes });
        }
        // 今天
        else if (diffDays === 0) {
            return timeStr;
        }
        // 昨天
        else if (diffDays === 1) {
            return t('history.yesterday', { time: timeStr });
        }
        // 7天内
        else if (diffDays < 7) {
            return t('history.daysAgo', { n: diffDays });
        }
        // 今年内
        else if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString(locale, {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        // 跨年
        else {
            return date.toLocaleDateString(locale, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    };

    return (
        <div className="container">
            <div className="header">
                <div className="title">{t('history.title')}</div>
                <div className="search-row">
                    <input
                        ref={inputRef}
                        className="search-input"
                        type="text"
                        value={query}
                        placeholder={t('history.searchPlaceholder')}
                        onChange={(e) => changeQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                runSearch();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                clearSearch();
                            }
                        }}
                    />
                    <button
                        className="search-submit"
                        onClick={runSearch}
                        disabled={searching || !query.trim()}
                    >
                        {searching ? t('history.searching') : t('history.searchAction')}
                    </button>
                </div>
            </div>

            <div className="sessions-container">
                {visibleSessions.length === 0 ? (
                    <div className="empty-state">
                        {!keyword && <div className="empty-icon">📝</div>}
                        <div className="empty-text">{keyword ? t('history.noResults') : t('history.empty')}</div>
                    </div>
                ) : (
                    visibleSessions.map(session => {
                        const hit = bodyHits[session.id];
                        // 活跃会话：临时标记为'current'或与currentSessionId匹配
                        const isActive = session.id === 'current' || session.id === currentSessionId;
                        // 已在 chat 中打开的会话（含活跃会话）
                        const isOpen = isActive || openSessionIds.includes(session.id);
                        // 活跃会话不可点；「打开」态仍可点（点击切到对应 tab）
                        const clickable = !isActive;
                        const itemClass = clickable
                            ? 'session-item'
                            : 'session-item session-current-active';

                        return (
                            <div
                                key={session.id}
                                className={itemClass}
                                onClick={clickable ? () => loadSession(session.id) : undefined}
                                onMouseEnter={(e) => hoverSession(e, session.id)}
                                onMouseLeave={leaveSession}
                            >
                                <div className="session-header">
                                    <div className="session-title-section">
                                        <div className="session-title">
                                            <Highlight text={session.title} query={keyword} />
                                            {session.agentMode === 'Design' && (
                                                <span className="session-mode-design">Design</span>
                                            )}
                                            {isActive && (
                                                <span className="session-status session-status-active">{t('history.active')}</span>
                                            )}
                                            {!isActive && isOpen && (
                                                <span className="session-status session-status-open">{t('history.open')}</span>
                                            )}
                                        </div>
                                    </div>
                                    {/* 活跃 / 打开 的会话不提供删除入口，删除只对未打开的会话显示 */}
                                    {!isOpen && (
                                        <button
                                            className="session-delete"
                                            onClick={(e) => deleteSession(e, session.id)}
                                            onMouseEnter={leaveSession}
                                            onMouseLeave={(e) => hoverSession(e, session.id)}
                                        >
                                            {t('common.delete')}
                                        </button>
                                    )}
                                </div>
                                <div className="session-times">
                                    <div className="session-time">
                                        <span className="time-label">{t('history.createdAt')}</span>
                                        {formatTime(session.createdAt)}
                                    </div>
                                    <div className="session-time">
                                        <span className="time-label">{t('history.updatedAt')}</span>
                                        {formatTime(session.updatedAt)}
                                    </div>
                                </div>
                                {hit && (
                                    <div className="session-snippets">
                                        {hit.snippets.map((snippet, i) => (
                                            <div className="session-snippet" key={i}>
                                                {snippet.before}
                                                <mark>{snippet.match}</mark>
                                                {snippet.after}
                                            </div>
                                        ))}
                                        <div className="session-snippet-count">
                                            {t('history.bodyMatches', { n: hit.count })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {preview && preview.turns.length > 0 && (
                <div
                    ref={previewElement}
                    className="session-preview"
                    style={{ visibility: 'hidden' }}
                >
                    {preview.turns.map((turn, i) => (
                        <div className="session-preview-turn" key={i}>
                            <div className="session-preview-body">
                                <div className="session-preview-title">{turn.title || ' '}</div>
                                {turn.conclusion && (
                                    <div className="session-preview-conclusion">{turn.conclusion}</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default App;
