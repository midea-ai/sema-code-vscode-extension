import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { initialBgColors, hashString } from './utils/iconUtils';
import {
    ExpandArrowIcon,
    TrashIcon,
    CloseIcon,
    RefreshIcon,
    PlusIcon,
    CartIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    GitPullIcon,
    GitHubIcon
} from './utils/svgIcons';
import {
    PluginScope,
    PluginInfo,
    PluginComponentEntry,
    MarketplaceInfo,
    AvailablePlugin,
    PluginTabType,
    MarketplacePluginsInfo

} from './types/plugin';
import './style/plugin.css';
import './style/section.css';

interface PluginConfigProps {
    vscode: VscodeApi;
}

const SCOPE_ORDER: PluginScope[] = ['project', 'user'];

const SCOPE_SECTION_TITLES: Record<string, string> = {
    local: '本地 Plugins',
    project: '项目级 Plugins',
    user: '用户级 Plugins',
    other: '外部 Plugins'
};

// 插件名称图标
const PluginNameIcon: React.FC<{ name: string }> = ({ name }) => {
    const initial = name.charAt(0).toUpperCase();
    const bgColor = initialBgColors[hashString(name) % initialBgColors.length];
    return (
        <span className="plugin-name-icon" style={{ backgroundColor: bgColor }}>
            {initial}
        </span>
    );
};

// 组件标签列表 - 竖向排列，最多显示3项
const ComponentBadges: React.FC<{ label: string; items: PluginComponentEntry[]; onOpenFile?: (filePath: string) => void }> = ({ label, items, onOpenFile }) => {
    const [expanded, setExpanded] = useState(false);
    if (!items || items.length === 0) return null;
    const SHOW_MAX = 3;
    const shown = expanded ? items : items.slice(0, SHOW_MAX);
    const hiddenCount = items.length - SHOW_MAX;
    return (
        <div className="plugin-component-group">
            <span className="plugin-component-label">{label}</span>
            <div className="plugin-component-badges">
                {shown.map((item, i) => (
                    <span
                        key={i}
                        className={`plugin-badge${item.filePath && onOpenFile ? ' plugin-badge-link' : ''}`}
                        title={item.filePath}
                        onClick={() => item.filePath && onOpenFile?.(item.filePath)}
                    >{item.name}</span>
                ))}
                {!expanded && hiddenCount > 0 && (
                    <span className="plugin-badge-more" onClick={() => setExpanded(true)}>
                        +{hiddenCount}
                    </span>
                )}
                {expanded && items.length > SHOW_MAX && (
                    <span className="plugin-badge-more" onClick={() => setExpanded(false)}>
                        收起
                    </span>
                )}
            </div>
        </div>
    );
};

// 已安装插件卡片
const InstalledPluginCard: React.FC<{
    plugin: PluginInfo;
    onEnable: (plugin: PluginInfo) => void;
    onDisable: (plugin: PluginInfo) => void;
    onUninstall: (plugin: PluginInfo) => void;
    onOpenFile?: (filePath: string) => void;
    isUninstalling?: boolean;
    isReadonly?: boolean;
}> = ({ plugin, onEnable, onDisable, onUninstall, onOpenFile, isUninstalling, isReadonly }) => {
    const [expanded, setExpanded] = useState(false);
    const [descExpanded, setDescExpanded] = useState(false);
    const DESC_MAX = 150;
    const hasComponents = (
        (plugin.components?.commands?.length > 0) ||
        (plugin.components?.agents?.length > 0) ||
        (plugin.components?.skills?.length > 0) ||
        (plugin.components?.mcp?.length > 0)
    );
    const displayName = `${plugin.name}@${plugin.marketplace}`;

    return (
        <div className="section-card plugin-card">
            <div className="section-card-header plugin-card-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
                <button
                    className={`section-expand-btn ${expanded ? 'expanded' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    <ExpandArrowIcon />
                </button>
                <PluginNameIcon name={plugin.name} />
                <span className="section-card-name">{displayName}</span>
                {isReadonly && (
                    <>
                        <span className="readonly-tab">只读</span>
                        <span className="readonly-tab">{plugin.from}</span>
                    </>
                )}
                {!isReadonly && (
                    <div className="plugin-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                            className={`section-icon-btn section-icon-btn-danger ${isUninstalling ? 'btn-loading' : ''}`}
                            onClick={() => onUninstall(plugin)}
                            title="卸载"
                            disabled={isUninstalling}
                        >
                            {isUninstalling ? (
                                <span className="spinner" />
                            ) : (
                                <TrashIcon />
                            )}
                        </button>
                        <label className="section-switch">
                            <input
                                type="checkbox"
                                checked={plugin.status}
                                onChange={(e) => e.target.checked ? onEnable(plugin) : onDisable(plugin)}
                            />
                            <span className="section-switch-slider"></span>
                        </label>
                    </div>
                )}
            </div>
            {expanded && (
                <div className="plugin-detail">
                    {(plugin.description || plugin.author || plugin.version) && (
                        <div className="plugin-meta">
                            {plugin.description && (() => {
                                const isLong = plugin.description.length > DESC_MAX;
                                return (
                                    <p className={`plugin-description ${isLong && !descExpanded ? 'collapsed' : ''}`}>
                                        {isLong && !descExpanded
                                            ? plugin.description.slice(0, DESC_MAX) + '...'
                                            : plugin.description
                                        }
                                        {isLong && (
                                            <span
                                                className="description-toggle"
                                                onClick={() => setDescExpanded(v => !v)}
                                            >
                                                {descExpanded ? '收起' : '查看更多'}
                                            </span>
                                        )}
                                    </p>
                                );
                            })()}
                            {(plugin.author || plugin.version) && (
                                <span className="plugin-author">
                                    {plugin.author ? `by ${plugin.author}` : ''}
                                    {plugin.author && plugin.version ? `, v${plugin.version}` : ''}
                                    {!plugin.author && plugin.version ? `v${plugin.version}` : ''}
                                </span>
                            )}
                        </div>
                    )}
                    {hasComponents && (
                        <div className="plugin-components">
                            <ComponentBadges label="Commands:" items={plugin.components?.commands || []} onOpenFile={onOpenFile} />
                            <ComponentBadges label="Agents:" items={plugin.components?.agents || []} onOpenFile={onOpenFile} />
                            <ComponentBadges label="Skills:" items={plugin.components?.skills || []} onOpenFile={onOpenFile} />
                            <ComponentBadges label="MCP:" items={plugin.components?.mcp || []} onOpenFile={onOpenFile} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// 添加市场弹窗
const AddMarketplaceModal: React.FC<{
    onClose: () => void;
    onAdd: (type: 'github' | 'directory', value: string) => void;
    isAdding?: boolean;
}> = ({ onClose, onAdd, isAdding }) => {
    const [sourceType, setSourceType] = useState<'github' | 'directory'>('github');
    const [value, setValue] = useState(sourceType === 'github' ? DEFAULT_GITHUB_REPO : '');
    const [error, setError] = useState<string | null>(null);

    const handleAdd = () => {
        const trimmed = value.trim();
        if (!trimmed) {
            setError(sourceType === 'github' ? '请输入 GitHub 仓库地址' : '请输入本地目录路径');
            return;
        }
        setError(null);
        onAdd(sourceType, trimmed);
    };

    return (
        <div className="section-modal-overlay" onClick={onClose}>
            <div className="section-modal" onClick={(e) => e.stopPropagation()}>
                <div className="section-modal-header">
                    <span>添加插件市场</span>
                    <button className="section-modal-close" onClick={onClose}>
                        <CloseIcon />
                    </button>
                </div>
                <div className="section-modal-body">
                    <div className="plugin-source-tabs">
                        <button
                            className={`plugin-source-tab ${sourceType === 'github' ? 'active' : ''}`}
                            onClick={() => { setSourceType('github'); setValue(DEFAULT_GITHUB_REPO); setError(null); }}
                        >
                            GitHub 仓库
                        </button>
                        <button
                            className={`plugin-source-tab ${sourceType === 'directory' ? 'active' : ''}`}
                            onClick={() => { setSourceType('directory'); setValue(''); setError(null); }}
                        >
                            本地目录
                        </button>
                    </div>
                    <div className="plugin-source-input-wrap">
                        <input
                            className="plugin-source-input"
                            type="text"
                            placeholder={sourceType === 'github' ? '例如：anthropics/claude-plugins-official' : '例如：/Users/name/my-plugins'}
                            value={value}
                            onChange={(e) => { setValue(e.target.value); setError(null); }}
                        />
                    </div>
                    {error && <div className="section-edit-error">{error}</div>}
                </div>
                <div className="section-modal-footer">
                    <button className="section-btn secondary" onClick={onClose} disabled={isAdding}>取消</button>
                    <button
                        className={`section-btn primary ${isAdding ? 'btn-loading' : ''}`}
                        onClick={handleAdd}
                        disabled={isAdding}
                    >
                        {isAdding && <span className="spinner" />}
                        {isAdding ? '添加中...' : '确定'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const DEFAULT_GITHUB_REPO = 'anthropics/claude-plugins-official';
const PAGE_SIZE = 10;

// 市场区块 - 展示可用插件
const MarketplaceSection: React.FC<{
    marketplace: MarketplaceInfo;
    installedPlugins: PluginInfo[];
    onInstall: (plugin: AvailablePlugin, marketplace: MarketplaceInfo, scope: PluginScope) => void;
    onUpdate: (marketplaceName: string) => void;
    onRemove: (marketplaceName: string) => void;
    onOpenExternal?: (url: string) => void;
    isUpdating?: boolean;
    isRemoving?: boolean;
    installingKeys?: Set<string>;
    search?: string;
}> = ({ marketplace, installedPlugins, onInstall, onUpdate, onRemove, onOpenExternal, isUpdating, isRemoving, installingKeys, search = '' }) => {
    const [expanded, setExpanded] = useState(true);
    const [page, setPage] = useState(1);

    useEffect(() => {
        setPage(1);
    }, [search]);

    const installedNames = useMemo(() =>
        new Set(installedPlugins.map(p => p.name)),
        [installedPlugins]
    );

    const sortedAvailable = useMemo(() =>
        [...marketplace.available].sort((a, b) => {
            const aInst = installedNames.has(a.name) ? 0 : 1;
            const bInst = installedNames.has(b.name) ? 0 : 1;
            if (aInst !== bInst) return aInst - bInst;
            return a.name.localeCompare(b.name);
        }),
        [marketplace.available, installedNames]
    );

    const filteredAvailable = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return sortedAvailable;
        return sortedAvailable.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.description || '').toLowerCase().includes(q) ||
            (p.author || '').toLowerCase().includes(q)
        );
    }, [sortedAvailable, search]);

    const totalPages = Math.ceil(filteredAvailable.length / PAGE_SIZE);
    const pagedPlugins = filteredAvailable.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const isReadonly = marketplace.from !== 'sema';

    const isGithubSource = marketplace.source.source === 'github';
    const githubUrl = isGithubSource && marketplace.source.repo
        ? `https://github.com/${marketplace.source.repo}`
        : null;
    const sourceLabel = isGithubSource
        ? (marketplace.source.repo || 'GitHub')
        : (marketplace.source.path || '本地目录');

    return (
        <div className="section-group plugin-marketplace-section">
            <div className="plugin-marketplace-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
                <button
                    className={`section-expand-btn ${expanded ? 'expanded' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    <ExpandArrowIcon />
                </button>
                <PluginNameIcon name={marketplace.name} />
                <div className="plugin-marketplace-info">
                    <div className="plugin-marketplace-name-row">
                        <span className="plugin-marketplace-name">{marketplace.name}</span>
                        {marketplace.from !== 'sema' && (
                            <span className="readonly-tab">只读</span>
                        )}
                    </div>
                    {githubUrl ? (
                        <a
                            className="plugin-marketplace-source plugin-marketplace-source-link"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onOpenExternal?.(githubUrl);
                            }}
                            href="#"
                            title={githubUrl}
                            style={{ width: 'fit-content' }}
                        >
                            <GitHubIcon size={14} />
                            {sourceLabel}
                        </a>
                    ) : (
                        <span className="plugin-marketplace-source">{sourceLabel}</span>
                    )}
                    <span className="plugin-marketplace-date">
                        {marketplace.available.length} available · {installedPlugins.length} installed
                        {marketplace.lastUpdated && ` · ${marketplace.lastUpdated}`}
                    </span>
                </div>
                {!isReadonly && (
                    <div className="plugin-marketplace-actions" onClick={(e) => e.stopPropagation()}>
                        {marketplace.source.source !== 'directory' && (
                            <button
                                className={`section-icon-btn ${isUpdating ? 'btn-loading' : ''}`}
                                onClick={() => onUpdate(marketplace.name)}
                                title="git pull"
                                disabled={isUpdating || isRemoving}
                            >
                                {isUpdating ? (
                                    <span className="spinner" />
                                ) : (
                                    <GitPullIcon size={14} />
                                )}
                            </button>
                        )}
                        <button
                            className={`section-icon-btn section-icon-btn-danger ${isRemoving ? 'btn-loading' : ''}`}
                            onClick={() => onRemove(marketplace.name)}
                            title="移除市场"
                            disabled={isRemoving || isUpdating}
                        >
                            {isRemoving ? (
                                <span className="spinner" />
                            ) : (
                                <TrashIcon />
                            )}
                        </button>
                    </div>
                )}
            </div>
            {expanded && (
                <div className="plugin-available-list">
                    {filteredAvailable.length === 0 ? (
                        <div className="section-empty">{search ? '没有匹配的插件' : '暂无可用插件'}</div>
                    ) : (
                        <>
                            {pagedPlugins.map((plugin, index) => {
                                const isInstalled = installedNames.has(plugin.name);
                                const installKey = `${marketplace.name}/${plugin.name}`;
                                const isInstalling = installingKeys?.has(installKey);
                                return (
                                    <div key={index} className="plugin-available-card">
                                        <div className="plugin-available-left">
                                            <PluginNameIcon name={plugin.name} />
                                            <div className="plugin-available-info">
                                                <span className="plugin-available-name">{plugin.name}</span>
                                                {plugin.description && (
                                                    <span className="plugin-available-desc">{plugin.description}</span>
                                                )}
                                                {plugin.author && (
                                                    <span className="plugin-available-author">by {plugin.author}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="plugin-available-right">
                                            {isInstalled ? (
                                                <span className="section-installed-badge">已安装</span>
                                            ) : !isReadonly ? (
                                                <div className="section-install-btns">
                                                    <button
                                                        className={`section-btn secondary small ${isInstalling ? 'btn-loading' : ''}`}
                                                        onClick={() => onInstall(plugin, marketplace, 'project')}
                                                        title="安装到当前项目"
                                                        disabled={isInstalling}
                                                    >
                                                        {isInstalling && <span className="spinner" />}
                                                        项目安装
                                                    </button>
                                                    <button
                                                        className={`section-btn primary small ${isInstalling ? 'btn-loading' : ''}`}
                                                        onClick={() => onInstall(plugin, marketplace, 'user')}
                                                        title="安装到用户全局"
                                                        disabled={isInstalling}
                                                    >
                                                        {isInstalling && <span className="spinner" />}
                                                        全局安装
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                            {totalPages > 1 && (
                                <div className="plugin-pagination">
                                    <button
                                        className="plugin-page-btn"
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                    >
                                        <ChevronLeftIcon />
                                    </button>
                                    <span className="plugin-page-info">{page} / {totalPages}</span>
                                    <button
                                        className="plugin-page-btn"
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={page === totalPages}
                                    >
                                        <ChevronRightIcon />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const PluginConfig: React.FC<PluginConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<PluginTabType>('installed');
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
    const [data, setData] = useState<MarketplacePluginsInfo>({ marketplaces: [], plugins: [] });
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [uninstallingKeys, setUninstallingKeys] = useState<Set<string>>(new Set());
    const [updatingNames, setUpdatingNames] = useState<Set<string>>(new Set());
    const [removingNames, setRemovingNames] = useState<Set<string>>(new Set());
    const [installingKeys, setInstallingKeys] = useState<Set<string>>(new Set());
    const [marketSearch, setMarketSearch] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const sortedMarketplaces = useMemo(() =>
        [...data.marketplaces].sort((a, b) => {
            const aReadonly = a.from !== 'sema' ? 1 : 0;
            const bReadonly = b.from !== 'sema' ? 1 : 0;
            if (aReadonly !== bReadonly) return aReadonly - bReadonly;
            return (b.lastUpdated || '').localeCompare(a.lastUpdated || '');
        }),
        [data.marketplaces]
    );

    const groupedPlugins = useMemo(() => {
        const groups: Record<string, PluginInfo[]> = { project: [], user: [], local: [], other: [] };
        data.plugins.forEach(p => {
            if (p.from !== 'sema') {
                if (!p.status) return;
                groups.other.push(p);
            } else if (groups[p.scope]) {
                groups[p.scope].push(p);
            }
        });
        return groups;
    }, [data.plugins]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadPluginConfigResult':
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    setLoading(false);
                    break;
                case 'installPluginResult':
                    setInstallingKeys(prev => {
                        const next = new Set(prev);
                        if (message.key) next.delete(message.key);
                        return next;
                    });
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    break;
                case 'uninstallPluginResult':
                    setUninstallingKeys(prev => {
                        const next = new Set(prev);
                        if (message.key) next.delete(message.key);
                        return next;
                    });
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    break;
                case 'enablePluginResult':
                case 'disablePluginResult':
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    break;
                case 'updateMarketplaceResult':
                    setUpdatingNames(prev => {
                        const next = new Set(prev);
                        if (message.name) next.delete(message.name);
                        return next;
                    });
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    break;
                case 'addMarketplaceResult':
                    setIsAdding(false);
                    if (message.success && message.data) {
                        setData(message.data);
                        setShowAddModal(false);
                    }
                    break;
                case 'removeMarketplaceResult':
                    setRemovingNames(prev => {
                        const next = new Set(prev);
                        if (message.name) next.delete(message.name);
                        return next;
                    });
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    break;
                case 'refreshPluginConfigResult':
                    setIsRefreshing(false);
                    if (message.success && message.data) {
                        setData(message.data);
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadPluginConfig' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const handleEnable = (plugin: PluginInfo) => {
        vscode.postMessage({
            command: 'enablePlugin',
            pluginName: plugin.name,
            marketplaceName: plugin.marketplace,
            scope: plugin.scope
        });
    };

    const handleDisable = (plugin: PluginInfo) => {
        vscode.postMessage({
            command: 'disablePlugin',
            pluginName: plugin.name,
            marketplaceName: plugin.marketplace,
            scope: plugin.scope
        });
    };

    const handleUninstall = (plugin: PluginInfo) => {
        const key = `${plugin.marketplace}/${plugin.name}`;
        setUninstallingKeys(prev => new Set(prev).add(key));
        vscode.postMessage({
            command: 'uninstallPlugin',
            pluginName: plugin.name,
            marketplaceName: plugin.marketplace,
            scope: plugin.scope,
            key
        });
    };

    const handleInstall = (plugin: AvailablePlugin, marketplace: MarketplaceInfo, scope: PluginScope) => {
        const key = `${marketplace.name}/${plugin.name}`;
        setInstallingKeys(prev => new Set(prev).add(key));
        vscode.postMessage({
            command: 'installPlugin',
            pluginName: plugin.name,
            marketplaceName: marketplace.name,
            scope,
            key
        });
    };

    const handleUpdateMarketplace = (name: string) => {
        setUpdatingNames(prev => new Set(prev).add(name));
        vscode.postMessage({ command: 'updateMarketplace', marketplaceName: name, name });
    };

    const handleRemoveMarketplace = (name: string) => {
        setRemovingNames(prev => new Set(prev).add(name));
        vscode.postMessage({ command: 'removeMarketplace', marketplaceName: name, name });
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshPluginConfig' });
    };

    const handleAddMarketplace = (type: 'github' | 'directory', value: string) => {
        setIsAdding(true);
        if (type === 'github') {
            vscode.postMessage({ command: 'addMarketplaceFromGit', repo: value });
        } else {
            vscode.postMessage({ command: 'addMarketplaceFromDirectory', dirPath: value });
        }
    };

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'installed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('installed')}
                >
                    已安装
                    {data.plugins.filter(p => p.from === 'sema' || p.status).length > 0 && (
                        <span className="section-tab-count">{data.plugins.filter(p => p.from === 'sema' || p.status).length}</span>
                    )}
                </div>
                <div
                    className={`tab-item ${activeTab === 'market' ? 'active' : ''}`}
                    onClick={() => setActiveTab('market')}
                >
                    插件市场
                </div>
                <div className="section-tab-actions">
                    <button
                        className="section-btn primary small"
                        onClick={() => setShowAddModal(true)}
                    >
                        <PlusIcon />
                        添加市场
                    </button>
                    <button
                        className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title="reload Plugins"
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
                {activeTab === 'installed' ? (
                    loading ? (
                        <div className="section-loading">加载中...</div>
                    ) : (
                        <div className="section-groups">
                            {[...SCOPE_ORDER, 'other'].map(scope => {
                                const sectionPlugins = groupedPlugins[scope] || [];
                                if (scope === 'other' && sectionPlugins.length === 0) return null;
                                const isCollapsed = collapsedSections.has(scope);
                                const toggleCollapse = () => setCollapsedSections(prev => {
                                    const next = new Set(prev);
                                    if (next.has(scope)) next.delete(scope); else next.add(scope);
                                    return next;
                                });
                                return (
                                    <div key={scope} className={`section-group section-${scope}`}>
                                        <div className="section-group-title section-group-title-collapsible" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={toggleCollapse}>
                                            {SCOPE_SECTION_TITLES[scope]}
                                            <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                        </div>
                                        {!isCollapsed && (sectionPlugins.length === 0 ? (
                                            <div className="section-empty">
                                                暂无 Plugin
                                            </div>
                                        ) : (
                                            <div className="section-list plugin-list">
                                                {sectionPlugins.map((plugin, index) => (
                                                    <InstalledPluginCard
                                                        key={`${plugin.marketplace}-${plugin.name}-${index}`}
                                                        plugin={plugin}
                                                        onEnable={handleEnable}
                                                        onDisable={handleDisable}
                                                        onUninstall={handleUninstall}
                                                        onOpenFile={(filePath) => vscode.postMessage({ command: 'openFile', filePath })}
                                                        isUninstalling={uninstallingKeys.has(`${plugin.marketplace}/${plugin.name}`)}
                                                        isReadonly={plugin.from !== 'sema'}
                                                    />
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : (
                    <div className="plugin-market">
                        {!loading && data.marketplaces.length > 0 && (
                            <div className="section-search-box">
                                <input
                                    type="text"
                                    className="section-search-input"
                                    placeholder="搜索插件名称、描述或作者..."
                                    value={marketSearch}
                                    onChange={(e) => setMarketSearch(e.target.value)}
                                />
                            </div>
                        )}
                        {loading ? (
                            <div className="section-loading">加载中...</div>
                        ) : data.marketplaces.length === 0 ? (
                            <div className="plugin-empty-state">
                                <CartIcon />
                                <p>暂无插件市场，请先添加</p>
                            </div>
                        ) : (
                            <div className="section-groups">
                                {sortedMarketplaces.map((marketplace, index) => (
                                    <MarketplaceSection
                                        key={`${marketplace.name}-${index}`}
                                        marketplace={marketplace}
                                        installedPlugins={data.plugins.filter(p => p.marketplace === marketplace.name && p.from === marketplace.from)}
                                        onInstall={handleInstall}
                                        onUpdate={handleUpdateMarketplace}
                                        onRemove={handleRemoveMarketplace}
                                        onOpenExternal={(url) => vscode.postMessage({ command: 'openExternal', url })}
                                        isUpdating={updatingNames.has(marketplace.name)}
                                        isRemoving={removingNames.has(marketplace.name)}
                                        installingKeys={installingKeys}
                                        search={marketSearch}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 添加市场弹窗 */}
            {showAddModal && (
                <AddMarketplaceModal
                    onClose={() => { setShowAddModal(false); setIsAdding(false); }}
                    onAdd={handleAddMarketplace}
                    isAdding={isAdding}
                />
            )}
        </div>
    );
};

export default PluginConfig;
