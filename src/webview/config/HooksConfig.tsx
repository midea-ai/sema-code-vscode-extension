import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, OpenIcon, TrashIcon, PlusIcon } from './utils/svgIcons';
import { HooksInfo, HookEntryInfo, HookConfig, HookSource, HOOK_EVENTS, TOOL_HOOK_EVENTS } from './types/hook';
import AddHookModal from './AddHookModal';
import { openFileWithRange } from './utils/fileUtils';
import { uiScope } from './utils/scope';
import { useT, I18nKey } from '../common/i18n/react';
import './style/section.css';
import './style/agent.css';
import './style/hook.css';

interface HooksConfigProps {
    vscode: VscodeApi;
}

const SOURCE_ORDER: HookSource[] = ['builtin', 'project', 'user', 'plugin'];

// 分组标题 / 状态文案 key，渲染期经 t() 取值
const SOURCE_SECTION_TITLE_KEYS: Record<HookSource, I18nKey> = {
    builtin: 'config.hooks.group.builtin',
    project: 'config.hooks.group.project',
    user: 'config.hooks.group.user',
    plugin: 'config.hooks.group.plugin'
};

// 内置（宿主注入）hooks 无配置文件；插件 hooks 各自在插件目录下，无统一路径
const SOURCE_PATHS: Record<HookSource, string> = {
    builtin: '',
    project: '.sema/hooks/hooks.json',
    user: '~/.sema/hooks/hooks.json',
    plugin: ''
};

interface HookEventGroup {
    event: string;
    /** 仅插件来源：同一事件按插件拆成多张卡片 */
    pluginName?: string;
    entries: HookEntryInfo[];
}

const STATUS_LABEL_KEYS: Record<string, I18nKey> = {
    skipped: 'config.hooks.status.skipped',
    invalid: 'config.hooks.status.invalid'
};

/** 删除确认框里的条目名：hook 没有名字，用 事件 + 命令 指代，命令过长截断 */
const CONFIRM_COMMAND_MAX = 80;

const HooksConfig: React.FC<HooksConfigProps> = ({ vscode }) => {
    const t = useT();
    const [showAddModal, setShowAddModal] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [hooksInfo, setHooksInfo] = useState<HooksInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // 按来源分组，同一事件的多条 hook 合并为一组（一张卡片），事件按 HOOK_EVENTS 固定顺序排列
    const groupedEvents = useMemo(() => {
        const groups: Record<HookSource, HookEventGroup[]> = { builtin: [], project: [], user: [], plugin: [] };
        if (!hooksInfo?.events) return groups;
        const knownEvents = HOOK_EVENTS.filter(e => hooksInfo.events[e]);
        const extraEvents = Object.keys(hooksInfo.events).filter(e => !(HOOK_EVENTS as readonly string[]).includes(e));
        [...knownEvents, ...extraEvents].forEach(event => {
            (hooksInfo.events[event] || []).forEach(entry => {
                // 宿主注入的归为内置分组
                const list = groups[uiScope(entry.source)];
                if (!list) return;
                const existing = list.find(g => g.event === event && g.pluginName === entry.pluginName);
                if (existing) existing.entries.push(entry); else list.push({ event, pluginName: entry.pluginName, entries: [entry] });
            });
        });
        return groups;
    }, [hooksInfo]);

    const totalCount = [...groupedEvents.builtin, ...groupedEvents.project, ...groupedEvents.user, ...groupedEvents.plugin]
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
                case 'addHookResult':
                case 'removeHookResult':
                case 'toggleHookResult':
                    // 添加：成功失败都收起弹窗（失败原因由宿主提示）
                    if (message.command === 'addHookResult') {
                        setIsAdding(false);
                        setShowAddModal(false);
                    }
                    // 增删启停都带回最新视图，直接覆盖；失败时重拉恢复真实状态（回滚开关的乐观更新）
                    if (message.success && message.data) {
                        setHooksInfo(message.data);
                    } else if (!message.success) {
                        vscode.postMessage({ command: 'loadHooksInfo' });
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

    // 手动添加：弹窗已校验格式，宿主逐条调 core 的新增接口（已存在的条目 core 不重复写），带回最新视图
    const handleAddHooks = (items: HookConfig[]) => {
        setIsAdding(true);
        vscode.postMessage({ command: 'addHook', data: items });
    };

    // 打开对应来源的 hooks.json 配置文件
    const handleOpenConfig = (source: HookSource) => {
        if (source === 'plugin' || source === 'builtin') return;
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

    // 写入哪层 settings 由 core 按条目所在层决定（项目级条目→项目级，用户级 / 插件→用户级全局）
    const handleToggleHook = (entry: HookEntryInfo, enabled: boolean) => {
        // 先本地乐观更新（内容相同的重复条目共用 id，一起变），结果消息回来后以真实数据为准
        setHooksInfo(prev => prev && {
            ...prev,
            events: Object.fromEntries(Object.entries(prev.events).map(([event, list]) =>
                [event, list.map(e => e.id === entry.id ? { ...e, enabled } : e)]
            ))
        });
        vscode.postMessage({ command: 'toggleHook', id: entry.id, enabled });
    };

    const handleDeleteHook = (entry: HookEntryInfo) => {
        const command = entry.command.length > CONFIRM_COMMAND_MAX ? entry.command.slice(0, CONFIRM_COMMAND_MAX) + '...' : entry.command;
        vscode.postMessage({ command: 'removeHook', id: entry.id, name: `${entry.event}: ${command}` });
    };

    if (loading) {
        return (
            <div className="agent-config">
                <div className="section-loading">{t('common.loading')}</div>
            </div>
        );
    }

    // 渲染单个事件卡片（同一事件的多条 hook 合并展示）
    const renderEventCard = (source: HookSource, group: HookEventGroup, key: string) => {
        const { event, pluginName, entries } = group;
        const isToolEvent = TOOL_HOOK_EVENTS.has(event);
        // 内置 / 插件 hooks 只能靠 entry.filePath 定位，没有则不给打开入口
        const hasOwnConfig = source === 'project' || source === 'user';
        const canOpen = hasOwnConfig || entries.some(e => e.filePath);

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
                        {pluginName && (
                            <span className="readonly-tab">{pluginName}</span>
                        )}
                    </div>
                    {canOpen && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title={hasOwnConfig ? t('config.hooks.openFile', { path: SOURCE_PATHS[source] }) : t('common.open')}
                                onClick={(e) => { e.stopPropagation(); handleOpenEntry(source, entries); }}
                            >
                                <OpenIcon />
                            </button>
                        </div>
                    )}
                </div>
                {entries.map((entry, i) => {
                    // 旧版 core 无 id / enabled：不给开关和删除，按启用展示
                    const isDisabled = entry.enabled === false;
                    // 开关：状态正常的非内置条目（插件条目可启停）；删除：只有项目级 / 用户级条目（插件条目只能禁用）
                    const canToggle = !!entry.id && source !== 'builtin' && entry.status === 'ok';
                    const canDelete = !!entry.id && hasOwnConfig;
                    return (
                    <div key={i} className={`hook-entry ${isDisabled ? 'hook-entry-disabled' : ''}`}>
                        <div className="hook-command-row">
                            <span className="tools-label">{t('config.hooks.commandLabel')}</span>
                            <code className="hook-command" title={entry.command}>{entry.command || t('config.hooks.emptyCommand')}</code>
                            {entry.status !== 'ok' && (
                                <span className={`hook-status-tag hook-status-${entry.status}`} title={entry.statusReason || ''}>
                                    {STATUS_LABEL_KEYS[entry.status] ? t(STATUS_LABEL_KEYS[entry.status]) : entry.status}
                                </span>
                            )}
                            {(canToggle || canDelete) && (
                                <div className="hook-entry-actions">
                                    {canDelete && (
                                        <button
                                            className="section-icon-btn section-icon-btn-danger"
                                            title={t('common.delete')}
                                            onClick={(e) => { e.stopPropagation(); handleDeleteHook(entry); }}
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                    {canToggle && (
                                        <label className="section-switch" title={isDisabled ? (source === 'project' ? t('config.skill.disabledProject') : t('config.skill.disabledGlobal')) : t('config.skill.enabled')}>
                                            <input
                                                type="checkbox"
                                                checked={!isDisabled}
                                                onChange={(e) => handleToggleHook(entry, e.target.checked)}
                                            />
                                            <span className="section-switch-slider"></span>
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>
                        {(isToolEvent || !!entry.timeout) && (
                            <div className="agent-tools">
                                {isToolEvent && (
                                    <>
                                        <span className="tools-label">{t('config.hooks.matcherLabel')}</span>
                                        <span className="tool-tag">{entry.matcher || '*'}</span>
                                    </>
                                )}
                                {!!entry.timeout && (
                                    <>
                                        <span className="tools-label">{t('config.hooks.timeoutLabel')}</span>
                                        <span className="tool-tag">{entry.timeout}s</span>
                                    </>
                                )}
                            </div>
                        )}
                        {entry.status !== 'ok' && entry.statusReason && (
                            <div className="hook-status-reason">{entry.statusReason}</div>
                        )}
                    </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div className="tab-item active">
                    {t('common.installed')}
                    {totalCount > 0 && (
                        <span className="section-tab-count">{totalCount}</span>
                    )}
                </div>
                <div className="section-tab-actions">
                    <button
                        className="section-btn primary small"
                        onClick={() => setShowAddModal(true)}
                        title={t('config.hooks.manualAddTip')}
                    >
                        <PlusIcon />
                        {t('config.mcp.manualAdd')}
                    </button>
                    <button
                        className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title={t('config.hooks.refresh')}
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
                        {t('config.hooks.parseError', {
                            source: err.source === 'plugin' && err.pluginName
                                ? t('config.hooks.pluginSource', { name: err.pluginName })
                                : t(SOURCE_SECTION_TITLE_KEYS[uiScope(err.source)]),
                            message: err.message
                        })}
                    </div>
                ))}
                <div className="section-groups">
                    {SOURCE_ORDER.map(source => {
                        const sectionGroups = groupedEvents[source];
                        // 项目级 / 用户级 始终显示；内置 / 插件级为空时隐藏
                        if (sectionGroups.length === 0 && (source === 'builtin' || source === 'plugin')) return null;
                        const configExists = source === 'user' ? hooksInfo?.userConfigExists
                            : source === 'project' ? hooksInfo?.projectConfigExists
                            : false;

                        const isCollapsed = collapsedSections.has(source);
                        const toggleCollapse = () => setCollapsedSections(prev => {
                            const next = new Set(prev);
                            if (next.has(source)) next.delete(source); else next.add(source);
                            return next;
                        });

                        return (
                            <div key={source} className={`section-group section-${source}`}>
                                <div className="section-group-title section-group-title-collapsible" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={toggleCollapse}>
                                    {t(SOURCE_SECTION_TITLE_KEYS[source])}
                                    {SOURCE_PATHS[source] && (
                                        <span className="section-group-count">({SOURCE_PATHS[source]})</span>
                                    )}
                                    {configExists && (
                                        <button
                                            className="section-icon-btn"
                                            title={t('config.hooks.openFile', { path: SOURCE_PATHS[source] })}
                                            onClick={(e) => { e.stopPropagation(); handleOpenConfig(source); }}
                                        >
                                            <OpenIcon />
                                        </button>
                                    )}
                                    <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                </div>
                                {!isCollapsed && (sectionGroups.length === 0 ? (
                                    <div className="section-empty">{t('config.hooks.empty')}</div>
                                ) : (
                                    <div className="section-list">
                                        {sectionGroups.map(group =>
                                            renderEventCard(source, group, `${source}-${group.pluginName || ''}-${group.event}`)
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 手动添加弹窗：每次打开重新挂载，不保留上次内容 */}
            {showAddModal && (
                <AddHookModal
                    isSaving={isAdding}
                    onClose={() => { if (!isAdding) setShowAddModal(false); }}
                    onSave={handleAddHooks}
                />
            )}
        </div>
    );
};

export default HooksConfig;
