import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi, ToolInfo, SystemToolInfo } from './types';
import { MCPServerInfo, MCPServerConfig, MCPScopeType } from './types/mcp';
import { ExpandArrowIcon, RefreshIcon, EditIcon, TrashIcon, CloseIcon, GearIcon, GitHubIcon, WarningCircleIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from './utils/svgIcons';
import { defaultMCPMarketInfos, MCPMarketInfo } from './default/defaultMCPMarket';
import { inlineSvgIcons } from './utils/mcpIcon';
import { initialBgColors, hashString } from './utils/iconUtils';
import { openFileWithRange } from './utils/fileUtils';
import { useT, I18nKey } from '../common/i18n/react';
import './style/section.css';
import './style/mcp.css';


type MCPTabType = 'installed' | 'market';
type MCPGroupScope = 'project' | 'user' | 'plugin';

const GROUP_ORDER: MCPGroupScope[] = ['project', 'user', 'plugin'];

// 分组标题文案 key，渲染期经 t() 取值
const GROUP_TITLE_KEYS: Record<MCPGroupScope, I18nKey> = {
    project: 'config.mcp.group.project',
    user: 'config.mcp.group.user',
    plugin: 'config.mcp.group.plugin',
};

const GROUP_PATHS: Record<MCPGroupScope, string> = {
    project: '.sema/.mcp.json',
    user: '~/.sema/.mcp.json',
    plugin: '',
};

// 各分组允许的操作
const GROUP_ACTIONS: Record<MCPGroupScope, { canEdit: boolean; canDelete: boolean; canToggle: boolean; canToolToggle: boolean }> = {
    project: { canEdit: true, canDelete: true, canToggle: true, canToolToggle: true },
    user: { canEdit: true, canDelete: true, canToggle: true, canToolToggle: true },
    plugin: { canEdit: false, canDelete: false, canToggle: true, canToolToggle: true },
};

const MAX_TOOL_COUNT = 30;
const TOOLS_PAGE_SIZE = 8;

// 「手动添加」弹窗编辑器为空时展示的示例（仅作 placeholder，不写入内容）
const MANUAL_ADD_PLACEHOLDER = `{
  "mcpServers": {
    "server-name": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "package-name"]
    }
  }
}`;

const statusColors: Record<string, string> = {
    disconnected: '#6b7280',
    connecting: '#f59e0b',
    connected: '#10b981',
    error: '#ef4444',
};

const STATUS_TEXT_KEYS: Record<string, I18nKey> = {
    disconnected: 'config.mcp.status.disconnected',
    connecting: 'config.mcp.status.connecting',
    connected: 'config.mcp.status.connected',
    error: 'config.mcp.status.error',
};

// 将后端返回的分组/数组数据展开为平铺列表
function flattenServers(data: any): MCPServerInfo[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return [
        ...(data.project || []),
        ...(data.user || []),
        ...(data.plugin || []),
        ...(data.local || []),
    ];
}

// ─── MCPNameIcon ─────────────────────────────────────────────────────────────

const MCPNameIcon: React.FC<{ name: string }> = ({ name }) => {
    const initial = name.charAt(0).toUpperCase();
    const bgColor = initialBgColors[hashString(name) % initialBgColors.length];
    return (
        <span className="mcp-name-icon" style={{ backgroundColor: bgColor }}>
            {initial}
        </span>
    );
};

// ─── ToolsPanel ─────────────────────────────────────────────────────────────

interface ToolsPanelItem {
    name: string;
    description?: string;
    enabled: boolean;
}

const ToolsPanel: React.FC<{
    tools: ToolsPanelItem[];
    canToggle: boolean;
    onToolToggle: (toolName: string, enabled: boolean) => void;
}> = ({ tools, canToggle, onToolToggle }) => {
    const t = useT();
    const [toolPage, setToolPage] = useState(1);
    const toolCount = tools.length;
    const enabledCount = tools.filter(tool => tool.enabled).length;
    const toolTotalPages = Math.ceil(toolCount / TOOLS_PAGE_SIZE);
    const pagedTools = tools.slice((toolPage - 1) * TOOLS_PAGE_SIZE, toolPage * TOOLS_PAGE_SIZE);

    return (
        <div className="mcp-server-tools">
            <div className="mcp-tools-header">{enabledCount}/{toolCount} Tools</div>
            {toolCount > 0 ? (
                <>
                    <div className="mcp-tools-list">
                        {pagedTools.map((tool, index) => (
                            <div key={index} className="mcp-tool-item mcp-tool-item-with-switch">
                                <span className="mcp-tool-name">{tool.name}</span>
                                <span className="mcp-tool-desc">{tool.description || '-'}</span>
                                {canToggle && (
                                    <label className="mcp-tool-switch">
                                        <input
                                            type="checkbox"
                                            checked={tool.enabled}
                                            onChange={(e) => onToolToggle(tool.name, e.target.checked)}
                                        />
                                        <span className="mcp-tool-switch-slider"></span>
                                    </label>
                                )}
                            </div>
                        ))}
                    </div>
                    {toolTotalPages > 1 && (
                        <div className="mcp-tools-pagination">
                            <button className="mcp-tools-page-btn" onClick={() => setToolPage(p => Math.max(1, p - 1))} disabled={toolPage === 1}>
                                <ChevronLeftIcon />
                            </button>
                            <span className="mcp-tools-page-info">{toolPage} / {toolTotalPages}</span>
                            <button className="mcp-tools-page-btn" onClick={() => setToolPage(p => Math.min(toolTotalPages, p + 1))} disabled={toolPage === toolTotalPages}>
                                <ChevronRightIcon />
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="mcp-tools-empty">{t('config.mcp.noTools')}</div>
            )}
        </div>
    );
};

// ─── MCPServerCard ───────────────────────────────────────────────────────────

const MCPServerCard: React.FC<{
    server: MCPServerInfo;
    scope: MCPGroupScope;
    onReconnect: (name: string) => void;
    onEdit: (server: MCPServerInfo, scope: MCPGroupScope) => void;
    onDelete: (server: MCPServerInfo, scope: MCPGroupScope) => void;
    onToggle: (server: MCPServerInfo, scope: MCPGroupScope, enabled: boolean) => void;
    onToolToggle: (mcpName: string, toolName: string, enabled: boolean) => void;
}> = ({ server, scope, onReconnect, onEdit, onDelete, onToggle, onToolToggle }) => {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    const tools = server.capabilities?.tools || [];

    const { canEdit, canDelete, canToggle, canToolToggle } = GROUP_ACTIONS[scope];

    const connectStatus = (server as any).connectStatus;
    const statusKey = typeof connectStatus === 'string' ? connectStatus : 'disconnected';

    const isToolEnabled = (toolName: string): boolean => {
        if (server.config.useTools === null || server.config.useTools === undefined) return true;
        return server.config.useTools.includes(toolName);
    };

    const toolsPanelItems: ToolsPanelItem[] = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        enabled: isToolEnabled(tool.name),
    }));

    return (
        <div className="section-card mcp-server-item">
            <div className="section-card-header mcp-server-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
                <button
                    className={`section-expand-btn ${expanded ? 'expanded' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    <ExpandArrowIcon />
                </button>
                <MCPNameIcon name={server.config.name} />
                <span className="section-card-name">{server.config.name}</span>
                <span
                    className="mcp-status-dot"
                    style={{ backgroundColor: statusColors[statusKey] || statusColors.disconnected }}
                    title={STATUS_TEXT_KEYS[statusKey] ? t(STATUS_TEXT_KEYS[statusKey]) : statusKey}
                />
                {statusKey === 'error' && (server as any).error && (
                    <span className="mcp-error-hint" title={(server as any).error}>!</span>
                )}
                {!canEdit && <span className="readonly-tab">{t('common.readonly')}</span>}
                <div className="section-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                        className="section-icon-btn"
                        onClick={() => onReconnect(server.config.name)}
                        title={server.status !== true ? t('config.mcp.reconnectDisabled') : t('config.mcp.reconnect')}
                        disabled={server.status !== true}
                    >
                        <RefreshIcon />
                    </button>
                    {canEdit && (
                        <button
                            className="section-icon-btn"
                            onClick={() => onEdit(server, scope)}
                            title={t('config.mcp.editConfig')}
                        >
                            <EditIcon />
                        </button>
                    )}
                    {canDelete && (
                        <button
                            className="section-icon-btn section-icon-btn-danger"
                            onClick={() => onDelete(server, scope)}
                            title={t('common.delete')}
                        >
                            <TrashIcon />
                        </button>
                    )}
                    {canToggle && (
                        <label className="section-switch">
                            <input
                                type="checkbox"
                                checked={server.status !== false}
                                onChange={(e) => onToggle(server, scope, e.target.checked)}
                            />
                            <span className="section-switch-slider"></span>
                        </label>
                    )}
                </div>
            </div>
            {expanded && (
                <ToolsPanel
                    tools={toolsPanelItems}
                    canToggle={canToolToggle}
                    onToolToggle={(toolName, enabled) => onToolToggle(server.config.name, toolName, enabled)}
                />
            )}
        </div>
    );
};

// ─── SystemToolsCard ─────────────────────────────────────────────────────────

const SystemToolsCard: React.FC<{
    tools: SystemToolInfo[];
    onToolToggle: (toolName: string, enabled: boolean) => void;
}> = ({ tools, onToolToggle }) => {
    const t = useT();
    const [expanded, setExpanded] = useState(true);

    const toolsPanelItems: ToolsPanelItem[] = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        enabled: tool.enabled,
    }));

    return (
        <div className="section-card mcp-server-item">
            <div className="section-card-header mcp-server-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
                <button
                    className={`section-expand-btn ${expanded ? 'expanded' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    <ExpandArrowIcon />
                </button>
                <div className="section-card-icon mcp-builtin-icon">
                    <GearIcon />
                </div>
                <span className="section-card-name">{t('config.mcp.builtinTools')}</span>
                <span className="readonly-tab">{t('common.readonly')}</span>
                <span
                    className="mcp-status-dot"
                    style={{ backgroundColor: '#10b981' }}
                    title={t('config.mcp.status.connected')}
                />
            </div>
            {expanded && (
                <ToolsPanel
                    tools={toolsPanelItems}
                    canToggle={true}
                    onToolToggle={onToolToggle}
                />
            )}
        </div>
    );
};

// ─── MCPEditModal ─────────────────────────────────────────────────────────────

type MCPEditMode = 'edit' | 'add';
type MCPAddScope = 'project' | 'user';

const MCPEditModal: React.FC<{
    server: MCPServerInfo | null;
    scope: MCPGroupScope;
    require?: Record<string, string>;
    /** add 模式：标题改为手动添加，弹窗内可切换作用域，并校验与已安装服务重名 */
    mode?: MCPEditMode;
    installedNames?: Set<string>;
    onClose: () => void;
    onSave: (config: MCPServerConfig, scope: MCPGroupScope) => void;
    vscode: VscodeApi;
    isSaving?: boolean;
}> = ({ server, scope: initialScope, require, mode = 'edit', installedNames, onClose, onSave, vscode, isSaving }) => {
    const t = useT();
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [scope, setScope] = useState<MCPGroupScope>(initialScope);

    useEffect(() => { setScope(initialScope); }, [initialScope]);

    // 根据编辑器当前内容解析 command，用户改成 uvx/npx 时环境提示实时跟随
    const currentCommand = useMemo(() => {
        try {
            const parsed = JSON.parse(jsonText);
            const servers = parsed?.mcpServers;
            if (!servers || typeof servers !== 'object') return '';
            const first = Object.values(servers)[0] as any;
            return typeof first?.command === 'string' ? first.command.toLowerCase() : '';
        } catch {
            return '';
        }
    }, [jsonText]);

    const showNpxHint = currentCommand === 'npx' || currentCommand.endsWith('/npx');
    const showUvxHint = currentCommand === 'uvx' || currentCommand.endsWith('/uvx');

    const checkRequirePlaceholders = (config: MCPServerConfig, requireKeys: string[]): string[] => {
        const unreplacedKeys: string[] = [];
        for (const key of requireKeys) {
            if (config.args?.some(arg => arg.includes(key))) { unreplacedKeys.push(key); continue; }
            if (config.env) {
                if (Object.values(config.env).some(val => val.includes(key))) unreplacedKeys.push(key);
            }
        }
        return unreplacedKeys;
    };

    useEffect(() => {
        if (!server) return;
        if (mode === 'add') {
            setJsonText('');
        } else {
            const { name, ...restConfig } = server.config;
            setJsonText(JSON.stringify({ mcpServers: { [name]: restConfig } }, null, 2));
        }
        setError(null);
    }, [server, mode]);

    const handleSave = () => {
        try {
            const parsed = JSON.parse(jsonText);
            if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
                setError(t('config.mcp.err.needMcpServers')); return;
            }
            const serverNames = Object.keys(parsed.mcpServers);
            if (serverNames.length !== 1) {
                setError(t('config.mcp.err.singleServer')); return;
            }
            const name = serverNames[0];
            const config: MCPServerConfig = { name, ...parsed.mcpServers[name] };
            if (!config.transport) { setError(t('config.mcp.err.transportRequired')); return; }
            if (mode === 'add' && installedNames?.has(name)) {
                setError(t('config.mcp.err.nameExists', { name })); return;
            }
            if (require) {
                const unreplacedKeys = checkRequirePlaceholders(config, Object.keys(require));
                if (unreplacedKeys.length > 0) {
                    setError(t('config.mcp.err.replacePlaceholders', {
                        keys: unreplacedKeys.map(k => `'${k}'`).join(t('config.mcp.requireSeparator'))
                    })); return;
                }
            }
            onSave(config, scope);
        } catch {
            setError(t('config.mcp.err.invalidJson'));
        }
    };

    if (!server) return null;

    const renderRequireHints = () => {
        if (!require || Object.keys(require).length === 0) return null;
        return (
            <div className="mcp-require-hint">
                <span className="mcp-require-hint-prefix">{t('config.mcp.requirePrefix')}</span>
                {Object.entries(require).map(([key, desc], index, arr) => (
                    <span key={key}>
                        '<span className="mcp-require-key">{key}</span>'
                        <span className="mcp-require-desc">{t('config.mcp.requireDesc', { desc })}</span>
                        {index < arr.length - 1 && t('config.mcp.requireSeparator')}
                    </span>
                ))}
                <span className="mcp-require-hint-suffix">{t('config.mcp.requireSuffix')}</span>
            </div>
        );
    };

    return (
        <div className="section-modal-overlay" onClick={onClose}>
            <div className="section-modal" onClick={(e) => e.stopPropagation()}>
                <div className="section-modal-header">
                    <span>{mode === 'add' ? t('config.mcp.manualAddTitle') : t('config.mcp.editTitle', { name: server.config.name })}</span>
                    <button className="section-modal-close" onClick={onClose}><CloseIcon /></button>
                </div>
                <div className="section-modal-body">
                    {showNpxHint && (
                        <div className="mcp-npx-hint">
                            <span className="mcp-npx-hint-text">{t('config.mcp.needNpx')}</span>
                            <a href="#" className="mcp-npx-hint-link" onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: 'https://nodejs.org/' }); }}>{t('config.mcp.howToInstall')}</a>
                        </div>
                    )}
                    {showUvxHint && (
                        <div className="mcp-npx-hint">
                            <span className="mcp-npx-hint-text">{t('config.mcp.needUvx')}</span>
                            <a href="#" className="mcp-npx-hint-link" onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: 'https://docs.astral.sh/uv/getting-started/installation/' }); }}>{t('config.mcp.howToInstall')}</a>
                        </div>
                    )}
                    {renderRequireHints()}
                    <textarea
                        className="mcp-json-editor"
                        value={jsonText}
                        placeholder={mode === 'add' ? MANUAL_ADD_PLACEHOLDER : undefined}
                        onChange={(e) => { setJsonText(e.target.value); setError(null); }}
                        spellCheck={false}
                    />
                    {mode === 'add' && (
                        <div className="mcp-scope-row">
                            <span className="mcp-scope-label">{t('config.mcp.scopeLabel')}</span>
                            {(['project', 'user'] as MCPAddScope[]).map(s => (
                                <label
                                    key={s}
                                    className="checkbox-label mcp-scope-option"
                                    title={`${s === 'project' ? t('common.installToProjectTip') : t('common.installToUserTip')} (${GROUP_PATHS[s]})`}
                                >
                                    <input
                                        type="radio"
                                        name="mcp-add-scope"
                                        value={s}
                                        checked={scope === s}
                                        onChange={() => setScope(s)}
                                    />
                                    <span>{s === 'project' ? t('config.mcp.scopeProject') : t('config.mcp.scopeUser')}</span>
                                </label>
                            ))}
                        </div>
                    )}
                    {error && <div className="section-edit-error">{error}</div>}
                </div>
                <div className="section-modal-footer">
                    <button className="section-btn secondary" onClick={onClose} disabled={isSaving}>{t('common.cancel')}</button>
                    <button className={`section-btn primary ${isSaving ? 'btn-loading' : ''}`} onClick={handleSave} disabled={isSaving}>
                        {isSaving && <span className="spinner" />}
                        {isSaving ? t('common.saving') : t('common.ok')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── MCPIcon ──────────────────────────────────────────────────────────────────

const MCPIcon: React.FC<{ name: string }> = ({ name }) => {
    const iconContent = inlineSvgIcons[name];
    if (iconContent) {
        if (iconContent.includes('<svg')) {
            return <span className="mcp-market-icon mcp-market-icon-svg" dangerouslySetInnerHTML={{ __html: iconContent }} />;
        }
        return <span className="mcp-market-icon mcp-market-icon-emoji">{iconContent}</span>;
    }
    const initial = name.charAt(0).toUpperCase();
    const bgColor = initialBgColors[hashString(name) % initialBgColors.length];
    return <span className="mcp-market-icon mcp-market-icon-initial" style={{ backgroundColor: bgColor }}>{initial}</span>;
};

// ─── MCPMarketCard ────────────────────────────────────────────────────────────

const getCommandType = (command?: string): string => {
    if (!command) return '';
    const cmd = command.toLowerCase();
    if (cmd === 'npx' || cmd.endsWith('/npx')) return 'NPX';
    if (cmd === 'uvx' || cmd.endsWith('/uvx')) return 'UVX';
    return '';
};

const formatMCPName = (name: string): string =>
    name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const getGitHubAuthor = (githubUrl?: string): string => {
    if (!githubUrl) return '';
    const match = githubUrl.match(/github\.com\/([^/]+)/);
    return match ? match[1] : '';
};

const MCPMarketCard: React.FC<{
    item: MCPMarketInfo;
    isInstalled: boolean;
    onInstall: (item: MCPMarketInfo, scope: MCPGroupScope) => void;
    vscode: VscodeApi;
}> = ({ item, isInstalled, onInstall, vscode }) => {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    const commandType = getCommandType(item.config.command);
    const author = getGitHubAuthor(item.github);

    return (
        <div className="mcp-market-card">
            <div className="mcp-market-card-header">
                <div className="mcp-market-card-left">
                    <MCPIcon name={item.config.name} />
                    <div className="mcp-market-info">
                        <div className="mcp-market-name">
                            {item.config.title || formatMCPName(item.config.name)}
                            {commandType && <span className="mcp-command-type">{commandType}</span>}
                        </div>
                        <div className="mcp-market-desc">{item.description}</div>
                    </div>
                </div>
                <div className="mcp-market-card-right">
                    {isInstalled ? (
                        <span className="section-installed-badge">{t('common.installed')}</span>
                    ) : (
                        <div className="section-install-btns">
                            <button className="section-btn secondary small" onClick={() => onInstall(item, 'project')} title={t('common.installToProjectTip')}>{t('config.mcp.addProject')}</button>
                            <button className="section-btn primary small" onClick={() => onInstall(item, 'user')} title={t('common.installToUserTip')}>{t('config.mcp.addUser')}</button>
                        </div>
                    )}
                </div>
            </div>
            <div className="mcp-market-card-tags">
                {item.tags.map((tag, index) => (
                    <span key={index} className="mcp-tag">{tag}</span>
                ))}
            </div>
            <div className="mcp-market-card-footer">
                <button className={`section-expand-btn ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
                    <ExpandArrowIcon />
                    <span>{item.tools.length} Tools</span>
                </button>
                {item.github && (
                    <a href="#" className="mcp-github-link" onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: item.github }); }} title={t('config.mcp.viewSource')}>
                        <GitHubIcon />
                        {author && <span className="mcp-author">{author}</span>}
                    </a>
                )}
            </div>
            {expanded && (
                <div className="mcp-market-tools">
                    <div className="mcp-tools-list">
                        {item.tools.map((tool, index) => (
                            <span key={index} className="mcp-tool-badge">{tool}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── MCPConfig ────────────────────────────────────────────────────────────────

interface MCPConfigProps {
    vscode: VscodeApi;
    onOpenSystemConfig?: () => void;
}

const MCPConfig: React.FC<MCPConfigProps> = ({ vscode, onOpenSystemConfig }) => {
    const t = useT();
    const [activeTab, setActiveTab] = useState<MCPTabType>('installed');
    const [servers, setServers] = useState<MCPServerInfo[]>([]);
    const [systemTools, setSystemTools] = useState<SystemToolInfo[]>([]);
    // null = 尚未加载,不渲染告警,避免已开启工具搜索的用户看到告警闪现
    const [toolSearchEnabled, setToolSearchEnabled] = useState<boolean | null>(null);
    const [enablingToolSearch, setEnablingToolSearch] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
    const [editingServer, setEditingServer] = useState<{ server: MCPServerInfo; scope: MCPGroupScope; require?: Record<string, string>; mode?: MCPEditMode } | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // 根据 scope 字段分组
    const groupedServers = useMemo(() => {
        const groups: Record<MCPGroupScope, MCPServerInfo[]> = {
            project: [], user: [], plugin: [],
        };
        servers.forEach(server => {
            const scope = (server.config?.scope || server.scope) as MCPGroupScope;
            if (scope === 'project') groups.project.push(server);
            else if (scope === 'user') groups.user.push(server);
            else if (scope === 'plugin') groups.plugin.push(server);
        });
        return groups;
    }, [servers]);

    const installedCount = servers.length;

    const installedNames = useMemo(() => {
        const names = new Set<string>();
        servers.forEach(s => names.add(s.config.name));
        return names;
    }, [servers]);

    const totalToolCount = useMemo(() => {
        const systemCount = systemTools.filter(tool => tool.enabled).length;
        const mcpCount = [...groupedServers.project, ...groupedServers.user, ...groupedServers.plugin]
            .filter(s => s.config.enabled !== false)
            .reduce((sum, s) => {
                const tools = s.capabilities?.tools || [];
                if (s.config.useTools === null || s.config.useTools === undefined) return sum + tools.length;
                return sum + s.config.useTools.length;
            }, 0);
        return systemCount + mcpCount;
    }, [systemTools, groupedServers]);

    const filteredMarketItems = useMemo(() => {
        let items = defaultMCPMarketInfos;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            items = items.filter(item =>
                item.config.name.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                item.tags.some(tag => tag.toLowerCase().includes(q))
            );
        }
        return [...items].sort((a, b) => {
            const aI = installedNames.has(a.config.name) ? -1 : 1;
            const bI = installedNames.has(b.config.name) ? -1 : 1;
            return aI - bI;
        });
    }, [searchQuery, installedNames]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadMCPServerInfoResult':
                    if (message.success) setServers(flattenServers(message.data));
                    setLoading(false);
                    break;
                case 'refreshMCPServerInfoResult':
                    setIsRefreshing(false);
                    if (message.success) setServers(flattenServers(message.data));
                    break;
                case 'reconnectMCPServerResult':
                    if (message.success && message.data) setServers(flattenServers(message.data));
                    break;
                case 'mcpUpdateResult':
                    setIsSavingEdit(false);
                    setEditingServer(null);
                    if (message.success && message.data) setServers(flattenServers(message.data));
                    break;
                case 'removeMCPServerResult':
                    if (message.success && message.data) setServers(flattenServers(message.data));
                    break;
                case 'addMCPServerResult':
                    setIsSavingEdit(false);
                    setEditingServer(null);
                    if (message.success && message.data) {
                        setServers(flattenServers(message.data));
                        // 添加成功后切到已安装页，让用户直接看到新服务与连接状态
                        setActiveTab('installed');
                    }
                    break;
                case 'loadSystemConfigResult':
                    if (message.success && message.data) {
                        setToolSearchEnabled(!!message.data.enableToolSearch);
                    }
                    break;
                case 'saveSystemConfigByKeyResult':
                    if (message.key === 'enableToolSearch') {
                        setEnablingToolSearch(false);
                        if (message.success) setToolSearchEnabled(!!message.value);
                    }
                    break;
                case 'loadSystemToolsResult':
                    if (message.success && message.data) {
                        setSystemTools((message.data as ToolInfo[]).map(tool => ({
                            ...tool,
                            enabled: tool.status === 'enable',
                        })));
                    }
                    break;
                case 'updateDisabledToolsResult':
                    break;
                case 'disableMCPServerResult':
                case 'enableMCPServerResult':
                    if (message.success && message.data) setServers(flattenServers(message.data));
                    break;
                case 'mcpServerStatusUpdate':
                    if (message.data) {
                        const updated: MCPServerInfo = message.data;
                        const name = updated.config?.name;
                        if (!name) break;
                        setServers(prev => prev.map(s => s.config.name === name ? { ...s, ...updated } : s));
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadMCPConfig' });
        vscode.postMessage({ command: 'loadSystemTools' });
        vscode.postMessage({ command: 'loadSystemConfig' });

        return () => window.removeEventListener('message', handleMessage);
    }, [vscode]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshMCPConfig' });
    };

    const handleReconnect = (name: string) => {
        setServers(prev => prev.map(s => s.config.name === name ? { ...s, error: undefined } : s));
        vscode.postMessage({ command: 'reconnectMCPServer', name });
    };

    const handleEdit = (server: MCPServerInfo, scope: MCPGroupScope) => {
        if (server.filePath) {
            openFileWithRange(vscode, server.filePath);
        }
    };

    const handleDelete = (server: MCPServerInfo, scope: MCPGroupScope) => {
        vscode.postMessage({ command: 'removeMCPServer', name: server.config.name, scope });
    };

    // 启停写入层由 core 按 server 所在层决定，不再传 scope
    const handleToggle = (server: MCPServerInfo, _scope: MCPGroupScope, enabled: boolean) => {
        vscode.postMessage({
            command: enabled ? 'enableMCPServer' : 'disableMCPServer',
            name: server.config.name,
        });
    };

    const handleSaveEdit = (config: MCPServerConfig, scope: MCPGroupScope) => {
        setIsSavingEdit(true);
        vscode.postMessage({ command: 'addMCPServer', data: { ...config, scope } });
    };

    const handleInstallClick = (item: MCPMarketInfo, scope: MCPGroupScope) => {
        const serverInfo: MCPServerInfo = {
            config: item.config as MCPServerConfig,
            connectStatus: 'disconnected',
            status: false,
        };
        setEditingServer({ server: serverInfo, scope, require: (item as any).require });
    };

    // 市场页「手动添加」：以示例配置为模板打开弹窗，默认写入用户级
    const handleManualAdd = () => {
        // add 模式下弹窗不预填内容，这里只是占位让弹窗渲染
        const serverInfo: MCPServerInfo = {
            config: { name: '', transport: 'stdio' } as MCPServerConfig,
            connectStatus: 'disconnected',
            status: false,
        };
        setEditingServer({ server: serverInfo, scope: 'project', mode: 'add' });
    };

    const handleMCPToolToggle = (mcpName: string, toolName: string, enabled: boolean) => {
        const server = [...groupedServers.project, ...groupedServers.user, ...groupedServers.plugin].find(s => s.config.name === mcpName);
        if (!server) return;

        const allToolNames = (server.capabilities?.tools || []).map(tool => tool.name);
        let currentEnabled = server.config.useTools === null || server.config.useTools === undefined
            ? [...allToolNames]
            : [...server.config.useTools];

        if (enabled) {
            if (!currentEnabled.includes(toolName)) currentEnabled.push(toolName);
        } else {
            currentEnabled = currentEnabled.filter(name => name !== toolName);
        }
        const toolsToSend = currentEnabled.length === allToolNames.length ? null : currentEnabled;

        setServers(prev => prev.map(s => s.config.name === mcpName
            ? { ...s, config: { ...s.config, useTools: toolsToSend } }
            : s
        ));

        vscode.postMessage({ command: 'updateMCPUseTools', name: mcpName, toolNames: toolsToSend });
    };

    const handleSystemToolToggle = (toolName: string, enabled: boolean) => {
        const newTools = systemTools.map(tool =>
            tool.name === toolName ? { ...tool, enabled, status: (enabled ? 'enable' : 'disable') as 'enable' | 'disable' } : tool
        );
        setSystemTools(newTools);
        const disabledTools = newTools.filter(tool => !tool.enabled).map(tool => tool.name);
        vscode.postMessage({ command: 'updateDisabledTools', disabledTools: disabledTools.length === 0 ? null : disabledTools });
    };

    const handleEnableToolSearch = () => {
        setEnablingToolSearch(true);
        vscode.postMessage({ command: 'saveSystemConfigByKey', key: 'enableToolSearch', value: true });
    };

    const toggleSection = (key: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    return (
        <div className="agent-config mcp-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'installed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('installed')}
                >
                    {t('common.installed')}
                    {totalToolCount > 0 && <span className="section-tab-count">{totalToolCount}</span>}
                </div>
                <div
                    className={`tab-item ${activeTab === 'market' ? 'active' : ''}`}
                    onClick={() => setActiveTab('market')}
                >
                    {t('config.mcp.tab.market')}
                </div>
                <div className="section-tab-actions">
                    <button
                        className="section-btn primary small"
                        onClick={handleManualAdd}
                        title={t('config.mcp.manualAddTip')}
                    >
                        <PlusIcon />
                        {t('config.mcp.manualAdd')}
                    </button>
                    {activeTab === 'installed' && (
                        <button
                            className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleRefresh}
                            title={t('config.mcp.refresh')}
                            disabled={isRefreshing}
                        >
                            {isRefreshing ? <span className="spinner" /> : <RefreshIcon size={14} />}
                        </button>
                    )}
                </div>
            </div>

            {/* Tab 内容 */}
            <div className="tab-content">
                {activeTab === 'installed' ? (
                    loading ? (
                        <div className="section-loading">{t('common.loading')}</div>
                    ) : (
                        <div className="section-groups">
                            {totalToolCount > MAX_TOOL_COUNT && toolSearchEnabled === false && (
                                <div className="mcp-tool-warning">
                                    <div className="mcp-tool-warning-icon"><WarningCircleIcon /></div>
                                    <div className="mcp-tool-warning-content">
                                        <div className="mcp-tool-warning-title">{t('config.mcp.tooManyTitle', { count: totalToolCount })}</div>
                                        <div className="mcp-tool-warning-desc">
                                            {t('config.mcp.tooManyDesc', { max: MAX_TOOL_COUNT })}
                                            {t('config.mcp.tooManyHintBefore')}<a
                                                href="#"
                                                className="mcp-tool-warning-link"
                                                onClick={(e) => { e.preventDefault(); onOpenSystemConfig?.(); }}
                                                title={t('config.mcp.goSystemConfig')}
                                            >{t('config.mcp.tooManyHintLink')}</a>{t('config.mcp.tooManyHintAfter')}
                                        </div>
                                        <div className="mcp-tool-warning-actions">
                                            <button
                                                className="section-btn primary small"
                                                onClick={handleEnableToolSearch}
                                                disabled={enablingToolSearch}
                                            >
                                                {enablingToolSearch ? t('config.mcp.enabling') : t('config.mcp.enableToolSearch')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 系统工具分组 */}
                            {systemTools.length > 0 && (() => {
                                const isCollapsed = collapsedSections.has('system');
                                return (
                                    <div className="section-group section-system">
                                        <div
                                            className="section-group-title section-group-title-collapsible"
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => toggleSection('system')}
                                        >
                                            {t('config.mcp.systemTools')}
                                            <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                        </div>
                                        {!isCollapsed && (
                                            <div className="section-list mcp-server-list">
                                                <SystemToolsCard tools={systemTools} onToolToggle={handleSystemToolToggle} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* MCP 分组 */}
                            {GROUP_ORDER.map(scope => {
                                const scopeServers = groupedServers[scope] || [];
                                if (scopeServers.length === 0 && scope !== 'project' && scope !== 'user') return null;

                                const isCollapsed = collapsedSections.has(scope);
                                const pathHint = GROUP_PATHS[scope];

                                return (
                                    <div key={scope} className={`section-group section-${scope}`}>
                                        <div
                                            className="section-group-title section-group-title-collapsible"
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => toggleSection(scope)}
                                        >
                                            {t(GROUP_TITLE_KEYS[scope])}
                                            {pathHint && <span className="section-group-count">({pathHint})</span>}
                                            <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                        </div>
                                        {!isCollapsed && (
                                            <div className="section-list mcp-server-list">
                                                {scopeServers.length === 0 ? (
                                                    <div className="section-empty">{t('config.mcp.empty')}</div>
                                                ) : (
                                                    scopeServers.map((server, index) => (
                                                        <MCPServerCard
                                                            key={`${server.config.name}-${index}`}
                                                            server={server}
                                                            scope={scope}
                                                            onReconnect={handleReconnect}
                                                            onEdit={handleEdit}
                                                            onDelete={handleDelete}
                                                            onToggle={handleToggle}
                                                            onToolToggle={handleMCPToolToggle}
                                                        />
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {systemTools.length === 0 && GROUP_ORDER.every(s => (groupedServers[s] || []).length === 0) && (
                                <div className="section-empty">{t('config.mcp.empty')}</div>
                            )}
                        </div>
                    )
                ) : (
                    <div className="mcp-market">
                        <div className="section-search-box">
                            <input
                                type="text"
                                className="section-search-input"
                                placeholder={t('config.mcp.searchPlaceholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="mcp-market-list">
                            {filteredMarketItems.map((item) => (
                                <MCPMarketCard
                                    key={item.config.name}
                                    item={item}
                                    isInstalled={installedNames.has(item.config.name)}
                                    onInstall={handleInstallClick}
                                    vscode={vscode}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* 编辑弹窗 */}
            {editingServer && (
                <MCPEditModal
                    server={editingServer.server}
                    scope={editingServer.scope}
                    require={editingServer.require}
                    mode={editingServer.mode}
                    installedNames={installedNames}
                    onClose={() => { setEditingServer(null); setIsSavingEdit(false); }}
                    onSave={handleSaveEdit}
                    vscode={vscode}
                    isSaving={isSavingEdit}
                />
            )}
        </div>
    );
};

export default MCPConfig;
