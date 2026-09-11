import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, EditIcon, TrashIcon, OpenIcon } from './utils/svgIcons';
import AddAgentForm from './AddAgentForm';
import { AgentScope, AgentConfig as AgentConfigItem } from './types/agent';
import { useT, I18nKey } from '../common/i18n/react';
import './style/section.css';
import './style/agent.css';

interface AgentConfigProps {
    vscode: VscodeApi;
}

type AgentTabType = 'installed' | 'add';

const LOCATE_ORDER: AgentScope[] = ['builtin', 'project', 'user', 'plugin'];

// 分组标题文案 key，渲染期经 t() 取值
const LOCATE_SECTION_TITLE_KEYS: Record<AgentScope, I18nKey> = {
    builtin: 'config.agent.group.builtin',
    plugin: 'config.agent.group.plugin',
    project: 'config.agent.group.project',
    user: 'config.agent.group.user'
};

const LOCATE_PATHS: Record<AgentScope, string> = {
    builtin: '',
    plugin: '',
    project: '.sema/agents/',
    user: '~/.sema/agents/'
};

const AgentConfig: React.FC<AgentConfigProps> = ({ vscode }) => {
    const t = useT();
    const [activeTab, setActiveTab] = useState<AgentTabType>('installed');
    const [agents, setAgents] = useState<AgentConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // 按位置分组 agents
    const groupedAgents = useMemo(() => {
        const groups: Record<AgentScope, AgentConfigItem[]> = {
            builtin: [],
            plugin: [],
            project: [],
            user: [],
        };
        agents.forEach(agent => {
            if (groups[agent.locate]) {
                groups[agent.locate].push(agent);
            }
        });
        return groups;
    }, [agents]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case 'loadAgentsInfoResult':
                    if (message.success) {
                        setAgents(message.data || []);
                    }
                    setLoading(false);
                    break;
                case 'refreshAgentsInfoResult':
                    setIsRefreshing(false);
                    if (message.success) {
                        setAgents(message.data || []);
                    }
                    break;
                case 'removeAgentResult':
                    if (message.success) {
                        vscode.postMessage({ command: 'loadAgentsInfo' });
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);

        // 加载 agent 信息
        vscode.postMessage({ command: 'loadAgentsInfo' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscode]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshAgents' });
    };

    // 切换工具展开状态
    const toggleToolsExpand = (agentIndex: number) => {
        setExpandedTools(prev => {
            const newSet = new Set(prev);
            if (newSet.has(agentIndex)) {
                newSet.delete(agentIndex);
            } else {
                newSet.add(agentIndex);
            }
            return newSet;
        });
    };

    // 切换描述展开状态
    const toggleDescriptionExpand = (agentIndex: number) => {
        setExpandedDescriptions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(agentIndex)) {
                newSet.delete(agentIndex);
            } else {
                newSet.add(agentIndex);
            }
            return newSet;
        });
    };

    // 渲染工具列表
    const renderTools = (tools: string[] | '*' | undefined, agentIndex: number) => {
        if (!tools) {
            return <span className="tools-none">{t('config.agent.noTools')}</span>;
        }
        if (tools === '*') {
            return <span className="tools-all">{t('config.agent.allTools')}</span>;
        }
        if (tools.length === 0) {
            return <span className="tools-none">{t('config.agent.noTools')}</span>;
        }

        const isExpanded = expandedTools.has(agentIndex);
        const displayTools = isExpanded ? tools : tools.slice(0, 3);
        const hasMore = tools.length > 3;

        return (
            <div className="tools-list">
                {displayTools.map((tool, index) => (
                    <span key={index} className="tool-tag">{tool}</span>
                ))}
                {hasMore && !isExpanded && (
                    <span
                        className="tool-tag tool-more"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleToolsExpand(agentIndex);
                        }}
                    >
                        +{tools.length - 3}
                    </span>
                )}
                {hasMore && isExpanded && (
                    <span
                        className="tool-tag tool-collapse"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleToolsExpand(agentIndex);
                        }}
                    >
                        {t('common.collapse')}
                    </span>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="agent-config">
                <div className="section-loading">{t('common.loading')}</div>
            </div>
        );
    }

    // 获取 agent 名称的首字符（大写）
    const getAgentInitial = (name: string): string => {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    };

    // 获取模型标签的类名
    const getModelBadgeClass = (model: string): string => {
        if (model === 'main' || model === 'quick') {
            return `model-badge model-${model}`;
        }
        return 'model-badge model-default';
    };

    const handleEditAgent = (agent: AgentConfigItem) => {
        if (agent.filePath) {
            vscode.postMessage({ command: 'openFile', filePath: agent.filePath });
        }
    };

    const handleDeleteAgent = (agent: AgentConfigItem) => {
        vscode.postMessage({ command: 'removeAgent', name: agent.name });
    };

    // 渲染单个 agent 卡片
    const renderAgentCard = (agent: AgentConfigItem, globalIndex: number) => {
        const LongDescValue = 150
        const description = agent.description || t('common.noDescription');
        const isDescriptionExpanded = expandedDescriptions.has(globalIndex);
        const isLongDescription = description.length > LongDescValue;
        const isReadonly = agent.locate === 'builtin' || agent.locate === 'plugin';

        return (
            <div key={globalIndex} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(agent.name) }}>
                        {getAgentInitial(agent.name)}
                    </div>
                    <div className="section-card-name-group">
                        <span className="section-card-name">{agent.name}</span>
                        {isReadonly && (
                            <span className="readonly-tab">{t('common.readonly')}</span>
                        )}
                    </div>
                    {!isReadonly && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title={t('common.edit')}
                                onClick={(e) => { e.stopPropagation(); handleEditAgent(agent); }}
                            >
                                <EditIcon />
                            </button>
                            <button
                                className="section-icon-btn section-icon-btn-danger"
                                title={t('common.delete')}
                                onClick={(e) => { e.stopPropagation(); handleDeleteAgent(agent); }}
                            >
                                <TrashIcon />
                            </button>
                        </div>
                    )}
                    {agent.locate === 'plugin' && agent.filePath && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title={t('common.open')}
                                onClick={(e) => { e.stopPropagation(); handleEditAgent(agent); }}
                            >
                                <OpenIcon />
                            </button>
                        </div>
                    )}
                </div>
                <div className={`section-card-desc ${isLongDescription && !isDescriptionExpanded ? 'collapsed' : ''}`}>
                    {isLongDescription && !isDescriptionExpanded
                        ? description.slice(0, LongDescValue) + '...'
                        : description
                    }
                    {isLongDescription && (
                        <span
                            className="description-toggle"
                            onClick={() => toggleDescriptionExpand(globalIndex)}
                        >
                            {isDescriptionExpanded ? t('common.collapse') : t('common.more')}
                        </span>
                    )}
                </div>
                {agent.model && (
                    <div className="agent-model-row">
                        <span className="tools-label">{t('config.agent.modelLabel')}</span>
                        <span className={getModelBadgeClass(agent.model)}>
                            {agent.model}
                        </span>
                    </div>
                )}
                <div className="agent-tools">
                    <span className="tools-label">{t('config.agent.toolsLabel')}</span>
                    {renderTools(agent.tools, globalIndex)}
                </div>
            </div>
        );
    };

    // 计算全局索引
    const getGlobalIndex = (locate: AgentScope, localIndex: number): number => {
        let offset = 0;
        for (const loc of LOCATE_ORDER) {
            if (loc === locate) break;
            offset += groupedAgents[loc].length;
        }
        return offset + localIndex;
    };

    const handleCreateSuccess = () => {
        vscode.postMessage({ command: 'loadAgentsInfo' });
        setActiveTab('installed');
    };

    const ALL_SECTIONS: AgentScope[] = LOCATE_ORDER;

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'installed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('installed')}
                >
                    {t('common.installed')}
                    {agents.length > 0 && (
                        <span className="section-tab-count">{agents.length}</span>
                    )}
                </div>
                <div
                    className={`tab-item ${activeTab === 'add' ? 'active' : ''}`}
                    onClick={() => setActiveTab('add')}
                >
                    {t('config.agent.create')}
                </div>
                <div className="section-tab-actions">
                    <button
                        className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title={t('config.agent.refresh')}
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
                <div style={{ display: activeTab === 'add' ? 'block' : 'none' }}>
                    <AddAgentForm
                        vscode={vscode}
                        onSuccess={handleCreateSuccess}
                        onClose={() => setActiveTab('installed')}
                    />
                </div>
                {activeTab === 'installed' && (
                    <div className="section-groups">
                        {ALL_SECTIONS.map(scope => {
                            const sectionAgents = groupedAgents[scope] || [];
                            // 项目级 / 用户级 始终显示；内置、插件级为空时隐藏
                            if (sectionAgents.length === 0 && scope !== 'project' && scope !== 'user') return null;

                            const isCollapsed = collapsedSections.has(scope);
                            const toggleCollapse = () => setCollapsedSections(prev => {
                                const next = new Set(prev);
                                if (next.has(scope)) next.delete(scope); else next.add(scope);
                                return next;
                            });

                            return (
                                <div key={scope} className={`section-group section-${scope}`}>
                                    <div className="section-group-title section-group-title-collapsible" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={toggleCollapse}>
                                        {t(LOCATE_SECTION_TITLE_KEYS[scope])}
                                        {LOCATE_PATHS[scope] && (
                                            <span className="section-group-count">({LOCATE_PATHS[scope]})</span>
                                        )}
                                        <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                    </div>
                                    {!isCollapsed && (sectionAgents.length === 0 ? (
                                        <div className="section-empty">{t('config.agent.empty')}</div>
                                    ) : (
                                        <div className="section-list">
                                            {sectionAgents.map((agent, localIndex) =>
                                                renderAgentCard(agent, getGlobalIndex(scope, localIndex))
                                            )}
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentConfig;
