import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, ExpandArrowIcon, OpenIcon } from './utils/svgIcons';
import { DesignSkillInfo, DesignSystemInfo, DesignSystemColor } from './types/design';
import './style/section.css';

interface DesignConfigProps {
    vscode: VscodeApi;
}

type DesignTabType = 'skills' | 'systems';

const DesignConfig: React.FC<DesignConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<DesignTabType>('systems');

    const [skills, setSkills] = useState<DesignSkillInfo[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [skillsRefreshing, setSkillsRefreshing] = useState(false);

    const [systems, setSystems] = useState<DesignSystemInfo[]>([]);
    const [systemsLoading, setSystemsLoading] = useState(true);
    const [systemsRefreshing, setSystemsRefreshing] = useState(false);

    const [expandedSkillDesc, setExpandedSkillDesc] = useState<Set<number>>(new Set());
    const [expandedSystemDesc, setExpandedSystemDesc] = useState<Set<number>>(new Set());
    const [expandedSystem, setExpandedSystem] = useState<Set<number>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    const SKILLS_SECTION_KEY = 'user-skills';
    const SYSTEMS_SECTION_KEY = 'user-systems';
    const SKILLS_SECTION_PATH = '~/.sema/designs/skills/';
    const SYSTEMS_SECTION_PATH = '~/.sema/designs/design-systems/';

    const toggleSectionCollapse = (key: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadDesignSkillsResult':
                    setSkillsLoading(false);
                    if (message.success) setSkills(message.data || []);
                    break;
                case 'refreshDesignSkillsResult':
                    setSkillsRefreshing(false);
                    if (message.success) setSkills(message.data || []);
                    break;
                case 'loadDesignSystemsResult':
                    setSystemsLoading(false);
                    if (message.success) setSystems(message.data || []);
                    break;
                case 'refreshDesignSystemsResult':
                    setSystemsRefreshing(false);
                    if (message.success) setSystems(message.data || []);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadDesignSkills' });
        vscode.postMessage({ command: 'loadDesignSystems' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscode]);

    const handleRefresh = () => {
        if (activeTab === 'skills') {
            setSkillsRefreshing(true);
            vscode.postMessage({ command: 'refreshDesignSkills' });
        } else {
            setSystemsRefreshing(true);
            vscode.postMessage({ command: 'refreshDesignSystems' });
        }
    };

    const handleOpen = (filePath: string) => {
        if (!filePath) return;
        vscode.postMessage({ command: 'openFile', filePath });
    };

    const resolveSkillMdPath = (folderName: string): string => {
        if (!folderName) return '';
        const sep = folderName.includes('\\') && !folderName.includes('/') ? '\\' : '/';
        return folderName.endsWith(sep) ? `${folderName}SKILL.md` : `${folderName}${sep}SKILL.md`;
    };

    const getInitial = (name: string): string => name ? name.charAt(0).toUpperCase() : '?';

    const SWATCH_PRIORITY = ['accent', 'primary', 'brand', 'foreground', 'background', 'muted', 'surface'];
    const sortSwatches = (arr: DesignSystemColor[]): DesignSystemColor[] => {
        const score = (key: string) => {
            const i = SWATCH_PRIORITY.indexOf((key || '').toLowerCase());
            return i === -1 ? 999 : i;
        };
        return [...arr].sort((a, b) => score(a.key) - score(b.key));
    };

    const toggleDesc = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, index: number) => {
        setter(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
        });
    };

    const renderDescription = (
        description: string,
        index: number,
        isExpanded: boolean,
        onToggle: () => void,
    ) => {
        const DESC_MAX = 150;
        const text = description || '暂无描述';
        const isLong = text.length > DESC_MAX;
        return (
            <div className={`section-card-desc ${isLong && !isExpanded ? 'collapsed' : ''}`}>
                {isLong && !isExpanded ? text.slice(0, DESC_MAX) + '...' : text}
                {isLong && (
                    <span
                        className="description-toggle"
                        onClick={(e) => { e.stopPropagation(); onToggle(); }}
                    >
                        {isExpanded ? '收起' : '更多'}
                    </span>
                )}
            </div>
        );
    };

    const renderHeader = (
        folderName: string,
        name: string,
        openPath: string,
    ) => (
        <div className="section-card-header">
            <div className="section-card-icon" style={{ backgroundColor: getColorByName(folderName) }}>
                {getInitial(folderName)}
            </div>
            <div className="section-card-name-group section-card-name-group-truncate">
                <span className="section-card-name section-card-name-truncate">{folderName}</span>
                {name && name !== folderName && (
                    <span className="section-card-name-sub">{name}</span>
                )}
            </div>
            <div className="section-card-actions">
                <button
                    className="section-icon-btn"
                    title="打开 SKILL.md"
                    onClick={(e) => { e.stopPropagation(); handleOpen(openPath); }}
                >
                    <OpenIcon />
                </button>
            </div>
        </div>
    );

    const renderSystemIcon = (swatches: DesignSystemColor[]) => {
        const cells: { key: string; value: string }[] = [];
        for (let i = 0; i < 4; i++) {
            const s = swatches[i];
            cells.push(s ? { key: s.key, value: s.value } : { key: '', value: 'var(--vscode-panel-border)' });
        }
        return (
            <div className="section-card-icon section-card-icon-grid">
                {cells.map((c, i) => (
                    <div
                        key={`${c.key}-${i}`}
                        title={c.key ? `${c.key}: ${c.value}` : undefined}
                        style={{ background: c.value }}
                    />
                ))}
            </div>
        );
    };

    const toggleSystemExpand = (index: number) => {
        setExpandedSystem(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
        });
    };

    const renderColorPalette = (colors: DesignSystemColor[]) => {
        if (!colors || colors.length === 0) return null;
        return (
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
                    gap: '8px',
                    padding: '0 14px 14px 14px',
                }}
            >
                {colors.map((c, i) => (
                    <div
                        key={`${c.key}-${i}`}
                        title={`${c.key}: ${c.value}`}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: 0 }}
                    >
                        <div
                            style={{
                                width: '100%',
                                aspectRatio: '1 / 1',
                                borderRadius: '6px',
                                background: c.value,
                                border: '1px solid var(--vscode-panel-border)',
                            }}
                        />
                        <span
                            style={{
                                fontSize: '11px',
                                color: 'var(--vscode-descriptionForeground)',
                                width: '100%',
                                textAlign: 'center',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {c.key}
                        </span>
                    </div>
                ))}
            </div>
        );
    };

    const renderSectionHeader = (title: string, path: string, count: number, sectionKey: string) => {
        const isCollapsed = collapsedSections.has(sectionKey);
        return (
            <div
                className="section-group-title section-group-title-collapsible"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleSectionCollapse(sectionKey)}
            >
                {title}
                <span className="section-group-count">({path})</span>
                <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
            </div>
        );
    };

    const renderSkillsList = () => {
        if (skillsLoading) return <div className="section-loading">加载中...</div>;
        const isCollapsed = collapsedSections.has(SKILLS_SECTION_KEY);
        return (
            <div className="section-groups">
                <div className="section-group section-user">
                    {renderSectionHeader('用户级', SKILLS_SECTION_PATH, skills.length, SKILLS_SECTION_KEY)}
                    {!isCollapsed && (
                        skills.length === 0 ? (
                            <div className="section-empty">暂无设计技能</div>
                        ) : (
                            <div className="section-list">
                                {skills.map((skill, index) => (
                                    <div key={skill.folderName || index} className="section-card">
                                        {renderHeader(skill.folderName, skill.name, skill.filePath)}
                                        {renderDescription(
                                            skill.description,
                                            index,
                                            expandedSkillDesc.has(index),
                                            () => toggleDesc(setExpandedSkillDesc, index),
                                        )}
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            </div>
        );
    };

    const renderSystemsList = () => {
        if (systemsLoading) return <div className="section-loading">加载中...</div>;
        const isCollapsed = collapsedSections.has(SYSTEMS_SECTION_KEY);
        return (
            <div className="section-groups">
                <div className="section-group section-user">
                    {renderSectionHeader('用户级', SYSTEMS_SECTION_PATH, systems.length, SYSTEMS_SECTION_KEY)}
                    {!isCollapsed && (
                        systems.length === 0 ? (
                            <div className="section-empty">暂无设计系统</div>
                        ) : (
                            <div className="section-list" style={{ gridTemplateColumns: '1fr' }}>
                                {renderSystemsItems()}
                            </div>
                        )
                    )}
                </div>
            </div>
        );
    };

    const renderSystemsItems = () => {
        return systems.map((system, index) => {
                    const isExpanded = expandedSystem.has(index);
                    const openPath = system.filePath || resolveSkillMdPath(system.folderName);
                    const rawSwatches = system.swatches && system.swatches.length > 0 ? system.swatches : system.colors;
                    const swatchSource = sortSwatches(rawSwatches || []);
                    return (
                        <div key={system.folderName || index} className="section-card">
                            <div
                                className="section-card-header section-card-header-single"
                                onClick={() => toggleSystemExpand(index)}
                                style={{ cursor: 'pointer' }}
                            >
                                <button
                                    className={`section-expand-btn ${isExpanded ? 'expanded' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleSystemExpand(index); }}
                                >
                                    <ExpandArrowIcon />
                                </button>
                                {renderSystemIcon(swatchSource)}
                                <div className="section-card-name-group section-card-name-group-truncate">
                                    <span className="section-card-name section-card-name-truncate">{system.folderName}</span>
                                    {system.name && system.name !== system.folderName && (
                                        <span className="section-card-name-sub">{system.name}</span>
                                    )}
                                </div>
                                <div className="section-card-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        className="section-icon-btn"
                                        title="打开 SKILL.md"
                                        onClick={() => handleOpen(openPath)}
                                    >
                                        <OpenIcon />
                                    </button>
                                </div>
                            </div>
                            {isExpanded && (
                                <>
                                    {renderDescription(
                                        system.description,
                                        index,
                                        expandedSystemDesc.has(index),
                                        () => toggleDesc(setExpandedSystemDesc, index),
                                    )}
                                    {renderColorPalette(system.colors)}
                                </>
                            )}
                        </div>
                    );
                });
    };

    const isRefreshing = activeTab === 'skills' ? skillsRefreshing : systemsRefreshing;

    return (
        <div className="agent-config plugin-config">
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'systems' ? 'active' : ''}`}
                    onClick={() => setActiveTab('systems')}
                >
                    设计系统
                    {systems.length > 0 && (
                        <span className="section-tab-count">{systems.length}</span>
                    )}
                </div>
                <div
                    className={`tab-item ${activeTab === 'skills' ? 'active' : ''}`}
                    onClick={() => setActiveTab('skills')}
                >
                    设计技能
                    {skills.length > 0 && (
                        <span className="section-tab-count">{skills.length}</span>
                    )}
                </div>
                <div className="section-tab-actions">
                    <button
                        className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title="刷新"
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

            <div className="tab-content">
                <div style={{ display: activeTab === 'skills' ? 'block' : 'none' }}>
                    {renderSkillsList()}
                </div>
                <div style={{ display: activeTab === 'systems' ? 'block' : 'none' }}>
                    {renderSystemsList()}
                </div>
            </div>
        </div>
    );
};

export default DesignConfig;
