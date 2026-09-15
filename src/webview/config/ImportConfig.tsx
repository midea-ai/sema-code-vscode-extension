import React, { useEffect, useMemo, useState } from 'react';
import { VscodeApi } from './types';
import { CloseIcon } from './utils/svgIcons';
import { useT } from '../common/i18n/react';
import type { CategoryPreview, ImportCategory, ImportItem, ImportPreview, ImportScope, ImportSource, SourceStatus } from './import/types';
import './style/section.css';
import './style/import.css';

/**
 * 「导入」页：从 Claude Code / Codex / Cursor 导入配置。
 * 主页面只列出检测到的来源（图标 + 名称 + 导入按钮）；点「导入」弹面板做范围 / 类别 / 条目级勾选；导入完成即关闭面板。
 * 探测、预览、执行三个消息与宿主对接（VSCode configWebview / JB config-controller 同名）。
 */

// 产品名与 MCP / Skills 等产品术语保持英文，不走 i18n（对齐侧栏导航）；「规则」不是产品术语，走 i18n
const SOURCE_LABELS: Record<ImportSource, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
const CATEGORY_LABELS: Partial<Record<ImportCategory, string>> = { mcp: 'MCP', skill: 'Skills', agent: 'Agents', command: 'Commands', hook: 'Hooks' };

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
    const [scopes, setScopes] = useState<Record<ImportScope, boolean>>({ project: true, user: true });
    const [selected, setSelected] = useState<Set<string>>(new Set());
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
                        setScopes({ project: true, user: true });
                        setSelected(new Set(p.categories.flatMap(c => c.items.filter(i => !i.exists).map(i => i.id))));
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

    // 范围过滤后的可见类别 / 条目：范围未选中的条目既不导入也不计数；条目为空的类别不显示
    const visibleCats = useMemo<CategoryPreview[]>(() => (preview?.categories ?? [])
        .map(cat => ({ ...cat, items: cat.items.filter(i => scopes[i.scope]) }))
        .filter(cat => cat.items.length > 0), [preview, scopes]);

    const summary = useMemo(() => {
        let n = 0, m = 0;
        for (const cat of visibleCats) for (const item of cat.items) { if (selected.has(item.id)) n++; else m++; }
        return { n, m };
    }, [visibleCats, selected]);

    const toggleCategory = (cat: CategoryPreview, checked: boolean) => {
        setSelected(prev => {
            const next = new Set(prev);
            for (const item of cat.items) { if (item.exists) continue; if (checked) next.add(item.id); else next.delete(item.id); }
            return next;
        });
    };

    const toggleItem = (id: string, checked: boolean) => {
        setSelected(prev => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next; });
    };

    const toggleExpanded = (category: ImportCategory) => {
        setExpanded(prev => { const next = new Set(prev); if (next.has(category)) next.delete(category); else next.add(category); return next; });
    };

    const startImport = () => {
        if (!preview || !panelSource) return;
        const items: ImportItem[] = visibleCats.flatMap(c => c.items.filter(i => selected.has(i.id)));
        setImporting(true);
        setPreviewError(null);
        vscode.postMessage({ command: 'importExecute', source: panelSource, items });
    };

    const scopeLabel = (scope: ImportScope) => (scope === 'project' ? t('config.import.scope.project') : t('config.import.scope.user'));

    // 只渲染范围过滤后仍有条目的类别（visibleCats 已过滤），不支持或没找到的类别不做解释
    const renderCategoryRow = (cat: CategoryPreview) => {
        const selectable = cat.items.filter(i => !i.exists);
        const disabled = selectable.length === 0;
        const checked = !disabled && selectable.every(i => selected.has(i.id));
        const isExpanded = expanded.has(cat.category);
        return (
            <div key={cat.category} className={`import-cat-row ${disabled ? 'disabled' : ''}`}>
                <div className="import-cat-head">
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => toggleCategory(cat, e.target.checked)} />
                    <span className="import-cat-name">{CATEGORY_LABELS[cat.category] ?? t('config.import.cat.rule')}</span>
                    <span className="section-tab-count">{cat.items.length}</span>
                    <span className="import-cat-paths" title={cat.sourcePaths.join('\n')}>{cat.sourcePaths.join(' · ')}</span>
                    <button className="import-expand" onClick={() => toggleExpanded(cat.category)}>
                        {isExpanded ? t('common.collapse') : t('common.expand')}
                    </button>
                </div>
                {isExpanded && (
                    <div className="import-items">
                        {cat.items.map(item => (
                            <label key={item.id} className={`checkbox-label import-item ${item.exists ? 'exists' : ''}`} title={item.sourcePath}>
                                <input
                                    type="checkbox"
                                    checked={selected.has(item.id)}
                                    disabled={item.exists}
                                    onChange={e => toggleItem(item.id, e.target.checked)}
                                />
                                <span className="import-item-name">{item.name}</span>
                                <span className="import-tag">{scopeLabel(item.scope)}</span>
                                {item.detail && <span className="import-item-detail" title={item.detail}>{item.detail}</span>}
                                {item.exists && <span className="import-tag">{t('config.import.exists')}</span>}
                            </label>
                        ))}
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
                {/* 范围筛选：分段按钮，与下方的勾选列表区分开 */}
                <div className="import-scope-row">
                    <span className="import-scope-label">{t('config.import.scopeLabel')}</span>
                    {scopeOptions.map(scope => (
                        <button
                            key={scope}
                            className={`import-scope-chip ${scopes[scope] ? 'active' : ''}`}
                            onClick={() => setScopes(s => ({ ...s, [scope]: !s[scope] }))}
                        >
                            {scopeLabel(scope)}
                        </button>
                    ))}
                </div>
                {previewError && <div className="section-edit-error">{previewError}</div>}
                {visibleCats.length > 0
                    ? <div className="import-cat-list">{visibleCats.map(renderCategoryRow)}</div>
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
                                className={`section-btn primary ${importing ? 'btn-loading' : ''}`}
                                onClick={startImport}
                                disabled={!preview || importing || summary.n === 0}
                            >
                                {importing && <span className="spinner" />}
                                {importing ? t('config.import.importing') : t('config.import.start')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportConfig;
