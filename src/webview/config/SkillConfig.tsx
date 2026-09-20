import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, EditIcon, TrashIcon, OpenIcon } from './utils/svgIcons';
import { SkillScope, SkillConfig as SkillConfigItem } from './types/skill';
import { skillHubConfig } from './default/defaultSkillHub';
import { useT, I18nKey } from '../common/i18n/react';
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

const LOCATE_ORDER: SkillScope[] = ['builtin', 'project', 'user', 'plugin'];

// 分组标题文案 key，渲染期经 t() 取值
const LOCATE_SECTION_TITLE_KEYS: Record<SkillScope, I18nKey> = {
    builtin: 'config.skill.group.builtin',
    plugin: 'config.skill.group.plugin',
    project: 'config.skill.group.project',
    user: 'config.skill.group.user',
};

const LOCATE_PATHS: Record<SkillScope, string> = {
    builtin: '',
    plugin: '',
    project: '.sema/skills/',
    user: '~/.sema/skills/',
};

type SkillTabType = 'installed' | 'hub';

const SkillConfig: React.FC<SkillConfigProps> = ({ vscode }) => {
    // JB 插件不支持 SkillHub 在线搜索/安装，隐藏其标签页（VSCode 下 __SEMA_JB__ 为 undefined，行为不变）。
    // 必须在组件内读取：模块顶层求值早于 jb-index 设置该标记，会恒为 false。
    const IS_JB = !!(window as any).__SEMA_JB__;
    const t = useT();
    const [activeTab, setActiveTab] = useState<SkillTabType>('installed');
    const [skills, setSkills] = useState<SkillConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // Hub 状态
    const [hubSearch, setHubSearch] = useState('');
    const [hubResults, setHubResults] = useState<HubSkillResult[]>([]);
    const [hubLoading, setHubLoading] = useState(false);
    const [hubSearched, setHubSearched] = useState(false);
    const [installingHubKeys, setInstallingHubKeys] = useState<Set<string>>(new Set());

    const groupedSkills = useMemo(() => {
        const groups: Record<SkillScope, SkillConfigItem[]> = {
            builtin: [],
            plugin: [],
            project: [],
            user: [],
        };
        skills.forEach(skill => {
            const loc = skill.locate;
            if (loc && groups[loc]) {
                groups[loc].push(skill);
            }
        });
        LOCATE_ORDER.forEach(scope => {
            groups[scope].sort((a, b) => Number(a.status === false) - Number(b.status === false));
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
                case 'toggleSkillResult':
                    // 只在带回有效数据时覆盖列表；失败时重拉恢复真实状态（回滚乐观更新）
                    if (message.success && Array.isArray(message.data)) {
                        setSkills(message.data);
                    } else if (!message.success) {
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
            // 内置 skill 可被同名用户级/项目级覆盖，不算已安装
            if (s.locate === 'builtin') return;
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

    const toggleDescriptionExpand = (skillKey: string) => {
        setExpandedDescriptions(prev => {
            const next = new Set(prev);
            if (next.has(skillKey)) next.delete(skillKey); else next.add(skillKey);
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

    // 写入哪层 settings 由 core 按技能所在层决定（项目级技能→项目级，用户级/插件→用户级全局）
    const handleToggleSkill = (skill: SkillConfigItem, enabled: boolean) => {
        // 先本地乐观更新，结果消息回来后以真实数据为准
        setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, status: enabled } : s));
        vscode.postMessage({ command: 'toggleSkill', name: skill.name, enabled });
    };

    const renderSkillCard = (skill: SkillConfigItem) => {
        const skillKey = `${skill.locate}:${skill.filePath || skill.name}`;
        const DESC_MAX = 150;
        const description = skill.description || t('common.noDescription');
        const isDescExpanded = expandedDescriptions.has(skillKey);
        const isLongDesc = description.length > DESC_MAX;
        // 内置 / 插件 skill 不可编辑删除；插件 skill 可启停，内置 skill 无任何操作（与内置子代理一致）
        const isReadonly = skill.locate === 'builtin' || skill.locate === 'plugin';
        const isDisabled = skill.status === false;
        const skillSwitch = (
            <label className="section-switch" title={isDisabled ? (skill.locate === 'project' ? t('config.skill.disabledProject') : t('config.skill.disabledGlobal')) : t('config.skill.enabled')}>
                <input
                    type="checkbox"
                    checked={!isDisabled}
                    onChange={(e) => handleToggleSkill(skill, e.target.checked)}
                />
                <span className="section-switch-slider"></span>
            </label>
        );

        return (
            <div key={skillKey} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(skill.name), opacity: isDisabled ? 0.5 : 1 }}>
                        {getSkillInitial(skill.name)}
                    </div>
                    <div className="section-card-name-group" style={{ opacity: isDisabled ? 0.5 : 1 }}>
                        <span className="section-card-name">{skill.name}</span>
                        {isReadonly && (
                            <span className="readonly-tab">{t('common.readonly')}</span>
                        )}
                    </div>
                    {!isReadonly && (
                        <div className="section-card-actions">
                            <button
                                className="section-icon-btn"
                                title={t('common.edit')}
                                onClick={(e) => { e.stopPropagation(); handleEditSkill(skill); }}
                            >
                                <EditIcon />
                            </button>
                            <button
                                className="section-icon-btn section-icon-btn-danger"
                                title={t('common.delete')}
                                onClick={(e) => { e.stopPropagation(); handleDeleteSkill(skill); }}
                            >
                                <TrashIcon />
                            </button>
                            {skillSwitch}
                        </div>
                    )}
                    {skill.locate === 'plugin' && (
                        <div className="section-card-actions">
                            {skill.filePath && (
                                <button
                                    className="section-icon-btn"
                                    title={t('common.open')}
                                    onClick={(e) => { e.stopPropagation(); handleEditSkill(skill); }}
                                >
                                    <OpenIcon />
                                </button>
                            )}
                            {skillSwitch}
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
                            onClick={() => toggleDescriptionExpand(skillKey)}
                        >
                            {isDescExpanded ? t('common.collapse') : t('common.more')}
                        </span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'installed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('installed')}
                >
                    {t('common.installed')}
                    {skills.length > 0 && (
                        <span className="section-tab-count">{skills.length}</span>
                    )}
                </div>
                {!IS_JB && (
                    <div
                        className={`tab-item ${activeTab === 'hub' ? 'active' : ''}`}
                        onClick={() => setActiveTab('hub')}
                    >
                        SkillHub
                    </div>
                )}
                <div className="section-tab-actions">
                    {activeTab === 'installed' && (
                        <button
                            className={`section-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleRefresh}
                            title={t('config.skill.refresh')}
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
                            placeholder={t('config.skill.hubSearchPlaceholder')}
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
                            {hubLoading ? t('config.skill.searching') : t('common.search')}
                        </button>
                    </div>
                    {hubLoading ? (
                        <div className="section-loading">{t('config.skill.searchingDots')}</div>
                    ) : !hubSearched ? (
                        <div className="section-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '24px 16px' }}>
                            <div>{t('config.skill.hubHint')}</div>
                            <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.6', textAlign: 'center', maxWidth: '360px' }}>
                                {t('config.skill.hubDescription')}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '4px' }}>
                                {t('config.skill.hubSourceLabel')}{' '}
                                <a
                                    href="#"
                                    className="skillhub-source-link"
                                    onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: skillHubConfig.homepageUrl }); }}
                                >
                                    {skillHubConfig.sourceName}
                                </a>
                            </div>
                        </div>
                    ) : hubResults.length === 0 ? (
                        <div className="section-empty">{t('config.skill.noMatch')}</div>
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
                                                <span className="section-installed-badge">{t('common.installed')}</span>
                                            ) : (
                                                <div className="section-install-btns">
                                                    <button
                                                        className={`section-btn secondary small ${isInstallingProject ? 'btn-loading' : ''}`}
                                                        onClick={() => handleInstallFromHub(item.slug, 'project')}
                                                        title={t('common.installToProjectTip')}
                                                        disabled={isInstallingProject || isInstallingUser}
                                                    >
                                                        {isInstallingProject && <span className="spinner" />}
                                                        {t('common.installProject')}
                                                    </button>
                                                    <button
                                                        className={`section-btn primary small ${isInstallingUser ? 'btn-loading' : ''}`}
                                                        onClick={() => handleInstallFromHub(item.slug, 'user')}
                                                        title={t('common.installToUserTip')}
                                                        disabled={isInstallingProject || isInstallingUser}
                                                    >
                                                        {isInstallingUser && <span className="spinner" />}
                                                        {t('common.installUser')}
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
                            {t('config.skill.hubSourceLabel')}{' '}
                            <a
                                href="#"
                                className="skillhub-source-link"
                                onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: skillHubConfig.homepageUrl }); }}
                            >
                                {skillHubConfig.sourceName}
                            </a>
                        </div>
                    )}
                </div>
                {activeTab !== 'hub' && loading ? (
                    <div className="section-loading">{t('common.loading')}</div>
                ) : activeTab !== 'hub' ? (
                    <div className="section-groups">
                        {LOCATE_ORDER.map(scope => {
                            const sectionSkills = groupedSkills[scope] || [];
                            // 项目级 / 用户级 始终显示；内置 / 插件级为空时隐藏
                            if (sectionSkills.length === 0 && (scope === 'builtin' || scope === 'plugin')) return null;

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
                                        {t(LOCATE_SECTION_TITLE_KEYS[scope])}
                                        {LOCATE_PATHS[scope] && (
                                            <span className="section-group-count">({LOCATE_PATHS[scope]})</span>
                                        )}
                                        <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                    </div>
                                    {!isCollapsed && (
                                        sectionSkills.length === 0 ? (
                                            <div className="section-empty">{t('config.skill.empty')}</div>
                                        ) : (
                                            <div className="section-list">
                                                {sectionSkills.map(renderSkillCard)}
                                            </div>
                                        )
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default SkillConfig;
