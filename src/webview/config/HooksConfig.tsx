import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, OpenIcon } from './utils/svgIcons';
import { HooksInfo, HookEntryInfo, HookSource, HOOK_EVENTS, TOOL_HOOK_EVENTS } from './types/hook';
import { openFileWithRange } from './utils/fileUtils';
import './style/section.css';
import './style/agent.css';
import './style/hook.css';

interface HooksConfigProps {
    vscode: VscodeApi;
}

const SOURCE_ORDER: HookSource[] = ['project', 'user'];

const SOURCE_SECTION_TITLES: Record<HookSource, string> = {
    project: '项目级 Hooks',
    user: '用户级 Hooks'
};

const SOURCE_PATHS: Record<HookSource, string> = {
    project: '.sema/hooks/hooks.json',
    user: '~/.sema/hooks/hooks.json'
};

const STATUS_LABELS: Record<string, string> = {
    skipped: '已跳过',
    invalid: '无效'
};

const HooksConfig: React.FC<HooksConfigProps> = ({ vscode }) => {
    const [hooksInfo, setHooksInfo] = useState<HooksInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // 按来源分组，同一事件的多条 hook 合并为一组（一张卡片），事件按 HOOK_EVENTS 固定顺序排列
    const groupedEvents = useMemo(() => {
        const groups: Record<HookSource, Array<{ event: string; entries: HookEntryInfo[] }>> = { project: [], user: [] };
        if (!hooksInfo?.events) return groups;
        const knownEvents = HOOK_EVENTS.filter(e => hooksInfo.events[e]);
        const extraEvents = Object.keys(hooksInfo.events).filter(e => !(HOOK_EVENTS as readonly string[]).includes(e));
        [...knownEvents, ...extraEvents].forEach(event => {
            (hooksInfo.events[event] || []).forEach(entry => {
                const list = groups[entry.source];
                if (!list) return;
                const existing = list.find(g => g.event === event);
                if (existing) existing.entries.push(entry); else list.push({ event, entries: [entry] });
            });
        });
        return groups;
    }, [hooksInfo]);

    const totalCount = [...groupedEvents.project, ...groupedEvents.user]
        .reduce((sum, g) => sum + g.entries.length, 0);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case 'loadHooksInfoResult':
                    if (message.success) {
                        setHooksInfo(message.data || null);
                    }
                    setLoading(false);
                    break;
                case 'refreshHooksInfoResult':
                    setIsRefreshing(false);
                    if (message.success) {
                        setHooksInfo(message.data || null);
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);

        // 加载 hooks 信息
        vscode.postMessage({ command: 'loadHooksInfo' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscode]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshHooks' });
    };

    // 打开对应来源的 hooks.json 配置文件
    const handleOpenConfig = (source: HookSource) => {
        const filePath = source === 'user' ? hooksInfo?.userConfigPath : hooksInfo?.projectConfigPath;
        if (filePath) {
            vscode.postMessage({ command: 'openFile', filePath });
        }
    };

    // 打开配置文件并选中该事件块对应的行范围（旧版 core 无 filePath 时退化为整文件打开）
    const handleOpenEntry = (source: HookSource, entries: HookEntryInfo[]) => {
        const filePath = entries.find(e => e.filePath)?.filePath;
        if (filePath) {
            openFileWithRange(vscode, filePath);
        } else {
            handleOpenConfig(source);
        }
    };

    if (loading) {
        return (
            <div className="agent-config">
                <div className="section-loading">加载中...</div>
            </div>
        );
    }

    // 渲染单个事件卡片（同一事件的多条 hook 合并展示）
    const renderEventCard = (source: HookSource, event: string, entries: HookEntryInfo[], key: string) => {
        const isToolEvent = TOOL_HOOK_EVENTS.has(event);

        return (
            <div key={key} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(event) }}>
                        {event.charAt(0).toUpperCase()}
                    </div>
                    <div className="section-card-name-group">
                        <span className="section-card-name">{event}</span>
                        {entries.length > 1 && (
                            <span className="section-tab-count">{entries.length}</span>
                        )}
                    </div>
                    <div className="section-card-actions">
                        <button
                            className="section-icon-btn"
                            title={`打开 ${SOURCE_PATHS[source]}`}
                            onClick={(e) => { e.stopPropagation(); handleOpenEntry(source, entries); }}
                        >
                            <OpenIcon />
                        </button>
                    </div>
                </div>
                {entries.map((entry, i) => (
                    <div key={i} className="hook-entry">
                        <div className="hook-command-row">
                            <span className="tools-label">命令:</span>
                            <code className="hook-command">{entry.command || '（空）'}</code>
                            {entry.status !== 'ok' && (
                                <span className={`hook-status-tag hook-status-${entry.status}`} title={entry.statusReason || ''}>
                                    {STATUS_LABELS[entry.status] || entry.status}
                                </span>
                            )}
                        </div>
                        {(isToolEvent || !!entry.timeout) && (
                            <div className="agent-tools">
                                {isToolEvent && (
                                    <>
                                        <span className="tools-label">匹配:</span>
                                        <span className="tool-tag">{entry.matcher || '*'}</span>
                                    </>
                                )}
                                {!!entry.timeout && (
                                    <>
                                        <span className="tools-label">超时:</span>
                                        <span className="tool-tag">{entry.timeout}s</span>
                                    </>
                                )}
                            </div>
                        )}
                        {entry.status !== 'ok' && entry.statusReason && (
                            <div className="hook-status-reason">{entry.statusReason}</div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div className="tab-item active">
                    已安装
                    {totalCount > 0 && (
                        <span className="section-tab-count">{totalCount}</span>
                    )}
                </div>
                <div className="section-tab-actions">
                    <button
                        className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title="刷新 Hooks"
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? (
                            <span className="spinner" />
                        ) : (
                            <RefreshIcon size={14} />
                        )}
                    </button>
                </div>
            </div>

            {/* Tab 内容 */}
            <div className="tab-content">
                {hooksInfo?.parseErrors?.map((err, i) => (
                    <div key={i} className="hook-banner hook-banner-error">
                        {SOURCE_SECTION_TITLES[err.source]}配置解析失败：{err.message}
                    </div>
                ))}
                <div className="section-groups">
                    {SOURCE_ORDER.map(source => {
                        const sectionGroups = groupedEvents[source];
                        const configExists = source === 'user' ? hooksInfo?.userConfigExists : hooksInfo?.projectConfigExists;

                        const isCollapsed = collapsedSections.has(source);
                        const toggleCollapse = () => setCollapsedSections(prev => {
                            const next = new Set(prev);
                            if (next.has(source)) next.delete(source); else next.add(source);
                            return next;
                        });

                        return (
                            <div key={source} className={`section-group section-${source}`}>
                                <div className="section-group-title section-group-title-collapsible" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={toggleCollapse}>
                                    {SOURCE_SECTION_TITLES[source]}
                                    <span className="section-group-count">({SOURCE_PATHS[source]})</span>
                                    {configExists && (
                                        <button
                                            className="section-icon-btn"
                                            title={`打开 ${SOURCE_PATHS[source]}`}
                                            onClick={(e) => { e.stopPropagation(); handleOpenConfig(source); }}
                                        >
                                            <OpenIcon />
                                        </button>
                                    )}
                                    <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                </div>
                                {!isCollapsed && (sectionGroups.length === 0 ? (
                                    <div className="section-empty">暂无 Hook</div>
                                ) : (
                                    <div className="section-list">
                                        {sectionGroups.map(group =>
                                            renderEventCard(source, group.event, group.entries, `${source}-${group.event}`)
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default HooksConfig;
