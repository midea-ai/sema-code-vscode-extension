import React, { useEffect, useMemo, useState } from 'react';
import { VscodeApi } from './types';
import {
    ArrowRightIcon, BotIcon, BrainIcon, ChevronDownIcon, CloseIcon,
    FileTextIcon, SparklesIcon, SquareSlashIcon, WebhookIcon, WrenchIcon,
} from './utils/svgIcons';
import { useT } from '../common/i18n/react';
import type { I18nKey } from '../common/i18n/react';
import type { CategoryPreview, ImportCategory, ImportItem, ImportPreview, ImportScope, ImportSource, SourceStatus } from './import/types';
import './style/section.css';
import './style/import.css';

/**
 * 「导入」页：从 Claude Code / Codex / Cursor 导入配置。
 * 主页面只列出检测到的来源（图标 + 名称 + 导入按钮）；点「导入」弹面板做范围 / 类别 / 条目级勾选；导入完成即关闭面板。
 * 探测、预览、执行三个消息与宿主对接（VSCode configWebview / JB config-controller 同名）。
 */

// 产品名与 MCP / Skills / Rules 等产品术语保持英文，不走 i18n（对齐侧栏导航）
const SOURCE_LABELS: Record<ImportSource, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
const CATEGORY_LABELS: Record<ImportCategory, string> = { mcp: 'MCP', skill: 'Skills', agent: 'Agents', command: 'Commands', hook: 'Hooks', rule: 'Rules', memory: 'Memory' };

/** 类别图标：Lucide 图形，按类别固定 */
const CATEGORY_ICONS: Record<ImportCategory, React.FC<{ size?: number }>> = {
    mcp: WrenchIcon, skill: SparklesIcon, agent: BotIcon, command: SquareSlashIcon, hook: WebhookIcon, rule: FileTextIcon, memory: BrainIcon,
};

const CATEGORY_DESCS: Record<ImportCategory, I18nKey> = {
    mcp: 'config.import.cat.mcp',
    skill: 'config.import.cat.skill',
    agent: 'config.import.cat.agent',
    command: 'config.import.cat.command',
    hook: 'config.import.cat.hook',
    rule: 'config.import.cat.rule',
    memory: 'config.import.cat.memory',
};

/** 来源图标：圆角色块 + 首字母，不用品牌图标 */
const SourceIcon: React.FC<{ source: ImportSource }> = ({ source }) => (
    <span className={`import-source-icon ${source}`}>{SOURCE_LABELS[source].charAt(0)}</span>
);

interface ImportConfigProps {
    vscode: VscodeApi;
}

const ImportConfig: React.FC<ImportConfigProps> = ({ vscode }) => {
    const t = useT();
    const [statuses, setStatuses] = useState<SourceStatus[] | null>(null);

    const [panelSource, setPanelSource] = useState<ImportSource | null>(null);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [scopeTab, setScopeTab] = useState<ImportScope>('project');
    // 两个范围各自保留勾选，互不影响
    const [selected, setSelected] = useState<Record<ImportScope, Set<string>>>({ project: new Set(), user: new Set() });
    const [expanded, setExpanded] = useState<Set<ImportCategory>>(new Set());
    const [importing, setImporting] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'importDetectSourcesResult':
                    setStatuses(message.success ? (message.data as SourceStatus[]) : []);
                    break;
                case 'importPreviewResult':
                    if (message.success) {
                        const p = message.data as ImportPreview;
                        setPreview(p);
                        // 默认落在有内容的一侧：项目无条目时直接看用户全局
                        setScopeTab(p.categories.some(c => c.items.some(i => i.scope === 'project')) ? 'project' : 'user');
                        const pick = (scope: ImportScope) =>
                            new Set(p.categories.flatMap(c => c.items.filter(i => i.scope === scope && !i.exists).map(i => i.id)));
                        setSelected({ project: pick('project'), user: pick('user') });
                        setExpanded(new Set());
                    } else {
                        setPreviewError(message.message || t('common.unknownError'));
                    }
                    break;
                case 'importExecuteResult':
                    // 导入完成即关闭面板，不展示结果；失败时留在面板并显示错误
                    setImporting(false);
                    if (message.success) { setPanelSource(null); setPreview(null); }
                    else setPreviewError(message.message || t('common.unknownError'));
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'importDetectSources' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const openPanel = (source: ImportSource) => {
        setPanelSource(source);
        setPreview(null);
        setPreviewError(null);
        vscode.postMessage({ command: 'importPreview', source });
    };

    const closePanel = () => {
        if (importing) return;
        setPanelSource(null);
        setPreview(null);
    };

    // 范围 tab 只影响显示：这里按当前 tab 过滤类别与条目，条目为空的类别不显示
    const visibleCats = useMemo<CategoryPreview[]>(() => (preview?.categories ?? [])
        .map(cat => ({ ...cat, items: cat.items.filter(i => i.scope === scopeTab) }))
        .filter(cat => cat.items.length > 0), [preview, scopeTab]);

    // 计数只算当前 tab，两个范围互不影响
    const selectedInTab = selected[scopeTab];
    const summary = useMemo(() => {
        let n = 0, m = 0;
        for (const cat of visibleCats) for (const item of cat.items) { if (selectedInTab.has(item.id)) n++; else m++; }
        return { n, m };
    }, [visibleCats, selectedInTab]);

    const updateSelected = (fn: (prev: Set<string>) => Set<string>) => {
        setSelected(prev => ({ ...prev, [scopeTab]: fn(prev[scopeTab]) }));
    };

    const toggleCategory = (cat: CategoryPreview, checked: boolean) => {
        updateSelected(prev => {
            const next = new Set(prev);
            for (const item of cat.items) { if (item.exists) continue; if (checked) next.add(item.id); else next.delete(item.id); }
            return next;
        });
    };

    const toggleItem = (id: string, checked: boolean) => {
        updateSelected(prev => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next; });
    };

    const toggleExpanded = (category: ImportCategory) => {
        setExpanded(prev => { const next = new Set(prev); if (next.has(category)) next.delete(category); else next.add(category); return next; });
    };

    const startImport = () => {
        if (!preview || !panelSource) return;
        const items: ImportItem[] = visibleCats.flatMap(c => c.items.filter(i => selectedInTab.has(i.id)));
        setImporting(true);
        setPreviewError(null);
        vscode.postMessage({ command: 'importExecute', source: panelSource, items });
    };

    const scopeLabel = (scope: ImportScope) => (scope === 'project' ? t('config.import.scope.project') : t('config.import.scope.user'));

    // 类别卡片：整行是勾选 + 图标 + 名称/说明 + 数量 + 展开箭头；不支持或没找到的类别不显示
    const renderCategoryCard = (cat: CategoryPreview) => {
        const selectable = cat.items.filter(i => !i.exists);
        const disabled = selectable.length === 0;
        const checked = !disabled && selectable.every(i => selectedInTab.has(i.id));
        const isExpanded = expanded.has(cat.category);
        const Icon = CATEGORY_ICONS[cat.category];
        // 来源行只给 MCP / Hook：这两类条目不带文件路径；其余类别条目行里已有路径
        const sourcePaths = cat.category === 'mcp' || cat.category === 'hook'
            ? cat.sourcePaths.filter(s => s.scope === scopeTab).map(s => s.path)
            : [];
        return (
            <div key={cat.category} className={`import-card ${disabled ? 'disabled' : ''}`}>
                <div className="import-card-head">
                    <input
                        type="checkbox"
                        className="import-check"
                        checked={checked}
                        disabled={disabled}
                        onChange={e => toggleCategory(cat, e.target.checked)}
                    />
                    <span className="import-card-icon"><Icon size={16} /></span>
                    <span className="import-card-text">
                        <span className="import-card-title">{CATEGORY_LABELS[cat.category]}</span>
                        <span className="import-card-desc">{t(CATEGORY_DESCS[cat.category])}</span>
                    </span>
                    <span className="import-card-count">{t('config.import.itemCount', { n: cat.items.length })}</span>
                    <button
                        className={`import-card-toggle ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleExpanded(cat.category)}
                        title={isExpanded ? t('common.collapse') : t('common.expand')}
                    >
                        <ChevronDownIcon size={16} />
                    </button>
                </div>
                {isExpanded && (
                    <div className="import-card-body">
                        <div className="import-items">
                            {cat.items.map(item => {
                                // MCP / Hook 的条目都来自同一个来源文件，右侧改显示命令/URL 这类描述
                                const trailing = cat.category === 'mcp' || cat.category === 'hook' ? item.detail : item.sourcePath;
                                return (
                                    <label
                                        key={item.id}
                                        className={`checkbox-label import-item ${item.exists ? 'exists' : ''}`}
                                        title={trailing}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedInTab.has(item.id)}
                                            disabled={item.exists}
                                            onChange={e => toggleItem(item.id, e.target.checked)}
                                        />
                                        <span className="import-item-name">{item.name}</span>
                                        {item.exists && <span className="import-item-tag">{t('config.import.exists')}</span>}
                                        {trailing && <span className="import-item-path">{trailing}</span>}
                                    </label>
                                );
                            })}
                        </div>
                        {sourcePaths.length > 0 && (
                            <div className="import-card-source">
                                <span>{t('config.import.sourceLabel')}</span>
                                <span className="import-card-source-path" title={sourcePaths.join('\n')}>{sourcePaths.join(' · ')}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderPanelBody = () => {
        if (previewError && !preview) return <div className="section-empty">{t('config.import.loadFailed', { error: previewError })}</div>;
        if (!preview) return <div className="section-loading">{t('common.loading')}</div>;
        const scopeOptions: ImportScope[] = preview.hasProject ? ['project', 'user'] : ['user'];
        return (
            <>
                {/* 范围筛选：分段控件切换 tab，两侧勾选各自独立 */}
                <div className="import-toolbar">
                    <span className="import-toolbar-label">{t('config.import.scopeLabel')}</span>
                    <div className="import-segmented">
                        {scopeOptions.map(scope => (
                            <button
                                key={scope}
                                className={`import-seg-btn ${scopeTab === scope ? 'active' : ''}`}
                                onClick={() => setScopeTab(scope)}
                            >
                                {scopeLabel(scope)}
                            </button>
                        ))}
                    </div>
                    <span className="import-toolbar-count">{t('config.import.selectedCount', { n: summary.n })}</span>
                </div>
                {previewError && <div className="section-edit-error">{previewError}</div>}
                {visibleCats.length > 0
                    ? <div className="import-cards">{visibleCats.map(renderCategoryCard)}</div>
                    : <div className="section-empty">{t('config.import.nothingToImport')}</div>}
            </>
        );
    };

    const detected = (statuses ?? []).filter(s => s.detected).map(s => s.source);

    return (
        <div className="import-page">
            <h2 className="section-title">{t('config.import.title')}</h2>
            <div className="import-subtitle">{t('config.import.subtitle')}</div>
            {statuses === null
                ? <div className="section-loading">{t('config.import.detecting')}</div>
                : detected.length === 0
                    ? <div className="section-empty">{t('config.import.nothingToImport')}</div>
                    : (
                        <div className="import-list">
                            {detected.map(source => (
                                <div key={source} className="import-row">
                                    <SourceIcon source={source} />
                                    <span className="import-row-name">{SOURCE_LABELS[source]}</span>
                                    <button className="section-btn secondary small" onClick={() => openPanel(source)}>{t('config.import.importBtn')}</button>
                                </div>
                            ))}
                        </div>
                    )}

            {panelSource && (
                <div className="section-modal-overlay" onClick={closePanel}>
                    <div className="section-modal import-modal" onClick={e => e.stopPropagation()}>
                        <div className="section-modal-header">
                            <span>{t('config.import.panelTitle', { source: SOURCE_LABELS[panelSource] })}</span>
                            <button className="section-modal-close" onClick={closePanel} disabled={importing}><CloseIcon /></button>
                        </div>
                        <div className="section-modal-body">{renderPanelBody()}</div>
                        <div className="section-modal-footer">
                            <span className="import-summary">{preview ? t('config.import.summary', { n: summary.n, m: summary.m }) : ''}</span>
                            <button className="section-btn secondary" onClick={closePanel} disabled={importing}>{t('common.cancel')}</button>
                            <button
                                className={`section-btn primary import-start ${importing ? 'btn-loading' : ''}`}
                                onClick={startImport}
                                disabled={!preview || importing || summary.n === 0}
                            >
                                {importing && <span className="spinner" />}
                                {importing ? t('config.import.importing') : <>{t('config.import.start')}<ArrowRightIcon size={14} /></>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportConfig;
