import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi, ToolInfo, SystemToolInfo } from './types';
import { MCPServerInfo, MCPServerConfig, MCPScopeType } from './types/mcp';
import { ExpandArrowIcon, RefreshIcon, EditIcon, TrashIcon, CloseIcon, GearIcon, GitHubIcon, WarningCircleIcon } from './utils/svgIcons';
import { defaultMCPMarketInfos, MCPMarketInfo } from './default/defaultMCPMarket';
import { inlineSvgIcons } from './mcpIcon';
import { initialBgColors, hashString } from './utils/iconUtils';
import './style/section.css';
import './style/mcp.css';


type MCPTabType = 'installed' | 'market';
type MCPGroupScope = 'project' | 'user' | 'plugin' | 'external';

const GROUP_ORDER: MCPGroupScope[] = ['project', 'user', 'plugin', 'external'];

const GROUP_TITLES: Record<MCPGroupScope, string> = {
    project: '项目级 MCP',
    user: '用户级 MCP',
    plugin: '插件 MCP',
    external: '外部 MCP',
};

const GROUP_PATHS: Record<MCPGroupScope, string> = {
    project: '.sema/.mcp.json',
    user: '~/.sema/.mcp.json',
    plugin: '',
    external: '',
};

// 各分组允许的操作
const GROUP_ACTIONS: Record<MCPGroupScope, { canEdit: boolean; canDelete: boolean; canToggle: boolean; canToolToggle: boolean }> = {
    project: { canEdit: true, canDelete: true, canToggle: true, canToolToggle: true },
    user: { canEdit: true, canDelete: true, canToggle: true, canToolToggle: true },
    plugin: { canEdit: false, canDelete: false, canToggle: true, canToolToggle: true },
    external: { canEdit: false, canDelete: false, canToggle: true, canToolToggle: true },
};

const MAX_TOOL_COUNT = 30;

const statusColors: Record<string, string> = {
    disconnected: '#6b7280',
    connecting: '#f59e0b',
    connected: '#10b981',
    error: '#ef4444',
};

const statusText: Record<string, string> = {
    disconnected: '未连接',
    connecting: '连接中',
    connected: '已连接',
    error: '错误',
};

// 将后端返回的分组/数组数据展开为平铺列表
function flattenServers(data: any): MCPServerInfo[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return [
        ...(data.project || []),
        ...(data.user || []),
        ...(data.plugin || []),
        ...(data.external || data.local || []),
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
    const [expanded, setExpanded] = useState(false);
    const tools = server.capabilities?.tools || [];
    const toolCount = tools.length;

    const { canEdit, canDelete, canToggle, canToolToggle } = GROUP_ACTIONS[scope];

    const connectStatus = (server as any).connectStatus;
    const statusKey = typeof connectStatus === 'string' ? connectStatus : 'disconnected';

    const isToolEnabled = (toolName: string): boolean => {
        if (server.config.useTools === null || server.config.useTools === undefined) return true;
        return server.config.useTools.includes(toolName);
    };

    const enabledToolCount = tools.filter(tool => isToolEnabled(tool.name)).length;

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
                    title={statusText[statusKey] || statusKey}
                />
                {statusKey === 'error' && (server as any).error && (
                    <span className="mcp-error-hint" title={(server as any).error}>!</span>
                )}
                {!canEdit && <span className="readonly-tab">只读</span>}
                {scope === 'external' && ((server.config as any)?.from || (server as any)?.from) && (
                    <span className="readonly-tab">{(server.config as any)?.from || (server as any)?.from}</span>
                )}
                <div className="section-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                        className="section-icon-btn"
                        onClick={() => onReconnect(server.config.name)}
                        title={server.status !== true ? '服务未生效，无法重连' : '重新连接'}
                        disabled={server.status !== true}
                    >
                        <RefreshIcon />
                    </button>
                    {canEdit && (
                        <button
                            className="section-icon-btn"
                            onClick={() => onEdit(server, scope)}
                            title="编辑配置"
                        >
                            <EditIcon />
                        </button>
                    )}
                    {canDelete && (
                        <button
                            className="section-icon-btn section-icon-btn-danger"
                            onClick={() => onDelete(server, scope)}
                            title="删除"
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
                <div className="mcp-server-tools">
                    <div className="mcp-tools-header">{enabledToolCount}/{toolCount} Tools</div>
                    {toolCount > 0 ? (
                        <div className="mcp-tools-list">
                            {tools.map((tool, index) => (
                                <div key={index} className="mcp-tool-item mcp-tool-item-with-switch">
                                    <span className="mcp-tool-name">{tool.name}</span>
                                    <span className="mcp-tool-desc">{tool.description || '-'}</span>
                                    {canToolToggle && (
                                        <label className="mcp-tool-switch">
                                            <input
                                                type="checkbox"
                                                checked={isToolEnabled(tool.name)}
                                                onChange={(e) => onToolToggle(server.config.name, tool.name, e.target.checked)}
                                            />
                                            <span className="mcp-tool-switch-slider"></span>
                                        </label>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="mcp-tools-empty">暂无工具</div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── SystemToolsCard ─────────────────────────────────────────────────────────

const SystemToolsCard: React.FC<{
    tools: SystemToolInfo[];
    onToolToggle: (toolName: string, enabled: boolean) => void;
}> = ({ tools, onToolToggle }) => {
    const [expanded, setExpanded] = useState(true);
    const enabledCount = tools.filter(t => t.enabled).length;
    const toolCount = tools.length;

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
                <span className="section-card-name">内置工具</span>
                <span className="readonly-tab">只读</span>
                <span
                    className="mcp-status-dot"
                    style={{ backgroundColor: '#10b981' }}
                    title="已连接"
                />
            </div>
            {expanded && (
                <div className="mcp-server-tools">
                    <div className="mcp-tools-header">{enabledCount}/{toolCount} Tools</div>
                    {toolCount > 0 ? (
                        <div className="mcp-tools-list">
                            {tools.map((tool, index) => (
                                <div key={index} className="mcp-tool-item mcp-tool-item-with-switch">
                                    <span className="mcp-tool-name">{tool.name}</span>
                                    <span className="mcp-tool-desc">{tool.description || '-'}</span>
                                    <label className="mcp-tool-switch">
                                        <input
                                            type="checkbox"
                                            checked={tool.enabled}
                                            onChange={(e) => onToolToggle(tool.name, e.target.checked)}
                                        />
                                        <span className="mcp-tool-switch-slider"></span>
                                    </label>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="mcp-tools-empty">暂无工具</div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── MCPEditModal ─────────────────────────────────────────────────────────────

const MCPEditModal: React.FC<{
    server: MCPServerInfo | null;
    scope: MCPGroupScope;
    require?: Record<string, string>;
    onClose: () => void;
    onSave: (config: MCPServerConfig, scope: MCPGroupScope) => void;
    vscode: VscodeApi;
    isSaving?: boolean;
}> = ({ server, scope, require, onClose, onSave, vscode, isSaving }) => {
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const showNpxHint = useMemo(() => {
        if (!server) return false;
        const cmd = server.config.command?.toLowerCase();
        return cmd === 'npx' || cmd?.endsWith('/npx');
    }, [server]);

    const showUvxHint = useMemo(() => {
        if (!server) return false;
        const cmd = server.config.command?.toLowerCase();
        return cmd === 'uvx' || cmd?.endsWith('/uvx');
    }, [server]);

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
        if (server) {
            const { name, ...restConfig } = server.config;
            setJsonText(JSON.stringify({ mcpServers: { [name]: restConfig } }, null, 2));
            setError(null);
        }
    }, [server]);

    const handleSave = () => {
        try {
            const parsed = JSON.parse(jsonText);
            if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
                setError('格式错误：需要 mcpServers 对象'); return;
            }
            const serverNames = Object.keys(parsed.mcpServers);
            if (serverNames.length !== 1) {
                setError('格式错误：mcpServers 中只能有一个服务配置'); return;
            }
            const name = serverNames[0];
            const config: MCPServerConfig = { name, ...parsed.mcpServers[name] };
            if (!config.transport) { setError('transport 字段是必需的'); return; }
            if (require) {
                const unreplacedKeys = checkRequirePlaceholders(config, Object.keys(require));
                if (unreplacedKeys.length > 0) {
                    setError(`请将 ${unreplacedKeys.map(k => `'${k}'`).join('、')} 替换为实际值`); return;
                }
            }
            onSave(config, scope);
        } catch {
            setError('JSON 格式错误');
        }
    };

    if (!server) return null;

    const renderRequireHints = () => {
        if (!require || Object.keys(require).length === 0) return null;
        return (
            <div className="mcp-require-hint">
                <span className="mcp-require-hint-prefix">请将 </span>
                {Object.entries(require).map(([key, desc], index, arr) => (
                    <span key={key}>
                        '<span className="mcp-require-key">{key}</span>'
                        <span className="mcp-require-desc">（{desc}）</span>
                        {index < arr.length - 1 && '、'}
                    </span>
                ))}
                <span className="mcp-require-hint-suffix"> 替换为自己的值</span>
            </div>
        );
    };

    return (
        <div className="section-modal-overlay" onClick={onClose}>
            <div className="section-modal" onClick={(e) => e.stopPropagation()}>
                <div className="section-modal-header">
                    <span>编辑 MCP 配置 - {server.config.name}</span>
                    <button className="section-modal-close" onClick={onClose}><CloseIcon /></button>
                </div>
                <div className="section-modal-body">
                    {showNpxHint && (
                        <div className="mcp-npx-hint">
                            <span className="mcp-npx-hint-text">本地需要 npx 环境</span>
                            <a href="#" className="mcp-npx-hint-link" onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: 'https://nodejs.org/' }); }}>如何安装？</a>
                        </div>
                    )}
                    {showUvxHint && (
                        <div className="mcp-npx-hint">
                            <span className="mcp-npx-hint-text">本地需要 uvx 环境</span>
                            <a href="#" className="mcp-npx-hint-link" onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: 'https://docs.astral.sh/uv/getting-started/installation/' }); }}>如何安装？</a>
                        </div>
                    )}
                    {renderRequireHints()}
                    <textarea
                        className="mcp-json-editor"
                        value={jsonText}
                        onChange={(e) => { setJsonText(e.target.value); setError(null); }}
                        spellCheck={false}
                    />
                    {error && <div className="section-edit-error">{error}</div>}
                </div>
                <div className="section-modal-footer">
                    <button className="section-btn secondary" onClick={onClose} disabled={isSaving}>取消</button>
                    <button className={`section-btn primary ${isSaving ? 'btn-loading' : ''}`} onClick={handleSave} disabled={isSaving}>
                        {isSaving && <span className="spinner" />}
                        {isSaving ? '保存中...' : '确定'}
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
                        <span className="section-installed-badge">已安装</span>
                    ) : (
                        <div className="section-install-btns">
                            <button className="section-btn secondary small" onClick={() => onInstall(item, 'project')} title="安装到当前项目">项目添加</button>
                            <button className="section-btn primary small" onClick={() => onInstall(item, 'user')} title="安装到用户全局">全局添加</button>
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
                    <a href="#" className="mcp-github-link" onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: item.github }); }} title="查看源码">
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
}

const MCPConfig: React.FC<MCPConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<MCPTabType>('installed');
    const [servers, setServers] = useState<MCPServerInfo[]>([]);
    const [systemTools, setSystemTools] = useState<SystemToolInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
    const [editingServer, setEditingServer] = useState<{ server: MCPServerInfo; scope: MCPGroupScope; require?: Record<string, string> } | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // 根据 scope 和 from 字段分组：from === 'claude' 归入外部 MCP
    const groupedServers = useMemo(() => {
        const groups: Record<MCPGroupScope, MCPServerInfo[]> = {
            project: [], user: [], plugin: [], external: [],
        };
        servers.forEach(server => {
            const from = server.config?.from || server.from;
            if (from === 'claude') {
                groups.external.push(server);
                return;
            }
            const scope = (server.config?.scope || server.scope) as MCPGroupScope;
            if (scope === 'project') groups.project.push(server);
            else if (scope === 'user') groups.user.push(server);
            else if (scope === 'plugin') groups.plugin.push(server);
            else groups.external.push(server);
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
        const systemCount = systemTools.filter(t => t.enabled).length;
        const mcpCount = [...groupedServers.project, ...groupedServers.user, ...groupedServers.plugin, ...groupedServers.external]
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
                    if (message.success && message.data) setServers(flattenServers(message.data));
                    break;
                case 'loadSystemToolsResult':
                    if (message.success && message.data) {
                        setSystemTools((message.data as ToolInfo[]).map(tool => ({
                            ...tool,
                            enabled: tool.status === 'enable',
                        })));
                    }
                    break;
                case 'updateUseToolsResult':
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
            vscode.postMessage({ command: 'openFile', filePath: server.filePath });
        }
    };

    const handleDelete = (server: MCPServerInfo, scope: MCPGroupScope) => {
        vscode.postMessage({ command: 'removeMCPServer', name: server.config.name, scope });
    };

    const handleToggle = (server: MCPServerInfo, scope: MCPGroupScope, enabled: boolean) => {
        vscode.postMessage({
            command: enabled ? 'enableMCPServer' : 'disableMCPServer',
            name: server.config.name,
            scope,
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

    const handleMCPToolToggle = (mcpName: string, toolName: string, enabled: boolean) => {
        const server = [...groupedServers.project, ...groupedServers.user, ...groupedServers.plugin, ...groupedServers.external].find(s => s.config.name === mcpName);
        if (!server) return;

        const allToolNames = (server.capabilities?.tools || []).map(t => t.name);
        let currentEnabled = server.config.useTools === null || server.config.useTools === undefined
            ? [...allToolNames]
            : [...server.config.useTools];

        if (enabled) {
            if (!currentEnabled.includes(toolName)) currentEnabled.push(toolName);
        } else {
            currentEnabled = currentEnabled.filter(t => t !== toolName);
        }
        const toolsToSend = currentEnabled.length === allToolNames.length ? null : currentEnabled;

        setServers(prev => prev.map(s => s.config.name === mcpName
            ? { ...s, config: { ...s.config, useTools: toolsToSend } }
            : s
        ));

        vscode.postMessage({ command: 'updateMCPUseTools', name: mcpName, toolNames: toolsToSend });
    };

    const handleSystemToolToggle = (toolName: string, enabled: boolean) => {
        const newTools = systemTools.map(t =>
            t.name === toolName ? { ...t, enabled, status: (enabled ? 'enable' : 'disable') as 'enable' | 'disable' } : t
        );
        setSystemTools(newTools);
        const enabledTools = newTools.filter(t => t.enabled).map(t => t.name);
        vscode.postMessage({ command: 'updateUseTools', tools: enabledTools.length === newTools.length ? null : enabledTools });
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
                    已安装
                    {totalToolCount > 0 && <span className="section-tab-count">{totalToolCount}</span>}
                </div>
                <div
                    className={`tab-item ${activeTab === 'market' ? 'active' : ''}`}
                    onClick={() => setActiveTab('market')}
                >
                    MCP 市场
                </div>
                <div className="section-tab-actions">
                    {activeTab === 'installed' && (
                        <button
                            className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleRefresh}
                            title="刷新 MCP"
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
                        <div className="section-loading">加载中...</div>
                    ) : (
                        <div className="section-groups">
                            {totalToolCount > MAX_TOOL_COUNT && (
                                <div className="mcp-tool-warning">
                                    <div className="mcp-tool-warning-icon"><WarningCircleIcon /></div>
                                    <div className="mcp-tool-warning-content">
                                        <div className="mcp-tool-warning-title">工具数量过多（当前 {totalToolCount} 个）</div>
                                        <div className="mcp-tool-warning-desc">
                                            建议启用的工具总数不超过 {MAX_TOOL_COUNT} 个，过多的工具可能会影响 AI 的选择准确性。
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
                                            系统工具
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
                                            {GROUP_TITLES[scope]}
                                            {pathHint && <span className="section-group-count">({pathHint})</span>}
                                            <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                        </div>
                                        {!isCollapsed && (
                                            <div className="section-list mcp-server-list">
                                                {scopeServers.length === 0 ? (
                                                    <div className="section-empty">暂无 MCP 服务</div>
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
                                <div className="section-empty">暂无 MCP 服务</div>
                            )}
                        </div>
                    )
                ) : (
                    <div className="mcp-market">
                        <div className="section-search-box">
                            <input
                                type="text"
                                className="section-search-input"
                                placeholder="搜索 MCP 服务..."
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
