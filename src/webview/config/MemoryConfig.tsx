import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
import { RefreshIcon, EditIcon, LinkIcon } from './utils/svgIcons';
import './style/agent.css';

interface MemoryConfigItem {
    prompt: string;
    from?: string;
    FilePath?: string;
    refFilePath?: string[];
}

interface MemoryConfigProps {
    vscode: VscodeApi;
}

const MemoryConfig: React.FC<MemoryConfigProps> = ({ vscode }) => {
    const [memoryList, setMemoryList] = useState<MemoryConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);


    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loadMemoryInfoResult':
                    if (message.success) {
                        const data = message.data;
                        setMemoryList(Array.isArray(data) ? data : data ? [data] : []);
                    }
                    setLoading(false);
                    break;
                case 'refreshMemoryInfoResult':
                    if (message.success) {
                        const data = message.data;
                        setMemoryList(Array.isArray(data) ? data : data ? [data] : []);
                    }
                    setIsRefreshing(false);
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadMemoryInfo' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleRefresh = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'refreshMemoryInfo' });
    };

    const openFile = (filePath: string) => {
        vscode.postMessage({ command: 'openFile', filePath });
    };

    const getFileName = (filePath: string) => filePath.split('/').pop() || filePath;

    const isReadonly = (item: MemoryConfigItem) => {
        return !!item.from && item.from !== 'sema';
    };

    const renderMemoryCard = (item: MemoryConfigItem, index: number) => {
        const readonly = isReadonly(item);

        return (
            <div key={index} className="agent-card">
                <div className="agent-header">
                    <div className="agent-name-group">
                        <span className="agent-name">
                            {item.FilePath ? getFileName(item.FilePath) : 'MEMORY.md'}
                        </span>
                        {readonly && (
                            <span className="readonly-tab">只读</span>
                        )}
                    </div>
                    {item.FilePath && !readonly && (
                        <div className="agent-card-actions">
                            <button
                                className="mcp-icon-btn"
                                title="编辑文件"
                                onClick={(e) => { e.stopPropagation(); openFile(item.FilePath!); }}
                            >
                                <EditIcon size={14} />
                            </button>
                        </div>
                    )}
                </div>

                {/* 内容预览 */}
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

                {/* 关联文件 */}
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

    return (
        <div className="agent-config plugin-config">
            {/* Tab 导航 */}
            <div className="tab-navigation">
                <div className="tab-item active">
                    Memory
                    {memoryList.length > 0 && (
                        <span className="plugin-tab-count">{memoryList.length}</span>
                    )}
                </div>
                <div className="plugin-tab-actions">
                    <button
                        className={`mcp-icon-btn ${isRefreshing ? 'btn-loading' : ''}`}
                        onClick={handleRefresh}
                        title="刷新 Memory"
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

            {/* 内容 */}
            <div className="tab-content">
                {loading ? (
                    <div className="agent-loading">加载中...</div>
                ) : memoryList.length === 0 ? (
                    <div className="section-empty">暂无 Memory 配置</div>
                ) : (
                    <div className="agent-list memory-list">
                        {memoryList.map((item, index) => renderMemoryCard(item, index))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MemoryConfig;
