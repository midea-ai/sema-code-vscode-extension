import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VscodeApi } from './types';
import { LANGS, useLang, useT } from '../common/i18n/react';
import type { I18nKey } from '../common/i18n/react';
import type { UsageRange, UsageRangeSummary, UsageStatsData, UsageTokens } from './types/usage';
import {
    dateKeyOf, formatCount, formatDateFull, formatDateShort, formatMonth, formatPercent,
    formatUpdatedAt, formatUsageTokens, formatWeekday, fromDateKey, toDateKey,
} from '../common/usageFormat';
import './style/section.css';
import './style/usage.css';

/**
 * 「使用情况」页：披露本插件的 token、模型、工具、skill 使用计数。
 * 数据由 core 采集落盘，进入页面拉一次逐日聚合（loadUsageStats），7 / 30 / 365 天的求和在这里做；
 * 停留期间不刷新，切换范围不重新取数。清除走宿主二次确认（clearUsageStats）。
 */

const RANGE_DAYS: Record<UsageRange, number> = { '7d': 7, '30d': 30, '1y': 365 };
const RANGES: UsageRange[] = ['7d', '30d', '1y'];
const TOP_N = 5;
/** 模型长条：低于范围内最大用量的 5% 不画长条，只留名称与数值 */
const MIN_BAR_RATIO = 0.05;
/** 30 天柱状图的 x 轴刻度下标 */
const BAR_LABEL_EVERY = 10;

/** 有中文用途文案的内置工具（key 为 config.usage.tool.<name>） */
const KNOWN_TOOLS = new Set([
    'view_file', 'write_file', 'patch_file', 'run_shell', 'search_files', 'search_content', 'fetch_url',
    'sub_agent', 'skill', 'edit_notebook', 'ask_form', 'plan_to_agent', 'load_tools',
    'create_todo', 'update_todo', 'get_todo', 'list_todos', 'create_cron', 'del_cron', 'list_crons',
    'peek_bg_job', 'stop_bg_job',
]);

const emptyTokens = (): UsageTokens => ({ hit: 0, miss: 0, output: 0 });
const tokenTotal = (t: UsageTokens) => t.hit + t.miss + t.output;
const addTokens = (a: UsageTokens, b: UsageTokens) => { a.hit += b.hit; a.miss += b.miss; a.output += b.output; };

/** 截至 today 的 n 个日期键，升序 */
function datesBack(todayKey: string, n: number): string[] {
    const today = fromDateKey(todayKey);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        out.push(toDateKey(d));
    }
    return out;
}

function summarize(data: UsageStatsData, dates: string[]): UsageRangeSummary {
    const tokens = emptyTokens();
    let requests = 0;
    const sessions = new Set<string>();
    const models = new Map<string, { requests: number; hitKnown: boolean; tokens: UsageTokens }>();
    const tools = new Map<string, { calls: number; errors: number }>();
    const skills = new Map<string, { calls: number; lastAt: number }>();
    for (const key of dates) {
        const day = data.days[key];
        if (!day) continue;
        requests += day.requests;
        addTokens(tokens, day.tokens);
        for (const s of day.sessions) sessions.add(s);
        for (const [name, m] of Object.entries(day.models)) {
            const cur = models.get(name) ?? { requests: 0, hitKnown: false, tokens: emptyTokens() };
            cur.requests += m.requests;
            cur.hitKnown = cur.hitKnown || m.hitKnown;
            addTokens(cur.tokens, m.tokens);
            models.set(name, cur);
        }
        for (const [name, s] of Object.entries(day.tools)) {
            const cur = tools.get(name) ?? { calls: 0, errors: 0 };
            cur.calls += s.calls;
            cur.errors += s.errors;
            tools.set(name, cur);
        }
        for (const [name, s] of Object.entries(day.skills)) {
            const cur = skills.get(name) ?? { calls: 0, lastAt: 0 };
            cur.calls += s.calls;
            cur.lastAt = Math.max(cur.lastAt, s.lastAt);
            skills.set(name, cur);
        }
    }
    return {
        dates,
        requests,
        tokens,
        sessions: sessions.size,
        models: [...models.entries()].map(([name, m]) => ({ name, ...m, total: tokenTotal(m.tokens) })).sort((a, b) => b.total - a.total),
        tools: [...tools.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.calls - a.calls),
        skills: [...skills.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.calls - a.calls),
    };
}

/** y 轴上限：把 max/4 取整到 1 / 2 / 5 × 10^k，共四格 */
function niceAxis(max: number): { step: number; top: number } {
    if (max <= 0) return { step: 1, top: 4 };
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    return { step, top: step * 4 };
}

/** 热力图固定分档：< 100K / 100K–1M / 1M–10M / ≥ 10M；无用量与未记录同样式，不单独分档 */
function heatLevel(value: number): number {
    if (value < 100_000) return 1;
    if (value < 1_000_000) return 2;
    if (value < 10_000_000) return 3;
    return 4;
}

/** 工具显示名：内置工具给用途 + 弱化原始名；MCP 工具给 服务 · 工具，完整名放悬浮；其余原样 */
function useToolLabel() {
    const t = useT();
    return useCallback((name: string): { primary: string; secondary?: string; title?: string } => {
        if (name.startsWith('mcp__')) {
            const rest = name.slice(5);
            const idx = rest.indexOf('__');
            if (idx > 0) return { primary: `${rest.slice(0, idx)} · ${rest.slice(idx + 2)}`, title: name };
            return { primary: name };
        }
        if (KNOWN_TOOLS.has(name)) return { primary: t(`config.usage.tool.${name}` as I18nKey), secondary: name };
        return { primary: name };
    }, [t]);
}

interface HoverTip { x: number; y: number; node: React.ReactNode }

const InfoIcon: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="7" x2="8" y2="11.5" strokeLinecap="round" />
        <circle cx="8" cy="4.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
);

interface UsageConfigProps {
    vscode: VscodeApi;
}

const UsageConfig: React.FC<UsageConfigProps> = ({ vscode }) => {
    const t = useT();
    const lang = useLang();
    const locale = LANGS[lang].dateLocale;
    const toolLabel = useToolLabel();

    const [data, setData] = useState<UsageStatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [range, setRange] = useState<UsageRange>('30d');
    const [capTab, setCapTab] = useState<'tools' | 'skills'>('tools');
    const [showAllTools, setShowAllTools] = useState(false);
    const [showAllSkills, setShowAllSkills] = useState(false);
    const [showAllModels, setShowAllModels] = useState(false);
    const [showErrors, setShowErrors] = useState(false);
    const [mcpOnly, setMcpOnly] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [tip, setTip] = useState<HoverTip | null>(null);
    const pageRef = useRef<HTMLDivElement>(null);

    // 数据截止时间以本次进入页面为准；切换范围不改变
    const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        setTodayKey(toDateKey(new Date()));
        vscode.postMessage({ command: 'loadUsageStats' });
    }, [vscode]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadUsageStatsResult':
                    setLoading(false);
                    if (message.success) {
                        setData(message.data as UsageStatsData);
                        setError(null);
                    } else {
                        setError(message.message || t('common.unknownError'));
                    }
                    break;
                case 'clearUsageStatsResult':
                    setClearing(false);
                    // 清除成功后回到无记录状态并重新计算开始记录日期；取消或失败保持原样
                    if (message.success) load();
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        load();
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const summary = useMemo(() => data ? summarize(data, datesBack(todayKey, RANGE_DAYS[range])) : null, [data, range, todayKey]);
    const rangeHasData = useMemo(() => !!data && !!summary && summary.dates.some(d => !!data.days[d]), [data, summary]);

    // ─── 悬浮提示（柱、热力格、模型长条共用，坐标相对页面容器）───
    const showTip = (e: React.MouseEvent, node: React.ReactNode) => {
        const rect = pageRef.current?.getBoundingClientRect();
        if (!rect) return;
        setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, node });
    };
    const hideTip = () => setTip(null);

    const dayTip = (key: string): React.ReactNode => {
        const day = data?.days[key];
        return (
            <>
                <div className="usage-tip-title">{formatDateFull(key)} · {formatWeekday(key, locale)}</div>
                {day ? (
                    <>
                        <div className="usage-tip-row"><span>{t('config.usage.card.tokens')}</span><span>{formatUsageTokens(tokenTotal(day.tokens))}</span></div>
                        <div className="usage-tip-row"><span>{t('config.usage.card.requests')}</span><span>{t('config.usage.times', { n: formatCount(day.requests) })}</span></div>
                        <div className="usage-tip-row"><span>{t('config.usage.card.sessions')}</span><span>{t('config.usage.sessionsUnit', { n: formatCount(day.sessions.length) })}</span></div>
                    </>
                ) : (
                    <div className="usage-tip-muted">{t('config.usage.unrecorded')}</div>
                )}
            </>
        );
    };

    // ─── 各区块 ───

    const renderBars = () => {
        if (!data || !summary) return null;
        const values = summary.dates.map(d => data.days[d] ? tokenTotal(data.days[d].tokens) : null);
        const max = Math.max(0, ...values.map(v => v ?? 0));
        const axis = niceAxis(max);
        const ticks = [4, 3, 2, 1, 0].map(i => axis.step * i);
        const n = summary.dates.length;
        const labelIdx = new Set<number>(n <= 7 ? summary.dates.map((_, i) => i) : [0, ...summary.dates.map((_, i) => i).filter(i => i > 0 && i % BAR_LABEL_EVERY === 0 && n - 1 - i >= 4), n - 1]);
        return (
            <div className="usage-bars">
                <div className="usage-bars-axis">
                    {ticks.map(v => <span key={v}>{formatUsageTokens(v)}</span>)}
                </div>
                <div className="usage-bars-plot">
                    <div className="usage-bars-grid">
                        {ticks.map(v => <div key={v} className="usage-bars-gridline" />)}
                    </div>
                    <div className="usage-bars-cols">
                        {summary.dates.map((key, i) => {
                            const v = values[i];
                            const pct = v === null ? 0 : Math.max(v > 0 ? 1 : 0, (v / axis.top) * 100);
                            return (
                                <div
                                    key={key}
                                    className={`usage-bar-col${v === null ? ' unrecorded' : ''}`}
                                    onMouseEnter={e => showTip(e, dayTip(key))}
                                    onMouseMove={e => showTip(e, dayTip(key))}
                                    onMouseLeave={hideTip}
                                >
                                    {v !== null && <div className={`usage-bar${v === 0 ? ' zero' : ''}`} style={{ height: `${pct}%` }} />}
                                </div>
                            );
                        })}
                    </div>
                    <div className="usage-bars-labels">
                        {summary.dates.map((key, i) => (
                            <div key={key} className="usage-bar-label">
                                {labelIdx.has(i) ? <span>{formatDateShort(key, todayKey)}</span> : null}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderHeatmap = () => {
        if (!data || !summary) return null;
        const first = fromDateKey(summary.dates[0]);
        // 列为周，行为周日到周六；首列从范围首日所在周的周日开始，尾列补到周六
        const startOffset = first.getDay();
        const gridStart = new Date(first);
        gridStart.setDate(first.getDate() - startOffset);
        const totalDays = startOffset + summary.dates.length;
        const weeks = Math.ceil(totalDays / 7);
        const inRange = new Set(summary.dates);

        const columns: { key: string; date: Date }[][] = [];
        for (let w = 0; w < weeks; w++) {
            const col: { key: string; date: Date }[] = [];
            for (let r = 0; r < 7; r++) {
                const d = new Date(gridStart);
                d.setDate(gridStart.getDate() + w * 7 + r);
                col.push({ key: toDateKey(d), date: d });
            }
            columns.push(col);
        }
        // 月份标签：月份切换的列标出；开头的残月不标（除非范围恰好从 1 号开始）；相邻太近则跳过
        const monthLabels: { col: number; text: string }[] = [];
        let prevMonth = first.getDate() === 1 ? -1 : first.getMonth();
        let lastLabelCol = -10;
        columns.forEach((col, i) => {
            const firstIn = col.find(c => inRange.has(c.key));
            if (!firstIn) return;
            const m = firstIn.date.getMonth();
            if (m !== prevMonth) {
                if (i - lastLabelCol >= 3) {
                    monthLabels.push({ col: i, text: formatMonth(firstIn.date, locale) });
                    lastLabelCol = i;
                }
                prevMonth = m;
            }
        });
        return (
            <div className="usage-heat-wrap">
                <div className="usage-heat" style={{ gridTemplateColumns: `repeat(${weeks}, var(--usage-cell))` }}>
                    {columns.map((_, i) => {
                        const label = monthLabels.find(m => m.col === i);
                        return <div key={i} className="usage-heat-month">{label ? label.text : ''}</div>;
                    })}
                    {[0, 1, 2, 3, 4, 5, 6].map(r => (
                        <React.Fragment key={r}>
                            {columns.map((col, i) => {
                                const cell = col[r];
                                if (!inRange.has(cell.key)) return <div key={i} className="usage-cell outside" />;
                                const total = data.days[cell.key] ? tokenTotal(data.days[cell.key].tokens) : 0;
                                const cls = total > 0 ? `l${heatLevel(total)}` : 'unrecorded';
                                return (
                                    <div
                                        key={i}
                                        className={`usage-cell ${cls}`}
                                        onMouseEnter={e => showTip(e, dayTip(cell.key))}
                                        onMouseMove={e => showTip(e, dayTip(cell.key))}
                                        onMouseLeave={hideTip}
                                    />
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        );
    };

    const renderTools = () => {
        if (!summary) return null;
        if (!summary.tools.length) return <div className="usage-empty">{t('config.usage.emptyTools')}</div>;
        // 「只看 MCP 工具」：范围内有 MCP 工具才提供，开启后汇总、列表、异常都只算 MCP 工具
        const hasMcp = summary.tools.some(x => x.name.startsWith('mcp__'));
        const tools = mcpOnly && hasMcp ? summary.tools.filter(x => x.name.startsWith('mcp__')) : summary.tools;
        const totalCalls = tools.reduce((s, x) => s + x.calls, 0);
        const totalErrors = tools.reduce((s, x) => s + x.errors, 0);
        const max = tools[0].calls;
        const visible = showAllTools ? tools : tools.slice(0, TOP_N);
        const failed = tools.filter(x => x.errors > 0).sort((a, b) => b.errors - a.errors);
        return (
            <>
                <div className="usage-cap-summary usage-cap-summary-row">
                    <span>{t('config.usage.toolsSummary', { kinds: tools.length, calls: formatCount(totalCalls) })}</span>
                    {hasMcp && (
                        <label className="usage-check">
                            <input type="checkbox" checked={mcpOnly} onChange={e => setMcpOnly(e.target.checked)} />
                            {t('config.usage.mcpOnly')}
                        </label>
                    )}
                </div>
                <div className="usage-rows">
                    {visible.map(x => {
                        const label = toolLabel(x.name);
                        return (
                            <div className="usage-row" key={x.name}>
                                <div className="usage-row-name" title={label.title ?? x.name}>
                                    <span>{label.primary}</span>
                                    {label.secondary && <span className="usage-row-sub">{label.secondary}</span>}
                                </div>
                                <div className="usage-row-bar"><div className="usage-row-fill" style={{ width: `${(x.calls / max) * 100}%` }} /></div>
                                <div className="usage-row-value">{t('config.usage.times', { n: formatCount(x.calls) })}</div>
                            </div>
                        );
                    })}
                </div>
                <div className="usage-row-actions">
                    {tools.length > TOP_N && (
                        <button type="button" className="usage-link" onClick={() => setShowAllTools(v => !v)}>
                            {showAllTools ? t('config.usage.showLess') : t('config.usage.showAll', { n: tools.length })}
                        </button>
                    )}
                    <span className="usage-row-actions-spacer" />
                    {totalErrors > 0 && (
                        <button type="button" className={`usage-link usage-errors-toggle${showErrors ? ' open' : ''}`} onClick={() => setShowErrors(v => !v)}>
                            <span className="usage-errors-arrow">▸</span>{t('config.usage.errorsEntry', { n: formatCount(totalErrors) })}
                        </button>
                    )}
                </div>
                {totalErrors > 0 && showErrors && (
                    <div className="usage-errors">
                        <table className="usage-table">
                            <thead>
                                <tr><th>{t('config.usage.col.tool')}</th><th className="num">{t('config.usage.col.errors')}</th><th className="num">{t('config.usage.col.errorRate')}</th></tr>
                            </thead>
                            <tbody>
                                {failed.map(x => (
                                    <tr key={x.name}>
                                        <td title={x.name}>{toolLabel(x.name).primary}</td>
                                        <td className="num">{t('config.usage.times', { n: formatCount(x.errors) })}</td>
                                        <td className="num">{formatPercent(x.errors / x.calls)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="usage-note">{t('config.usage.errorsNote')}</div>
                    </div>
                )}
            </>
        );
    };

    const renderSkills = () => {
        if (!summary) return null;
        const skills = summary.skills;
        if (!skills.length) return <div className="usage-empty">{t('config.usage.emptySkills')}</div>;
        const totalCalls = skills.reduce((s, x) => s + x.calls, 0);
        const visible = showAllSkills ? skills : skills.slice(0, TOP_N);
        return (
            <>
                <div className="usage-cap-summary">{t('config.usage.skillsSummary', { kinds: skills.length, calls: formatCount(totalCalls) })}</div>
                <table className="usage-table">
                    <thead>
                        <tr><th>{t('config.usage.col.skill')}</th><th className="num">{t('config.usage.col.calls')} ↓</th><th className="num">{t('config.usage.col.lastUsed')}</th></tr>
                    </thead>
                    <tbody>
                        {visible.map(x => (
                            <tr key={x.name}>
                                <td title={x.name}>{x.name}</td>
                                <td className="num">{t('config.usage.times', { n: formatCount(x.calls) })}</td>
                                <td className="num">{formatDateShort(dateKeyOf(x.lastAt), todayKey)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {skills.length > TOP_N && (
                    <div className="usage-row-actions">
                        <button type="button" className="usage-link" onClick={() => setShowAllSkills(v => !v)}>
                            {showAllSkills ? t('config.usage.showLess') : t('config.usage.showAll', { n: skills.length })}
                        </button>
                    </div>
                )}
            </>
        );
    };

    const renderModels = () => {
        if (!summary) return null;
        const models = summary.models;
        if (!models.length) return <div className="usage-empty">{t('config.usage.emptyModels')}</div>;
        const grand = models.reduce((s, m) => s + m.total, 0);
        const max = models[0].total;
        const visible = showAllModels ? models : models.slice(0, TOP_N);
        const modelTip = (m: typeof models[number]): React.ReactNode => {
            const input = m.tokens.hit + m.tokens.miss;
            const hitRate = !m.hitKnown ? t('config.usage.hitRateUnknown') : input === 0 ? '—' : formatPercent(m.tokens.hit / input);
            return (
                <>
                    <div className="usage-tip-title">{m.name}</div>
                    <div className="usage-tip-row"><span>{t('config.usage.card.tokens')}</span><span>{formatUsageTokens(m.total)}</span></div>
                    <div className="usage-tip-row"><span>{t('config.usage.share')}</span><span>{grand ? formatPercent(m.total / grand) : '—'}</span></div>
                    <div className="usage-tip-sep" />
                    {/* 服务商未提供缓存信息时，输入全部记在非缓存输入，缓存输入与命中率显示为未知 */}
                    <div className="usage-tip-row"><span><i className="usage-swatch hit" />{t('config.usage.hit')}</span><span>{m.hitKnown ? formatUsageTokens(m.tokens.hit) : '—'}</span></div>
                    <div className="usage-tip-row"><span><i className="usage-swatch miss" />{t('config.usage.miss')}</span><span>{formatUsageTokens(m.tokens.miss)}</span></div>
                    <div className="usage-tip-row"><span><i className="usage-swatch output" />{t('config.usage.output')}</span><span>{formatUsageTokens(m.tokens.output)}</span></div>
                    <div className="usage-tip-sep" />
                    <div className="usage-tip-row"><span>{t('config.usage.hitRate')}</span><span>{hitRate}</span></div>
                </>
            );
        };
        return (
            <>
                <div className="usage-legend">
                    <span><i className="usage-swatch hit" />{t('config.usage.hit')}</span>
                    <span><i className="usage-swatch miss" />{t('config.usage.miss')}</span>
                    <span><i className="usage-swatch output" />{t('config.usage.output')}</span>
                </div>
                <div className="usage-models-head">
                    <span>{t('config.usage.col.model')}</span>
                    <span>{t('config.usage.col.composition')} ↓</span>
                </div>
                <div className="usage-rows">
                    {visible.map(m => {
                        const drawBar = max > 0 && m.total / max >= MIN_BAR_RATIO;
                        const width = max > 0 ? (m.total / max) * 100 : 0;
                        const seg = (v: number) => m.total > 0 ? `${(v / m.total) * 100}%` : '0%';
                        return (
                            <div className="usage-row usage-model-row" key={m.name}>
                                <div className="usage-row-name" title={m.name} onMouseEnter={e => showTip(e, modelTip(m))} onMouseMove={e => showTip(e, modelTip(m))} onMouseLeave={hideTip}>
                                    <span>{m.name}</span>
                                </div>
                                <div className="usage-model-bar-wrap">
                                    {drawBar && (
                                        <div className="usage-model-bar" style={{ width: `${width}%` }} onMouseEnter={e => showTip(e, modelTip(m))} onMouseMove={e => showTip(e, modelTip(m))} onMouseLeave={hideTip}>
                                            <i className="usage-seg hit" style={{ width: seg(m.tokens.hit) }} />
                                            <i className="usage-seg miss" style={{ width: seg(m.tokens.miss) }} />
                                            <i className="usage-seg output" style={{ width: seg(m.tokens.output) }} />
                                        </div>
                                    )}
                                    <span className="usage-model-total" onMouseEnter={e => showTip(e, modelTip(m))} onMouseMove={e => showTip(e, modelTip(m))} onMouseLeave={hideTip}>
                                        {formatUsageTokens(m.total)}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                {models.length > TOP_N && (
                    <div className="usage-row-actions">
                        <button type="button" className="usage-link" onClick={() => setShowAllModels(v => !v)}>
                            {showAllModels ? t('config.usage.showLess') : t('config.usage.showAll', { n: models.length })}
                        </button>
                    </div>
                )}
            </>
        );
    };

    // ─── 页面 ───

    if (loading && !data) {
        return <div className="section-loading">{t('common.loading')}</div>;
    }
    if (error && !data) {
        return (
            <div className="usage-failed">
                <span>{t('config.usage.loadFailed')}</span>
                <button type="button" className="usage-link" onClick={load}>{t('config.usage.retry')}</button>
            </div>
        );
    }
    if (!data || !summary) return null;

    const rangeLabel = `${formatDateFull(summary.dates[0])}–${formatDateFull(summary.dates[summary.dates.length - 1])}`;
    const tipStyle: React.CSSProperties | undefined = tip
        ? (pageRef.current && tip.x > pageRef.current.clientWidth / 2
            ? { left: tip.x - 12, top: tip.y + 14, transform: 'translateX(-100%)' }
            : { left: tip.x + 12, top: tip.y + 14 })
        : undefined;

    return (
        <div className="usage-page" ref={pageRef}>
            <div className="usage-header">
                <h2 className="usage-title">
                    {t('config.usage.title')}
                    {data.since && (
                        <span className="usage-info" tabIndex={0} aria-label={t('config.usage.info', { date: formatDateFull(data.since) })}>
                            <InfoIcon />
                            <span className="usage-info-bubble" role="tooltip">{t('config.usage.info', { date: formatDateFull(data.since) })}</span>
                        </span>
                    )}
                </h2>
                {data.since && (
                    <div className="usage-totals">
                        {t('config.usage.summary', { tokens: formatUsageTokens(tokenTotal(data.totals.tokens)), sessions: formatCount(data.totals.sessions), days: formatCount(data.totals.days) })}
                    </div>
                )}
            </div>

            {!data.since ? (
                <div className="section-empty">{t('config.usage.emptyAll')}</div>
            ) : (
                <>
                    <div className="usage-block">
                        <div className="usage-range-bar">
                            <div className="usage-pills">
                                {RANGES.map(r => (
                                    <button type="button" key={r} className={`usage-pill${range === r ? ' active' : ''}`} onClick={() => setRange(r)}>
                                        {t(`config.usage.range.${r}` as I18nKey)}
                                    </button>
                                ))}
                            </div>
                            <span className="usage-range-label">{rangeLabel}</span>
                        </div>
                        <div className="usage-cards">
                            <div className="usage-card"><div className="usage-card-label">{t('config.usage.card.tokens')}</div><div className="usage-card-value">{formatUsageTokens(tokenTotal(summary.tokens))}</div></div>
                            <div className="usage-card"><div className="usage-card-label">{t('config.usage.card.requests')}</div><div className="usage-card-value">{t('config.usage.times', { n: formatCount(summary.requests) })}</div></div>
                            <div className="usage-card"><div className="usage-card-label">{t('config.usage.card.sessions')}</div><div className="usage-card-value">{t('config.usage.sessionsUnit', { n: formatCount(summary.sessions) })}</div></div>
                        </div>
                        <div className="usage-section-title">{t('config.usage.trend')}</div>
                        <div className="usage-trend">
                            {!rangeHasData ? <div className="usage-empty">{t('config.usage.emptyRange')}</div> : range === '1y' ? renderHeatmap() : renderBars()}
                        </div>
                    </div>

                    <div className="usage-block">
                        <div className="usage-section-title">{t('config.usage.models')}</div>
                        {renderModels()}
                    </div>

                    <div className="usage-block">
                        <div className="usage-section-title">{t('config.usage.capability')}</div>
                        <div className="usage-pills usage-pills-sub">
                            <button type="button" className={`usage-pill${capTab === 'tools' ? ' active' : ''}`} onClick={() => setCapTab('tools')}>{t('config.usage.tab.tools')}</button>
                            <button type="button" className={`usage-pill${capTab === 'skills' ? ' active' : ''}`} onClick={() => setCapTab('skills')}>{t('config.usage.tab.skills')}</button>
                        </div>
                        {capTab === 'tools' ? renderTools() : renderSkills()}
                    </div>

                </>
            )}

            <div className="usage-footer">
                <span className="usage-footer-note">
                    {t('config.usage.localOnly')}
                    {' · '}
                    {error ? t('config.usage.loadFailed') : t('config.usage.updatedAt', { time: formatUpdatedAt(data.updatedAt, new Date()) })}
                    {error && <>{' '}<button type="button" className="usage-link" onClick={load}>{t('config.usage.retry')}</button></>}
                </span>
                {data.since && (
                    <button type="button" className="usage-link usage-clear" disabled={clearing} onClick={() => { setClearing(true); vscode.postMessage({ command: 'clearUsageStats' }); }}>
                        {t('config.usage.clear')}
                    </button>
                )}
            </div>

            {tip && <div className="usage-tip" style={tipStyle}>{tip.node}</div>}
        </div>
    );
};

export default UsageConfig;
