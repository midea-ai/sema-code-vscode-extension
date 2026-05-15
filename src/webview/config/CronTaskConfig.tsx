import React, { useState, useEffect, useMemo } from 'react';
import { VscodeApi } from './types';
import { ExpandArrowIcon, EditIcon, TrashIcon } from './utils/svgIcons';
import { formatDateTime } from './utils/timeUtils';
import './style/task.css';
import './style/section.css';

interface CronTaskConfigProps {
    vscode: VscodeApi;
    refreshTrigger?: number;
    onCountChange?: (count: number) => void;
}

interface CronTask {
    id: string;
    schedule: string;
    task: string;
    repeat: boolean;
    persist: boolean;
    status: boolean;
    filePath?: string;
    createdAt: number;
    describeCronExpression: string;
    activatedAt: number;
    lastFiredAt?: number;
    nextFireAt: number[];
}

const MAX_LINES = 2;

const CronTaskCard: React.FC<{
    task: CronTask;
    vscode: VscodeApi;
    onDelete: (id: string) => void;
    onToggle: (id: string, enabled: boolean) => void;
}> = ({ task, vscode, onDelete, onToggle }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="section-card">
            <div className="section-card-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
                <button
                    className={`section-expand-btn ${expanded ? 'expanded' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    <ExpandArrowIcon />
                </button>
                <span className="section-card-name">
                    <span style={{ color: 'var(--vscode-descriptionForeground)', fontWeight: 'normal', fontSize: '11px' }}>{task.id}</span> {task.describeCronExpression}
                </span>
                <div className="section-card-actions" onClick={(e) => e.stopPropagation()}>
                    {task.filePath && (
                        <button
                            className="section-icon-btn"
                            title="编辑"
                            onClick={() => {
                                const match = task.filePath!.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
                                if (match) {
                                    vscode.postMessage({
                                        command: 'openFile',
                                        filePath: match[1],
                                        ...(match[2] ? { line: Number(match[2]) } : {}),
                                        ...(match[3] ? { endLine: Number(match[3]) } : {}),
                                    });
                                }
                            }}
                        >
                            <EditIcon />
                        </button>
                    )}
                    <button
                        className="section-icon-btn section-icon-btn-danger"
                        title="删除"
                        onClick={() => onDelete(task.id)}
                    >
                        <TrashIcon />
                    </button>
                    <label className="section-switch">
                        <input
                            type="checkbox"
                            checked={task.status}
                            onChange={(e) => onToggle(task.id, e.target.checked)}
                        />
                        <span className="section-switch-slider"></span>
                    </label>
                </div>
            </div>
            {expanded && (
                <>
                    <div className="task-detail-info">
                        <div><strong>Cron:</strong> <span className="cron-expression-tag">{task.schedule.split('').map((ch, i) => ch === '*' ? ch : <span key={i} className="cron-highlight">{ch}</span>)}</span> <span className="readonly-tab">{task.repeat ? '周期' : '一次性'}</span>{task.persist && <> <span className="readonly-tab">持久化</span></>}</div>
                        <div style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.8 }}>创建时间: {formatDateTime(task.createdAt)}</div>
                    </div>
                    <div className="cron-card-body">
                        <div className="task-detail-output-label">Prompt:</div>
                        <pre className="task-detail-output">
                            {(() => {
                                const lines = task.task.split('\n');
                                if (lines.length <= MAX_LINES) return task.task;
                                const visible = lines.slice(0, MAX_LINES).join('\n');
                                const omitted = lines.length - MAX_LINES;
                                return (<>
                                    {visible}
                                    {'\n'}
                                    <div
                                        className="bash-omitted-lines bash-omitted-lines-clickable"
                                        onClick={() => vscode.postMessage({
                                            command: 'openBashOutput',
                                            content: task.task,
                                            title: `${task.id} (${task.describeCronExpression})`,
                                            toolId: task.id,
                                        })}
                                    >...省略了 {omitted} 行</div>
                                </>);
                            })()}
                        </pre>
                        {task.nextFireAt.length > 0 && (
                            <div className="cron-next-fire-section">
                                <div className="task-detail-output-label">预计触发时间:</div>
                                <pre className="task-detail-output">{task.nextFireAt.map(t => formatDateTime(t)).join('\n')}</pre>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

const CronTaskConfig: React.FC<CronTaskConfigProps> = ({ vscode, refreshTrigger, onCountChange }) => {
    const [tasks, setTasks] = useState<CronTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const filteredTasks = useMemo(() => [...tasks].sort((a, b) => {
        if (a.status !== b.status) return a.status ? -1 : 1;
        const aNext = a.nextFireAt[0] ?? Infinity;
        const bNext = b.nextFireAt[0] ?? Infinity;
        return aNext - bNext;
    }), [tasks]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;
            switch (msg.command) {
                case 'loadCronTasksResult':
                    if (msg.success) {
                        setTasks(Array.isArray(msg.data) ? msg.data : []);
                    }
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'deleteCronTaskResult':
                    // 删除成功后不在 UI 层移除，由 cron:update 事件触发重新加载
                    break;
                case 'enableCronTaskResult':
                    if (msg.success) {
                        setTasks(prev => prev.map(t => t.id === msg.id ? { ...t, status: true } : t));
                    }
                    break;
                case 'disableCronTaskResult':
                    if (msg.success) {
                        setTasks(prev => prev.map(t => t.id === msg.id ? { ...t, status: false } : t));
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        setLoading(true);
        vscode.postMessage({ command: 'loadCronTasks' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        if (refreshTrigger && refreshTrigger > 0) {
            handleRefresh();
        }
    }, [refreshTrigger]);

    useEffect(() => {
        onCountChange?.(filteredTasks.length);
    }, [filteredTasks]);

    const handleRefresh = () => {
        setRefreshing(true);
        vscode.postMessage({ command: 'loadCronTasks' });
    };

    const handleDelete = (id: string) => {
        vscode.postMessage({ command: 'deleteCronTask', id });
    };

    const handleToggle = (id: string, enabled: boolean) => {
        vscode.postMessage({ command: enabled ? 'enableCronTask' : 'disableCronTask', id });
    };

    if (loading) {
        return <div className="section-loading">加载中...</div>;
    }

    const renderTaskCard = (task: CronTask) => <CronTaskCard key={task.id} task={task} vscode={vscode} onDelete={handleDelete} onToggle={handleToggle} />;

    return (
        <div className="agent-config">
            <div className="section-groups">
                <div className="section-group">
                    <div className="section-group-title">
                        项目级 Crons
                        <span className="section-group-count">(.sema/scheduled_tasks.json)</span>
                    </div>
                    {filteredTasks.length > 0 ? (
                        <div className="section-list" style={{ gridTemplateColumns: '1fr' }}>
                            {filteredTasks.map(task => renderTaskCard(task))}
                        </div>
                    ) : (
                        <div className="section-empty">暂无定时任务</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CronTaskConfig;
