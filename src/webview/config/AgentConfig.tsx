import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, EditIcon, TrashIcon } from './utils/svgIcons';
import AddAgentForm from './AddAgentForm';
import { AgentScope, AgentConfig as AgentConfigItem } from './types/agent';
import './style/section.css';
import './style/agent.css';

interface AgentConfigProps {
    vscode: VscodeApi;
}

type AgentTabType = 'installed' | 'add';

const LOCATE_ORDER: AgentScope[] = ['builtin', 'project', 'user', 'plugin'];

const LOCATE_SECTION_TITLES: Record<AgentScope, string> = {
    builtin: '内置 Agents',
    plugin: '插件 Agents',
    project: '项目级 Agents',
    user: '用户级 Agents'
};

const LOCATE_PATHS: Record<AgentScope, string> = {
    builtin: '',
    plugin: '',
    project: '.sema/agents/',
    user: '~/.sema/agents/'
};

const AgentConfig: React.FC<AgentConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<AgentTabType>('installed');
    const [agents, setAgents] = useState<AgentConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // 按位置分组 agents，其他来源单独归为 other
    const groupedAgents = useMemo(() => {
        const groups: Record<AgentScope | 'other', AgentConfigItem[]> = {
            builtin: [],
            plugin: [],
            project: [],
            user: [],
            other: []
        };
        agents.forEach(agent => {
            if (agent.from && agent.from !== 'sema') {
                groups.other.push(agent);
            } else if (groups[agent.locate]) {
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
            return <span className="tools-none">无工具</span>;
        }
        if (tools === '*') {
            return <span className="tools-all">所有工具</span>;
        }
        if (tools.length === 0) {
            return <span className="tools-none">无工具</span>;
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
                        收起
                    </span>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="agent-config">
                <div className="section-loading">加载中...</div>
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
        const description = agent.description || '暂无描述';
        const isDescriptionExpanded = expandedDescriptions.has(globalIndex);
        const isLongDescription = description.length > LongDescValue;
        const isReadonly = (agent.from && agent.from !== 'sema') || agent.locate === 'builtin' || agent.locate === 'plugin';

        return (
            <div key={globalIndex} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(agent.name) }}>
                        {getAgentInitial(agent.name)}
                    </div>
                    <div className="section-card-name-group">
                        <span className="section-card-name">{agent.name}</span>
                        {isReadonly && (
                            <span className="readonly-tab">只读</span>
                        )}
                        {agent.from && agent.from !== 'sema' && (
                            <span className="readonly-tab">{agent.from}</span>
                        )}
                    </div>
                    {!isReadonly && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title="编辑"
                                onClick={(e) => { e.stopPropagation(); handleEditAgent(agent); }}
                            >
                                <EditIcon />
                            </button>
                            <button
                                className="section-icon-btn section-icon-btn-danger"
                                title="删除"
                                onClick={(e) => { e.stopPropagation(); handleDeleteAgent(agent); }}
                            >
                                <TrashIcon />
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
                            {isDescriptionExpanded ? '收起' : '更多'}
                        </span>
                    )}
                </div>
                {agent.model && (
                    <div className="agent-model-row">
                        <span className="tools-label">模型:</span>
                        <span className={getModelBadgeClass(agent.model)}>
                            {agent.model}
                        </span>
                    </div>
                )}
                <div className="agent-tools">
                    <span className="tools-label">工具:</span>
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

    const ALL_SECTIONS: Array<AgentScope | 'other'> = [...LOCATE_ORDER, 'other'];
    const SECTION_TITLES: Record<AgentScope | 'other', string> = {
        ...LOCATE_SECTION_TITLES,
        other: '外部 Agents',
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
                    {agents.length > 0 && (
                        <span className="section-tab-count">{agents.length}</span>
                    )}
                </div>
                <div
                    className={`tab-item ${activeTab === 'add' ? 'active' : ''}`}
                    onClick={() => setActiveTab('add')}
                >
                    创建 Agent
                </div>
                <div className="section-tab-actions">
                    <button
                        className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title="刷新 Agents"
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
                            if (sectionAgents.length === 0) return null;

                            const isCollapsed = collapsedSections.has(scope);
                            const toggleCollapse = () => setCollapsedSections(prev => {
                                const next = new Set(prev);
                                if (next.has(scope)) next.delete(scope); else next.add(scope);
                                return next;
                            });

                            return (
                                <div key={scope} className={`section-group section-${scope}`}>
                                    <div className="section-group-title section-group-title-collapsible" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={toggleCollapse}>
                                        {SECTION_TITLES[scope]}
                                        {scope !== 'other' && LOCATE_PATHS[scope as AgentScope] && (
                                            <span className="section-group-count">({LOCATE_PATHS[scope as AgentScope]})</span>
                                        )}
                                        <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                    </div>
                                    {!isCollapsed && (sectionAgents.length === 0 ? (
                                        <div className="section-empty">暂无 Agent</div>
                                    ) : (
                                        <div className="section-list">
                                            {sectionAgents.map((agent, localIndex) =>
                                                renderAgentCard(agent, getGlobalIndex(scope as AgentScope, localIndex))
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
