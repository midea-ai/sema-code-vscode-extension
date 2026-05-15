import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, EditIcon, TrashIcon, OpenIcon } from './utils/svgIcons';
import AddCommandForm from './AddCommandForm';
import { CommandScope, CommandConfig as CommandConfigItem } from './types/command';
import './style/section.css';
import './style/agent.css';

interface CommandConfigProps {
    vscode: VscodeApi;
}

type CommandTabType = 'installed' | 'add';

const LOCATE_ORDER: CommandScope[] = ['project', 'user', 'plugin'];

const LOCATE_SECTION_TITLES: Record<CommandScope, string> = {
    plugin: '插件 Commands',
    project: '项目级 Commands',
    user: '用户级 Commands',
};

const LOCATE_PATHS: Record<CommandScope, string> = {
    plugin: '',
    project: '.sema/commands/',
    user: '~/.sema/commands/',
};

const CommandConfig: React.FC<CommandConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<CommandTabType>('installed');
    const [commands, setCommands] = useState<CommandConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    const groupedCommands = useMemo(() => {
        const groups: Record<CommandScope, CommandConfigItem[]> = {
            plugin: [],
            project: [],
            user: [],
        };
        commands.forEach(cmd => {
            if (cmd.locate && groups[cmd.locate]) {
                groups[cmd.locate].push(cmd);
            }
        });
        return groups;
    }, [commands]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadCommandsInfoResult':
                    if (message.success) {
                        setCommands(message.data || []);
                    }
                    setLoading(false);
                    break;
                case 'refreshCommandsInfoResult':
                    setIsRefreshing(false);
                    if (message.success) {
                        setCommands(message.data || []);
                    }
                    break;
                case 'removeCommandResult':
                    if (message.success) {
                        vscode.postMessage({ command: 'loadCommandsInfo' });
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadCommandsInfo' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscode]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshCommandsInfo' });
    };

    const toggleDescriptionExpand = (index: number) => {
        setExpandedDescriptions(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
        });
    };

    const getCommandInitial = (name: string): string => {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    };

    const handleEditCommand = (cmd: CommandConfigItem) => {
        if (cmd.filePath) {
            vscode.postMessage({ command: 'openFile', filePath: cmd.filePath });
        }
    };

    const handleDeleteCommand = (cmd: CommandConfigItem) => {
        vscode.postMessage({ command: 'removeCommand', name: cmd.name });
    };

    const renderCommandCard = (cmd: CommandConfigItem, globalIndex: number) => {
        const DESC_MAX = 150;
        const description = cmd.description || '暂无描述';
        const isDescExpanded = expandedDescriptions.has(globalIndex);
        const isLongDesc = description.length > DESC_MAX;
        const isReadonly = cmd.locate === 'plugin';

        return (
            <div key={globalIndex} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(cmd.name) }}>
                        {getCommandInitial(cmd.name)}
                    </div>
                    <div className="section-card-name-group">
                        <span className="section-card-name">/{cmd.name}</span>
                        {isReadonly && (
                            <span className="readonly-tab">只读</span>
                        )}
                    </div>
                    {!isReadonly && (
                        <div className="section-card-actions">
                            {cmd.filePath && (
                                <button
                                    className="section-icon-btn"
                                    title="编辑"
                                    onClick={(e) => { e.stopPropagation(); handleEditCommand(cmd); }}
                                >
                                    <EditIcon />
                                </button>
                            )}
                            <button
                                className="section-icon-btn section-icon-btn-danger"
                                title="删除"
                                onClick={(e) => { e.stopPropagation(); handleDeleteCommand(cmd); }}
                            >
                                <TrashIcon />
                            </button>
                        </div>
                    )}
                    {cmd.locate === 'plugin' && cmd.filePath && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title="打开"
                                onClick={(e) => { e.stopPropagation(); handleEditCommand(cmd); }}
                            >
                                <OpenIcon />
                            </button>
                        </div>
                    )}
                </div>
                <div className={`section-card-desc ${isLongDesc && !isDescExpanded ? 'collapsed' : ''}`}>
                    {isLongDesc && !isDescExpanded
                        ? description.slice(0, DESC_MAX) + '...'
                        : description
                    }
                    {isLongDesc && (
                        <span
                            className="description-toggle"
                            onClick={() => toggleDescriptionExpand(globalIndex)}
                        >
                            {isDescExpanded ? '收起' : '更多'}
                        </span>
                    )}
                </div>
                {cmd.argumentHint && (
                    <div className="section-card-desc">
                        <span className="tools-label">参数提示:</span>{' '}
                        {Array.isArray(cmd.argumentHint)
                            ? cmd.argumentHint.map((hint, i) => (
                                <span key={i} className="model-badge model-default" style={{ marginRight: 4 }}>{hint}</span>
                            ))
                            : <span className="model-badge model-default">{cmd.argumentHint}</span>
                        }
                    </div>
                )}
            </div>
        );
    };

    const getGlobalIndex = (locate: CommandScope, localIndex: number): number => {
        let offset = 0;
        for (const loc of LOCATE_ORDER) {
            if (loc === locate) break;
            offset += groupedCommands[loc].length;
        }
        return offset + localIndex;
    };

    const handleCreateSuccess = () => {
        vscode.postMessage({ command: 'loadCommandsInfo' });
        setActiveTab('installed');
    };

    const ALL_SECTIONS: CommandScope[] = LOCATE_ORDER;

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'installed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('installed')}
                >
                    已安装
                    {commands.length > 0 && (
                        <span className="section-tab-count">{commands.length}</span>
                    )}
                </div>
                <div
                    className={`tab-item ${activeTab === 'add' ? 'active' : ''}`}
                    onClick={() => setActiveTab('add')}
                >
                    创建 Command
                </div>
                <div className="section-tab-actions">
                    {activeTab === 'installed' && (
                        <button
                            className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleRefresh}
                            title="刷新 Commands"
                            disabled={isRefreshing}
                        >
                            {isRefreshing ? (
                                <span className="spinner" />
                            ) : (
                                <RefreshIcon size={14} />
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Tab 内容 */}
            <div className="tab-content">
                <div style={{ display: activeTab === 'add' ? 'block' : 'none' }}>
                    <AddCommandForm
                        vscode={vscode}
                        onSuccess={handleCreateSuccess}
                        onClose={() => setActiveTab('installed')}
                    />
                </div>
                {activeTab !== 'add' && loading ? (
                    <div className="section-loading">加载中...</div>
                ) : activeTab !== 'add' ? (
                    <div className="section-groups">
                        {ALL_SECTIONS.map(scope => {
                            const sectionCommands = groupedCommands[scope] || [];
                            if (sectionCommands.length === 0) return null;

                            const isCollapsed = collapsedSections.has(scope);
                            const toggleCollapse = () => setCollapsedSections(prev => {
                                const next = new Set(prev);
                                if (next.has(scope)) next.delete(scope); else next.add(scope);
                                return next;
                            });

                            return (
                                <div key={scope} className={`section-group section-${scope}`}>
                                    <div
                                        className="section-group-title section-group-title-collapsible"
                                        style={{ cursor: 'pointer', userSelect: 'none' }}
                                        onClick={toggleCollapse}
                                    >
                                        {LOCATE_SECTION_TITLES[scope]}
                                        {LOCATE_PATHS[scope] && (
                                            <span className="section-group-count">({LOCATE_PATHS[scope]})</span>
                                        )}
                                        <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                    </div>
                                    {!isCollapsed && (
                                        sectionCommands.length === 0 ? (
                                            <div className="section-empty">暂无 Command</div>
                                        ) : (
                                            <div className="section-list">
                                                {sectionCommands.map((cmd, localIndex) =>
                                                    renderCommandCard(cmd, getGlobalIndex(scope, localIndex))
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                            );
                        })}
                        {ALL_SECTIONS.every(s => (groupedCommands[s] || []).length === 0) && (
                            <div className="section-empty">暂无 Command</div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default CommandConfig;
