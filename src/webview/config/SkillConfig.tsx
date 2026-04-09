import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, EditIcon, TrashIcon } from './utils/svgIcons';
import { SkillScope, SkillConfig as SkillConfigItem } from './types/skill';
import './style/section.css';

interface SkillConfigProps {
    vscode: VscodeApi;
}

interface HubSkillResult {
    displayName: string;
    score: number;
    slug: string;
    summary: string;
    updatedAt: number;
    version: string;
}

const LOCATE_ORDER: SkillScope[] = ['project', 'user', 'plugin'];

const LOCATE_SECTION_TITLES: Record<SkillScope, string> = {
    plugin: '插件 Skills',
    project: '项目级 Skills',
    user: '用户级 Skills',
};

const LOCATE_PATHS: Record<SkillScope, string> = {
    plugin: '',
    project: '.sema/skills/',
    user: '~/.sema/skills/',
};

type SkillTabType = 'installed' | 'hub';

const SkillConfig: React.FC<SkillConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<SkillTabType>('installed');
    const [skills, setSkills] = useState<SkillConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // Hub 状态
    const [hubSearch, setHubSearch] = useState('');
    const [hubResults, setHubResults] = useState<HubSkillResult[]>([]);
    const [hubLoading, setHubLoading] = useState(false);
    const [hubSearched, setHubSearched] = useState(false);
    const [installingHubKeys, setInstallingHubKeys] = useState<Set<string>>(new Set());

    const groupedSkills = useMemo(() => {
        const groups: Record<SkillScope | 'other', SkillConfigItem[]> = {
            plugin: [],
            project: [],
            user: [],
            other: [],
        };
        skills.forEach(skill => {
            const loc = skill.locate;
            if (skill.from && skill.from !== 'sema') {
                groups.other.push(skill);
            } else if (loc && groups[loc]) {
                groups[loc].push(skill);
            } else {
                groups.other.push(skill);
            }
        });
        return groups;
    }, [skills]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadSkillsInfoResult':
                    if (message.success) {
                        setSkills(message.data || []);
                    }
                    setLoading(false);
                    break;
                case 'refreshSkillsInfoResult':
                    setIsRefreshing(false);
                    if (message.success) {
                        setSkills(message.data || []);
                    }
                    break;
                case 'removeSkillResult':
                    if (message.success) {
                        vscode.postMessage({ command: 'loadSkillsInfo' });
                    }
                    break;
                case 'searchSkillHubResult':
                    setHubLoading(false);
                    setHubSearched(true);
                    if (message.success) {
                        setHubResults(message.data || []);
                    } else {
                        setHubResults([]);
                    }
                    break;
                case 'installSkillFromHubResult':
                    setInstallingHubKeys(prev => {
                        const next = new Set(prev);
                        if (message.slug) {
                            next.delete(`${message.slug}-project`);
                            next.delete(`${message.slug}-user`);
                        }
                        return next;
                    });
                    if (message.success) {
                        vscode.postMessage({ command: 'loadSkillsInfo' });
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadSkillsInfo' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscode]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshSkills' });
    };

    const handleHubSearchChange = (value: string) => {
        setHubSearch(value);
        if (!value.trim()) {
            setHubResults([]);
            setHubSearched(false);
            setHubLoading(false);
        }
    };

    const handleHubSearchSubmit = () => {
        if (!hubSearch.trim()) {
            setHubResults([]);
            setHubSearched(false);
            setHubLoading(false);
            return;
        }
        setHubLoading(true);
        vscode.postMessage({ command: 'searchSkillHub', query: hubSearch.trim() });
    };

    const handleInstallFromHub = (slug: string, scope: 'project' | 'user') => {
        setInstallingHubKeys(prev => new Set(prev).add(`${slug}-${scope}`));
        vscode.postMessage({ command: 'installSkillFromHub', slug, scope });
    };

    const installedSlugs = useMemo(() => {
        const slugs = new Set<string>();
        skills.forEach(s => {
            slugs.add(s.name);
            if (s.filePath) {
                // filePath 形如 /xxx/.sema/skills/pptx-2/SKILL.md，提取目录名作为 slug
                const parts = s.filePath.replace(/\\/g, '/').split('/');
                const skillMdIndex = parts.findIndex(p => p.toUpperCase() === 'SKILL.MD');
                if (skillMdIndex > 0) {
                    slugs.add(parts[skillMdIndex - 1]);
                }
            }
        });
        return slugs;
    }, [skills]);

    const toggleDescriptionExpand = (index: number) => {
        setExpandedDescriptions(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
        });
    };

    const getSkillInitial = (name: string): string => {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    };

    const handleEditSkill = (skill: SkillConfigItem) => {
        if (skill.filePath) {
            vscode.postMessage({ command: 'openFile', filePath: skill.filePath });
        }
    };

    const handleDeleteSkill = (skill: SkillConfigItem) => {
        vscode.postMessage({ command: 'removeSkill', name: skill.name });
    };

    const renderSkillCard = (skill: SkillConfigItem, globalIndex: number) => {
        const DESC_MAX = 150;
        const description = skill.description || '暂无描述';
        const isDescExpanded = expandedDescriptions.has(globalIndex);
        const isLongDesc = description.length > DESC_MAX;
        const isReadonly = (skill.from && skill.from !== 'sema') || skill.locate === 'plugin';

        return (
            <div key={globalIndex} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(skill.name) }}>
                        {getSkillInitial(skill.name)}
                    </div>
                    <div className="section-card-name-group">
                        <span className="section-card-name">{skill.name}</span>
                        {isReadonly && (
                            <span className="readonly-tab">只读</span>
                        )}
                        {skill.from && skill.from !== 'sema' && (
                            <span className="readonly-tab">{skill.from}</span>
                        )}
                    </div>
                    {!isReadonly && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title="编辑"
                                onClick={(e) => { e.stopPropagation(); handleEditSkill(skill); }}
                            >
                                <EditIcon />
                            </button>
                            <button
                                className="section-icon-btn section-icon-btn-danger"
                                title="删除"
                                onClick={(e) => { e.stopPropagation(); handleDeleteSkill(skill); }}
                            >
                                <TrashIcon />
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
            </div>
        );
    };

    const getGlobalIndex = (locate: SkillScope | 'other', localIndex: number): number => {
        let offset = 0;
        for (const loc of [...LOCATE_ORDER, 'other' as const]) {
            if (loc === locate) break;
            offset += groupedSkills[loc].length;
        }
        return offset + localIndex;
    };

    const ALL_SECTIONS: Array<SkillScope | 'other'> = [...LOCATE_ORDER, 'other'];
    const SECTION_TITLES: Record<SkillScope | 'other', string> = {
        ...LOCATE_SECTION_TITLES,
        other: '外部 Skills',
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
                    {skills.length > 0 && (
                        <span className="section-tab-count">{skills.length}</span>
                    )}
                </div>
                <div
                    className={`tab-item ${activeTab === 'hub' ? 'active' : ''}`}
                    onClick={() => setActiveTab('hub')}
                >
                    SkillHub
                </div>
                <div className="section-tab-actions">
                    {activeTab === 'installed' && (
                        <button
                            className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleRefresh}
                            title="刷新 Skills"
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

            {/* 内容 */}
            <div className="tab-content">
                <div style={{ display: activeTab === 'hub' ? 'flex' : 'none', flexDirection: 'column', gap: '12px' }}>
                    <div className="section-search-box" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                            type="text"
                            className="section-search-input"
                            placeholder="搜索 Skill 名称或描述..."
                            value={hubSearch}
                            onChange={(e) => handleHubSearchChange(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleHubSearchSubmit(); }}
                            style={{ flex: 1 }}
                        />
                        <button
                            className={`section-btn primary small ${hubLoading ? 'btn-loading' : ''}`}
                            onClick={handleHubSearchSubmit}
                            disabled={hubLoading}
                        >
                            {hubLoading && <span className="spinner" />}
                            {hubLoading ? '搜索中' : '搜索'}
                        </button>
                    </div>
                    {hubLoading ? (
                        <div className="section-loading">搜索中...</div>
                    ) : !hubSearched ? (
                        <div className="section-empty">输入关键词搜索 SkillHub</div>
                    ) : hubResults.length === 0 ? (
                        <div className="section-empty">没有匹配的 Skill</div>
                    ) : (
                        <div className="plugin-available-list" style={{ borderRadius: '8px', border: '1px solid var(--vscode-panel-border)' }}>
                            {[...hubResults]
                                .sort((a, b) => {
                                    const aInstalled = installedSlugs.has(a.slug) ? 1 : 0;
                                    const bInstalled = installedSlugs.has(b.slug) ? 1 : 0;
                                    if (bInstalled !== aInstalled) return bInstalled - aInstalled;
                                    return b.score - a.score;
                                })
                                .map((item) => {
                                const isInstalled = installedSlugs.has(item.slug);
                                const isInstallingProject = installingHubKeys.has(`${item.slug}-project`);
                                const isInstallingUser = installingHubKeys.has(`${item.slug}-user`);
                                return (
                                    <div key={item.slug} className="plugin-available-card">
                                        <div className="plugin-available-left">
                                            <div
                                                className="section-card-icon"
                                                style={{ backgroundColor: getColorByName(item.slug), borderRadius: '50%', flexShrink: 0 }}
                                            >
                                                {item.displayName.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="plugin-available-info">
                                                <span className="plugin-available-name">{item.displayName}</span>
                                                {item.version && (
                                                    <span className="plugin-available-author">v{item.version}</span>
                                                )}
                                                {item.summary && (
                                                    <span className="plugin-available-desc" title={item.summary}>{item.summary}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="plugin-available-right">
                                            {isInstalled ? (
                                                <span className="section-installed-badge">已安装</span>
                                            ) : (
                                                <div className="section-install-btns">
                                                    <button
                                                        className={`section-btn secondary small ${isInstallingProject ? 'btn-loading' : ''}`}
                                                        onClick={() => handleInstallFromHub(item.slug, 'project')}
                                                        title="安装到当前项目"
                                                        disabled={isInstallingProject || isInstallingUser}
                                                    >
                                                        {isInstallingProject && <span className="spinner" />}
                                                        项目安装
                                                    </button>
                                                    <button
                                                        className={`section-btn primary small ${isInstallingUser ? 'btn-loading' : ''}`}
                                                        onClick={() => handleInstallFromHub(item.slug, 'user')}
                                                        title="安装到用户全局"
                                                        disabled={isInstallingProject || isInstallingUser}
                                                    >
                                                        {isInstallingUser && <span className="spinner" />}
                                                        全局安装
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {hubSearched && hubResults.length > 0 && !hubLoading && (
                        <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '4px' }}>
                            信息来自{' '}
                            <a
                                href="#"
                                className="mcp-npx-hint-link"
                                onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: 'https://skillhub.tencent.com' }); }}
                            >
                                SkillHub
                            </a>
                        </div>
                    )}
                </div>
                {activeTab !== 'hub' && loading ? (
                    <div className="section-loading">加载中...</div>
                ) : activeTab !== 'hub' ? (
                    <div className="section-groups">
                        {ALL_SECTIONS.map(scope => {
                            const sectionSkills = groupedSkills[scope] || [];
                            if (sectionSkills.length === 0) return null;

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
                                        {SECTION_TITLES[scope]}
                                        {scope !== 'other' && LOCATE_PATHS[scope as SkillScope] && (
                                            <span className="section-group-count">({LOCATE_PATHS[scope as SkillScope]})</span>
                                        )}
                                        <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                    </div>
                                    {!isCollapsed && (
                                        sectionSkills.length === 0 ? (
                                            <div className="section-empty">暂无 Skill</div>
                                        ) : (
                                            <div className="section-list">
                                                {sectionSkills.map((skill, localIndex) =>
                                                    renderSkillCard(skill, getGlobalIndex(scope, localIndex))
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                            );
                        })}
                        {ALL_SECTIONS.every(s => (groupedSkills[s] || []).length === 0) && (
                            <div className="section-empty">暂无 Skill</div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default SkillConfig;
