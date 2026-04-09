import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
import { RefreshIcon, LinkIcon } from './utils/svgIcons';
import './style/section.css';
import './style/agent.css';

interface MemoryConfigItem {
    prompt: string;
    from?: string;
    FilePath?: string;
    refFilePath?: string[];
}

type MemoryScope = 'project' | 'other';

const MEMORY_SECTION_TITLES: Record<MemoryScope, string> = {
    project: '项目级 Memory',
    other: '外部 Memory',
};

const MEMORY_PATHS: Record<MemoryScope, string> = {
    project: '.sema/memory/MEMORY.md',
    other: '',
};

type RuleScope = 'user' | 'project' | 'other';

interface RuleConfig {
    prompt: string;
    locate?: 'user' | 'project';
    from?: string;
    filePath?: string;
}

const RULE_SECTION_TITLES: Record<RuleScope, string> = {
    project: '项目级 Rule',
    user: '用户级 Rule',
    other: '外部 Rule',
};

const RULE_PATHS: Record<RuleScope, string> = {
    project: 'AGENTS.md',
    user: '~/.sema/AGENTS.md',
    other: '',
};

interface RuleMemoryConfigProps {
    vscode: VscodeApi;
}

type ActiveTab = 'rule' | 'memory';

const RuleMemoryConfig: React.FC<RuleMemoryConfigProps> = ({ vscode }) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('rule');

    // Memory state
    const [memoryList, setMemoryList] = useState<MemoryConfigItem[]>([]);
    const [memoryLoading, setMemoryLoading] = useState(false);
    const [memoryLoaded, setMemoryLoaded] = useState(false);
    const [isMemoryRefreshing, setIsMemoryRefreshing] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState<Set<MemoryScope>>(new Set());

    // Rule state
    const [ruleList, setRuleList] = useState<RuleConfig[]>([]);
    const [ruleLoading, setRuleLoading] = useState(false);
    const [ruleLoaded, setRuleLoaded] = useState(false);
    const [isRuleRefreshing, setIsRuleRefreshing] = useState(false);
    const [collapsedRuleSections, setCollapsedRuleSections] = useState<Set<RuleScope>>(new Set());

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadMemoryInfoResult':
                    if (message.success) {
                        const data = message.data;
                        setMemoryList(Array.isArray(data) ? data : data ? [data] : []);
                    }
                    setMemoryLoading(false);
                    setMemoryLoaded(true);
                    break;
                case 'refreshMemoryInfoResult':
                    if (message.success) {
                        const data = message.data;
                        setMemoryList(Array.isArray(data) ? data : data ? [data] : []);
                    }
                    setIsMemoryRefreshing(false);
                    break;
                case 'loadRuleInfoResult':
                    if (message.success) {
                        const data = message.data;
                        setRuleList(Array.isArray(data) ? data : data ? [data] : []);
                    }
                    setRuleLoading(false);
                    setRuleLoaded(true);
                    break;
                case 'refreshRuleInfoResult':
                    if (message.success) {
                        const data = message.data;
                        setRuleList(Array.isArray(data) ? data : data ? [data] : []);
                    }
                    setIsRuleRefreshing(false);
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        // 默认加载 Rule
        vscode.postMessage({ command: 'loadRuleInfo' });
        setRuleLoading(true);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleTabChange = (tab: ActiveTab) => {
        setActiveTab(tab);
        if (tab === 'memory' && !memoryLoaded && !memoryLoading) {
            setMemoryLoading(true);
            vscode.postMessage({ command: 'loadMemoryInfo' });
        }
        if (tab === 'rule' && !ruleLoaded && !ruleLoading) {
            setRuleLoading(true);
            vscode.postMessage({ command: 'loadRuleInfo' });
        }
    };

    const openFile = (filePath: string) => {
        vscode.postMessage({ command: 'openFile', filePath });
    };

    const getFileName = (filePath: string) => filePath.split('/').pop() || filePath;

    // ─── Memory ───────────────────────────────────────────────────────────────

    const handleMemoryRefresh = () => {
        setIsMemoryRefreshing(true);
        vscode.postMessage({ command: 'refreshMemoryInfo' });
    };

    const isMemoryReadonly = (item: MemoryConfigItem) => !!item.from && item.from !== 'sema';

    const groupedMemory: Record<MemoryScope, MemoryConfigItem[]> = { project: [], other: [] };
    memoryList.forEach(item => {
        if (item.from && item.from !== 'sema') {
            groupedMemory.other.push(item);
        } else {
            groupedMemory.project.push(item);
        }
    });

    const toggleMemoryCollapse = (scope: MemoryScope) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(scope)) next.delete(scope); else next.add(scope);
            return next;
        });
    };

    const renderMemoryCard = (item: MemoryConfigItem, index: number) => {
        const readonly = isMemoryReadonly(item);
        return (
            <div key={index} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-name-group">
                        <span
                            className={`section-card-name${item.FilePath ? ' section-card-name-link' : ''}`}
                            onClick={item.FilePath ? () => openFile(item.FilePath!) : undefined}
                            style={item.FilePath ? { cursor: 'pointer' } : undefined}
                        >
                            {item.FilePath ? getFileName(item.FilePath) : 'MEMORY.md'}
                        </span>
                        {readonly && <span className="readonly-tab">只读</span>}
                        {readonly && item.from && <span className="readonly-tab">{item.from}</span>}
                    </div>
                </div>
                {item.prompt && (
                    <pre style={{
                        fontSize: '12px',
                        color: 'var(--vscode-foreground)',
                        background: 'var(--vscode-textCodeBlock-background)',
                        padding: '10px',
                        borderRadius: '4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0,
                        maxHeight: '300px',
                        overflowY: 'auto',
                    }}>
                        {item.prompt}
                    </pre>
                )}
                {item.refFilePath && item.refFilePath.length > 0 && (
                    <div style={{ marginTop: '14px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--vscode-foreground)', marginBottom: '4px' }}>
                            关联文件（{item.refFilePath.length}）
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {item.refFilePath.map((fp, fi) => (
                                <div
                                    key={fi}
                                    className="memory-ref-file"
                                    title={fp}
                                    onClick={() => openFile(fp)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <LinkIcon size={12} />
                                    <span className="memory-ref-file-name">{getFileName(fp)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ─── Rule ─────────────────────────────────────────────────────────────────

    const handleRuleRefresh = () => {
        setIsRuleRefreshing(true);
        vscode.postMessage({ command: 'refreshRuleInfo' });
    };

    const groupedRule: Record<RuleScope, RuleConfig[]> = { project: [], user: [], other: [] };
    ruleList.forEach(item => {
        if (item.from && item.from !== 'sema') {
            groupedRule.other.push(item);
        } else {
            const scope = item.locate === 'user' ? 'user' : 'project';
            groupedRule[scope].push(item);
        }
    });

    const toggleRuleCollapse = (scope: RuleScope) => {
        setCollapsedRuleSections(prev => {
            const next = new Set(prev);
            if (next.has(scope)) next.delete(scope); else next.add(scope);
            return next;
        });
    };

    const renderRuleCard = (item: RuleConfig, index: number) => {
        const readonly = !!item.from && item.from !== 'sema';
        return (
            <div key={index} className="section-card">
                <div className="section-card-header">
                    <div className="section-card-name-group">
                        <span
                            className={`section-card-name${item.filePath ? ' section-card-name-link' : ''}`}
                            onClick={item.filePath ? () => openFile(item.filePath!) : undefined}
                            style={item.filePath ? { cursor: 'pointer' } : undefined}
                        >
                            {item.filePath ? getFileName(item.filePath) : 'Rule'}
                        </span>
                        {readonly && <span className="readonly-tab">只读</span>}
                        {readonly && item.from && <span className="readonly-tab">{item.from}</span>}
                    </div>
                </div>
                {item.prompt && (
                    <pre style={{
                        fontSize: '12px',
                        color: 'var(--vscode-foreground)',
                        background: 'var(--vscode-textCodeBlock-background)',
                        padding: '10px',
                        borderRadius: '4px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0,
                        maxHeight: '300px',
                        overflowY: 'auto',
                    }}>
                        {item.prompt}
                    </pre>
                )}
            </div>
        );
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div
                    className={`tab-item ${activeTab === 'rule' ? 'active' : ''}`}
                    onClick={() => handleTabChange('rule')}
                >
                    Rule
                </div>
                <div
                    className={`tab-item ${activeTab === 'memory' ? 'active' : ''}`}
                    onClick={() => handleTabChange('memory')}
                >
                    Memory
                </div>
                <div className="section-tab-actions">
                    {activeTab === 'rule' ? (
                        <button
                            className={`section-icon-btn ${isRuleRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleRuleRefresh}
                            title="刷新 Rule"
                            disabled={isRuleRefreshing}
                        >
                            {isRuleRefreshing ? <span className="spinner" /> : <RefreshIcon size={14} />}
                        </button>
                    ) : (
                        <button
                            className={`section-icon-btn ${isMemoryRefreshing ? 'btn-loading' : ''}`}
                            onClick={handleMemoryRefresh}
                            title="刷新 Memory"
                            disabled={isMemoryRefreshing}
                        >
                            {isMemoryRefreshing ? <span className="spinner" /> : <RefreshIcon size={14} />}
                        </button>
                    )}
                </div>
            </div>

            {/* 内容 */}
            <div className="tab-content">
                {/* Rule 内容 */}
                {activeTab === 'rule' && (
                    ruleLoading ? (
                        <div className="section-loading">加载中...</div>
                    ) : (
                        <div className="section-groups">
                            {(['project', 'user', 'other'] as RuleScope[]).map(scope => {
                                const items = groupedRule[scope];
                                if (scope !== 'project' && scope !== 'user' && items.length === 0) return null;
                                const isCollapsed = collapsedRuleSections.has(scope);
                                return (
                                    <div key={scope} className={`section-group section-${scope}`}>
                                        <div
                                            className="section-group-title section-group-title-collapsible"
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => toggleRuleCollapse(scope)}
                                        >
                                            {RULE_SECTION_TITLES[scope]}
                                            {RULE_PATHS[scope] && (
                                                <span className="section-group-count">({RULE_PATHS[scope]})</span>
                                            )}
                                            <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                        </div>
                                        {!isCollapsed && (
                                            items.length === 0 ? (
                                                <div className="section-empty">暂无 Rule 配置</div>
                                            ) : (
                                                <div className="section-list memory-list">
                                                    {items.map((item, index) => renderRuleCard(item, index))}
                                                </div>
                                            )
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}

                {/* Memory 内容 */}
                {activeTab === 'memory' && (
                    memoryLoading ? (
                        <div className="section-loading">加载中...</div>
                    ) : (
                        <div className="section-groups">
                            {(['project', 'other'] as MemoryScope[]).map(scope => {
                                const items = groupedMemory[scope];
                                if (scope !== 'project' && items.length === 0) return null;
                                const isCollapsed = collapsedSections.has(scope);
                                return (
                                    <div key={scope} className={`section-group section-${scope}`}>
                                        <div
                                            className="section-group-title section-group-title-collapsible"
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => toggleMemoryCollapse(scope)}
                                        >
                                            {MEMORY_SECTION_TITLES[scope]}
                                            {MEMORY_PATHS[scope] && (
                                                <span className="section-group-count">({MEMORY_PATHS[scope]})</span>
                                            )}
                                            <span className={`section-collapse-arrow ${isCollapsed ? 'collapsed' : ''}`} />
                                        </div>
                                        {!isCollapsed && (
                                            items.length === 0 ? (
                                                <div className="section-empty">暂无 Memory 配置</div>
                                            ) : (
                                                <div className="section-list memory-list">
                                                    {items.map((item, index) => renderMemoryCard(item, index))}
                                                </div>
                                            )
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

export default RuleMemoryConfig;
