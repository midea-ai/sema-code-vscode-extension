import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { getColorByName } from './utils/iconUtils';
import { RefreshIcon, EditIcon, TrashIcon, OpenIcon, GitHubIcon } from './utils/svgIcons';
import { SkillScope, SkillConfig as SkillConfigItem } from './types/skill';
import { useT, I18nKey } from '../common/i18n/react';
import './style/section.css';

interface SkillConfigProps {
    vscode: VscodeApi;
}

/** 市场卡片：宿主扫描扩展自带 resources/skills/ 得到（对齐 SkillCatalogManager.CatalogSkill） */
interface CatalogSkill {
    id: string;
    name: string;
    description: string;
    category?: string;
    skillName: string;
    repo?: string;
    repoUrl?: string;
    installedUser: boolean;
    installedProject: boolean;
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

/** 市场分类展示顺序；不在列表里的归入「其他」 */
const CATEGORY_ORDER = ['doc', 'office', 'writing', 'dev', 'web', 'mobile', 'design', 'media', 'other'];
const CATEGORY_TITLE_KEYS: Record<string, I18nKey> = {
    doc: 'config.skill.cat.doc',
    office: 'config.skill.cat.office',
    writing: 'config.skill.cat.writing',
    dev: 'config.skill.cat.dev',
    web: 'config.skill.cat.web',
    mobile: 'config.skill.cat.mobile',
    design: 'config.skill.cat.design',
    media: 'config.skill.cat.media',
    other: 'config.skill.cat.other',
};

type SkillTabType = 'installed' | 'hub';

const SkillConfig: React.FC<SkillConfigProps> = ({ vscode }) => {
    // JB 插件尚未实现 Skill 市场安装，隐藏其标签页（VSCode 下 __SEMA_JB__ 为 undefined，行为不变）。
    // 必须在组件内读取：模块顶层求值早于 jb-index 设置该标记，会恒为 false。
    const IS_JB = !!(window as any).__SEMA_JB__;
    const t = useT();
    const [activeTab, setActiveTab] = useState<SkillTabType>('installed');
    const [skills, setSkills] = useState<SkillConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // 市场状态：目录来自宿主本地扫描；busyKeys 记录进行中的安装 / 卸载（`${id}-project|user|uninstall`），各卡片独立转圈
    const [catalog, setCatalog] = useState<CatalogSkill[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [marketQuery, setMarketQuery] = useState('');
    const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

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

    const loadCatalog = () => {
        setCatalogLoading(true);
        vscode.postMessage({ command: 'loadSkillCatalog' });
    };

    useEffect(() => {
        const clearBusy = (...keys: string[]) => setBusyKeys(prev => {
            const next = new Set(prev);
            keys.forEach(k => next.delete(k));
            return next;
        });
        // 安装 / 卸载成功后宿主一并带回最新目录与已安装 skills；用户取消覆盖 / 卸载时 cancelled 为真，不动列表
        const applyCatalogResult = (message: any) => {
            if (!message.success || message.cancelled) return;
            if (Array.isArray(message.catalog)) setCatalog(message.catalog);
            if (Array.isArray(message.skills)) setSkills(message.skills);
        };
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
                        // 删掉的可能是市场装的，同步卡片安装态
                        vscode.postMessage({ command: 'loadSkillCatalog' });
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
                case 'loadSkillCatalogResult':
                    setCatalogLoading(false);
                    if (message.success) {
                        setCatalog(message.data || []);
                        setCatalogError(null);
                    } else {
                        setCatalogError(message.message || '');
                    }
                    break;
                case 'installCatalogSkillResult':
                    clearBusy(`${message.id}-${message.scope}`);
                    applyCatalogResult(message);
                    break;
                case 'uninstallCatalogSkillResult':
                    clearBusy(`${message.id}-uninstall`);
                    applyCatalogResult(message);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadSkillsInfo' });
        if (!IS_JB) loadCatalog();

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscode]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshSkills' });
    };

    const handleInstallCatalog = (item: CatalogSkill, scope: 'project' | 'user') => {
        setBusyKeys(prev => new Set(prev).add(`${item.id}-${scope}`));
        vscode.postMessage({ command: 'installCatalogSkill', id: item.id, scope });
    };

    const handleUninstallCatalog = (item: CatalogSkill) => {
        setBusyKeys(prev => new Set(prev).add(`${item.id}-uninstall`));
        vscode.postMessage({ command: 'uninstallCatalogSkill', id: item.id });
    };

    // 市场：本地按名称 / 描述 / id 过滤，再按分类分组（宿主已按 card.order 排好组内顺序）
    const marketGroups = useMemo(() => {
        const q = marketQuery.trim().toLowerCase();
        const filtered = (catalog || []).filter(i => !q
            || i.name.toLowerCase().includes(q)
            || i.description.toLowerCase().includes(q)
            || i.id.toLowerCase().includes(q)
            || i.skillName.toLowerCase().includes(q));
        return CATEGORY_ORDER
            .map(key => ({
                key,
                items: filtered.filter(i => (CATEGORY_ORDER.includes(i.category || '') ? i.category : 'other') === key),
            }))
            .filter(g => g.items.length > 0);
    }, [catalog, marketQuery]);

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

    const renderMarketCard = (item: CatalogSkill) => {
        const installed = item.installedUser || item.installedProject;
        const installingProject = busyKeys.has(`${item.id}-project`);
        const installingUser = busyKeys.has(`${item.id}-user`);
        const uninstalling = busyKeys.has(`${item.id}-uninstall`);
        const installedTip = [
            item.installedUser ? t('config.skill.installedUser') : '',
            item.installedProject ? t('config.skill.installedProject') : '',
        ].filter(Boolean).join(' / ');
        const description = item.description || t('common.noDescription');
        return (
            <div key={item.id} className="skill-market-card">
                <div className="skill-market-head">
                    <div className="section-card-icon" style={{ backgroundColor: getColorByName(item.name) }}>
                        {getSkillInitial(item.name)}
                    </div>
                    <div className="skill-market-title">
                        <span className="skill-market-name" title={item.name}>{item.name}</span>
                        {item.skillName && item.skillName !== item.name && (
                            <span className="skill-market-sub" title={item.skillName}>{item.skillName}</span>
                        )}
                    </div>
                </div>
                <div className="skill-market-desc" title={description}>{description}</div>
                <div className="skill-market-foot">
                    {item.repoUrl && (
                        <a
                            href="#"
                            className="skill-market-repo"
                            title={item.repoUrl}
                            onClick={(e) => { e.preventDefault(); vscode.postMessage({ command: 'openExternal', url: item.repoUrl }); }}
                        >
                            <GitHubIcon size={12} />
                            <span>{item.repo}</span>
                        </a>
                    )}
                    <span className="skill-market-spacer" />
                    {installed ? (
                        <div className="skill-market-installed">
                            <span className="section-installed-badge" title={installedTip}>{t('common.installed')}</span>
                            <button
                                className="section-icon-btn section-icon-btn-danger"
                                title={t('config.skill.uninstall')}
                                disabled={uninstalling}
                                onClick={() => handleUninstallCatalog(item)}
                            >
                                {uninstalling ? <span className="spinner" /> : <TrashIcon size={14} />}
                            </button>
                        </div>
                    ) : (
                        <div className="section-install-btns">
                            <button
                                className={`section-btn secondary small ${installingProject ? 'btn-loading' : ''}`}
                                onClick={() => handleInstallCatalog(item, 'project')}
                                title={t('common.installToProjectTip')}
                                disabled={installingProject || installingUser}
                            >
                                {installingProject && <span className="spinner" />}
                                {t('common.installProject')}
                            </button>
                            <button
                                className={`section-btn primary small ${installingUser ? 'btn-loading' : ''}`}
                                onClick={() => handleInstallCatalog(item, 'user')}
                                title={t('common.installToUserTip')}
                                disabled={installingProject || installingUser}
                            >
                                {installingUser && <span className="spinner" />}
                                {t('common.installUser')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderMarket = () => {
        const hasQuery = !!marketQuery.trim();
        let body: React.ReactNode;
        if (!catalog && catalogLoading) {
            body = <div className="section-loading">{t('common.loading')}</div>;
        } else if (!catalog && catalogError !== null) {
            body = (
                <div className="skill-market-error">
                    <span>Failed to load: {catalogError}</span>
                    <button className="section-btn secondary small" onClick={loadCatalog}>Retry</button>
                </div>
            );
        } else if (marketGroups.length === 0) {
            body = <div className="section-empty">{hasQuery ? t('config.skill.noMatch') : t('config.skill.marketEmpty')}</div>;
        } else {
            body = (
                <div className="section-groups">
                    {marketGroups.map(g => (
                        <div key={g.key} className="section-group">
                            <div className="section-group-title">
                                {t(CATEGORY_TITLE_KEYS[g.key])}
                                <span className="section-group-count">({g.items.length})</span>
                            </div>
                            <div className="skill-market-grid">
                                {g.items.map(renderMarketCard)}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="section-search-box">
                    <input
                        type="text"
                        className="section-search-input"
                        placeholder={t('config.skill.hubSearchPlaceholder')}
                        value={marketQuery}
                        onChange={(e) => setMarketQuery(e.target.value)}
                    />
                </div>
                {body}
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
                    {activeTab === 'installed' ? (
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
                    ) : (
                        <button
                            className={`section-icon-btn ${catalogLoading ? 'btn-loading' : ''}`}
                            onClick={loadCatalog}
                            title={t('config.skill.refresh')}
                            disabled={catalogLoading}
                        >
                            {catalogLoading ? (
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
                {activeTab === 'hub' ? renderMarket() : loading ? (
                    <div className="section-loading">{t('common.loading')}</div>
                ) : (
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
                )}
            </div>
        </div>
    );
};

export default SkillConfig;
