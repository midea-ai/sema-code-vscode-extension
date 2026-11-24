import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon } from './utils/svgIcons';
import { formatDateTime, formatRelativeTime } from '../common/timeFormat';
import { VscodeApi } from './types';
import { useT, t } from '../common/i18n/react';
import './style/task.css';

interface BackgroundTaskConfigProps {
    vscode: VscodeApi;
    refreshTrigger?: number;
    onCountChange?: (count: number) => void;
    initialTaskId?: string;
    initialTaskNonce?: number;
}

export const TASK_TYPE_SHELL = 'RunShell';
export const TASK_TYPE_AGENT = 'SubAgent';

type TaskType = typeof TASK_TYPE_SHELL | typeof TASK_TYPE_AGENT;
type TaskStatus = 'running' | 'completed' | 'failed' | 'killed';

interface TaskItem {
    taskId: string;
    filepath: string;
    command?: string;
    type: TaskType;
    status: TaskStatus;
    startTime: number;
    endTime?: number;
    exitCode?: number;
    summary?: string;
    agentType?: string;
}

/** 状态文案在渲染期取，模块顶层常量不能存 t() 结果 */
const statusLabel = (status: TaskStatus): string => {
    switch (status) {
        case 'running':
            return t('config.bgTask.status.running');
        case 'completed':
            return t('config.bgTask.status.completed');
        case 'failed':
            return t('config.bgTask.status.failed');
        default:
            return t('config.bgTask.status.killed');
    }
};

const formatRuntime = (start: number, end?: number) => {
    const dur = Math.round(((end || Date.now()) - start) / 1000);
    if (dur < 60) return `${dur}s`;
    const m = Math.floor(dur / 60);
    const s = dur % 60;
    if (m < 60) return `${m}min${s > 0 ? s + 's' : ''}`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60}min`;
};

const RuntimeText: React.FC<{ start: number; end?: number; status: TaskStatus }> = ({ start, end, status }) => {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (status !== 'running') return;
        const timer = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(timer);
    }, [status]);
    return <>{formatRuntime(start, end)}</>;
};

const MAX_LINES = 2;

const BashOutputPanel: React.FC<{ taskId: string; command?: string; status: TaskStatus; vscode: VscodeApi }> = ({ taskId, command, status, vscode }) => {
    const t = useT();
    const [output, setOutput] = useState('');

    useEffect(() => {
        setOutput('');
        vscode.postMessage({ command: 'watchTask', taskId });

        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;
            if (msg.command === 'taskDelta' && msg.taskId === taskId) {
                setOutput(prev => prev + msg.delta);
            }
        };
        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
            vscode.postMessage({ command: 'unwatchTask', taskId });
        };
    }, [taskId, vscode]);

    const handleViewAll = () => {
        vscode.postMessage({
            command: 'openBashOutput',
            content: output,
            title: command || taskId,
            toolId: taskId
        });
    };

    if (!output) {
        return (
            <div className="task-detail-output-section">
                <div className="task-detail-output-label">{t('config.bgTask.output')}</div>
                <pre className="task-detail-output">
                    {status === 'running' ? t('config.bgTask.waitingOutput') : t('tool.noOutput')}
                </pre>
            </div>
        );
    }

    const contentLines = output.split('\n').filter(line => line.trim());
    const totalLines = contentLines.length;
    const visibleLines = totalLines > MAX_LINES ? contentLines.slice(-MAX_LINES) : contentLines;
    const omittedCount = totalLines > MAX_LINES ? totalLines - MAX_LINES : 0;

    return (
        <div className="task-detail-output-section">
            <div className="task-detail-output-label">{t('config.bgTask.output')}</div>
            <pre className="task-detail-output">
                {omittedCount > 0 && (
                    <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>{t('chat.omittedLines', { count: omittedCount })}</div>
                )}
                {visibleLines.join('\n')}
            </pre>
        </div>
    );
};

const CommandPanel: React.FC<{ command: string; taskId: string; vscode: VscodeApi }> = ({ command, taskId, vscode }) => {
    const t = useT();
    const handleViewAll = () => {
        vscode.postMessage({
            command: 'openBashOutput',
            content: command,
            title: `${t('config.bgTask.command')} ${command.split('\n')[0]}`,
            toolId: taskId + '-cmd'
        });
    };

    const contentLines = command.split('\n').filter(line => line.trim());
    const totalLines = contentLines.length;
    const visibleLines = totalLines > MAX_LINES ? contentLines.slice(0, MAX_LINES) : contentLines;
    const omittedCount = totalLines > MAX_LINES ? totalLines - MAX_LINES : 0;

    return (
        <div className="task-detail-output-section">
            <div className="task-detail-output-label">{t('config.bgTask.command')}</div>
            <pre className="task-detail-output task-detail-command">
                {visibleLines.join('\n')}
                {omittedCount > 0 && (
                    <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>{t('chat.omittedLines', { count: omittedCount })}</div>
                )}
            </pre>
        </div>
    );
};

const BackgroundTaskConfig: React.FC<BackgroundTaskConfigProps> = ({ vscode, refreshTrigger, onCountChange, initialTaskId, initialTaskNonce }) => {
    const t = useT();
    const [tasks, setTasks] = useState<Map<string, TaskItem>>(new Map());
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
    const [endedExpanded, setEndedExpanded] = useState(false);
    const autoOpenAppliedRef = useRef<Set<string>>(new Set());

    // 相对时间会过期：定时重渲染，保证「X 分钟前」不越挂越旧
    const [, setTimeTick] = useState(0);
    useEffect(() => {
        if (tasks.size === 0) return;
        const timer = setInterval(() => setTimeTick(n => n + 1), 30_000);
        return () => clearInterval(timer);
    }, [tasks.size]);

    useEffect(() => {
        if (initialTaskId) {
            setSelectedTaskId(initialTaskId);
        }
    }, [initialTaskId, initialTaskNonce]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;
            switch (msg.command) {
                case 'loadTaskListResult':
                    if (msg.success && Array.isArray(msg.data)) {
                        setTasks(() => {
                            const next = new Map<string, TaskItem>();
                            for (const item of msg.data) {
                                next.set(item.taskId, {
                                    taskId: item.taskId,
                                    filepath: item.filepath,
                                    command: item.command,
                                    type: (item.type === TASK_TYPE_AGENT ? TASK_TYPE_AGENT : TASK_TYPE_SHELL) as TaskType,
                                    status: item.status || 'running',
                                    startTime: item.startTime || Date.now(),
                                    endTime: item.endTime,
                                    agentType: item.agentType,
                                });
                            }
                            return next;
                        });
                    }
                    break;
                case 'taskStart':
                    setTasks(prev => {
                        const next = new Map(prev);
                        next.set(msg.data.taskId, {
                            taskId: msg.data.taskId,
                            filepath: msg.data.filepath,
                            command: msg.data.command,
                            type: msg.data.type || TASK_TYPE_SHELL,
                            status: msg.data.status || 'running',
                            startTime: msg.data.startTime || Date.now(),
                            agentType: msg.data.agentType,
                        });
                        return next;
                    });
                    break;
                case 'taskEnd':
                    setTasks(prev => {
                        const next = new Map(prev);
                        const existing = next.get(msg.data.taskId);
                        if (existing) {
                            next.set(msg.data.taskId, {
                                ...existing,
                                status: msg.data.status || 'completed',
                                endTime: msg.data.endTime || Date.now(),
                                exitCode: msg.data.exitCode,
                                summary: msg.data.summary,
                            });
                        } else {
                            next.set(msg.data.taskId, {
                                taskId: msg.data.taskId,
                                filepath: msg.data.filepath,
                                type: msg.data.type || TASK_TYPE_SHELL,
                                status: msg.data.status || 'completed',
                                startTime: msg.data.startTime || Date.now(),
                                endTime: msg.data.endTime || Date.now(),
                                exitCode: msg.data.exitCode,
                                summary: msg.data.summary,
                            });
                        }
                        return next;
                    });
                    break;
                case 'stopTaskResult':
                    if (msg.success) {
                        setTasks(prev => {
                            const next = new Map(prev);
                            const existing = next.get(msg.taskId);
                            if (existing) {
                                next.set(msg.taskId, { ...existing, status: 'killed', endTime: msg.endTime || Date.now() });
                            }
                            return next;
                        });
                    }
                    break;
                case 'showTaskDetail':
                    if (msg.taskId) {
                        setSelectedTaskId(msg.taskId);
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'loadTaskList' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        if (refreshTrigger && refreshTrigger > 0) {
            vscode.postMessage({ command: 'loadTaskList' });
        }
    }, [refreshTrigger]);

    useEffect(() => {
        onCountChange?.(Array.from(tasks.values()).filter(task => task.status === 'running').length);
    }, [tasks]);

    // 只有一个运行中任务时自动打开详情（已结束的不自动弹，避免进页面就翻旧账）
    useEffect(() => {
        const runningTasks = Array.from(tasks.values()).filter(task => task.status === 'running');
        if (runningTasks.length === 1 && !selectedTaskId) {
            const task = runningTasks[0];
            if (!autoOpenAppliedRef.current.has(task.taskId)) {
                autoOpenAppliedRef.current.add(task.taskId);
                setSelectedTaskId(task.taskId);
            }
        }
    }, [tasks, selectedTaskId]);

    const handleStopTask = (taskId: string) => {
        vscode.postMessage({ command: 'stopTask', taskId });
    };

    const allTasks = Array.from(tasks.values()).sort((a, b) => b.startTime - a.startTime);
    // 运行中的 Shell / Agent 各自成组，已结束的（完成、失败、已停止）统一收进「已结束」按结束时间倒序
    const runningShells = allTasks.filter(task => task.type === TASK_TYPE_SHELL && task.status === 'running');
    const runningAgents = allTasks.filter(task => task.type === TASK_TYPE_AGENT && task.status === 'running');
    const endedTasks = allTasks
        .filter(task => task.status !== 'running')
        .sort((a, b) => (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime));
    const selectedTask = selectedTaskId ? tasks.get(selectedTaskId) : null;

    const getTaskDisplayName = (task: TaskItem) => {
        if (task.type === TASK_TYPE_AGENT && task.agentType) {
            return `${task.agentType} › ${task.command || task.filepath}`;
        }
        return task.command || task.filepath;
    };

    // showStatus：运行中的分组标题已写明状态，行内不再重复；已结束分组仍需要
    const renderTaskRow = (task: TaskItem, showStatus: boolean) => {
        const isSelected = selectedTaskId === task.taskId;
        return (
            <div
                key={task.taskId}
                className={`task-row${isSelected ? ' selected' : ''}`}
                onClick={() => setSelectedTaskId(task.taskId)}
            >
                <span className="task-row-command">
                    <span className="task-time-tag" title={formatDateTime(task.startTime)}>{formatRelativeTime(task.startTime)}</span>
                    {showStatus && (
                        <span className={`task-status-tag ${task.status}`}>[{statusLabel(task.status)}]</span>
                    )}
                    {getTaskDisplayName(task)}
                </span>
                {task.status === 'running' && (
                    <button
                        className="task-kill-btn"
                        onClick={(e) => { e.stopPropagation(); handleStopTask(task.taskId); }}
                    >
                        Kill
                    </button>
                )}
            </div>
        );
    };

    const renderDetailHeader = (title: string) => (
        <div className="task-detail-header">
            <span className="task-detail-title">{title}</span>
            <button
                className="section-icon-btn"
                title={t('common.close')}
                onClick={() => setSelectedTaskId(null)}
            >
                <CloseIcon />
            </button>
        </div>
    );

    // 状态 / 任务 ID / 运行时长 / 结束时间并成一行；Shell 与 Agent 详情共用。
    // 标签弱化、值保持原对比，结束时间与其他时间一样走 common/timeFormat 的 formatDateTime
    const renderDetailMeta = (task: TaskItem) => (
        <div className="task-detail-status-row">
            <span className={`task-status-pill ${task.status}`}>{statusLabel(task.status)}</span>
            <span className="task-detail-sep" />
            <span className="task-detail-meta-item">
                <span className="task-detail-meta-label">{t('config.bgTask.task')}</span>
                {/* 子代理 ID 比 Shell 长得多，统一截到 8 位，行内宽度稳定 */}
                {task.type === TASK_TYPE_AGENT ? task.taskId.slice(0, 8) : task.taskId}
            </span>
            <span className="task-detail-sep" />
            <span className="task-detail-meta-item">
                <span className="task-detail-meta-label">{t('config.bgTask.elapsed')}</span>
                <RuntimeText start={task.startTime} end={task.endTime} status={task.status} />
            </span>
            {task.status !== 'running' && task.endTime && (
                <>
                    <span className="task-detail-sep" />
                    <span className="task-detail-meta-item">
                        <span className="task-detail-meta-label">{t('config.bgTask.endedLabel')}</span>
                        {formatDateTime(task.endTime)}
                    </span>
                </>
            )}
        </div>
    );

    const renderBashDetail = (task: TaskItem) => (
        <div>
            {renderDetailHeader(t('config.bgTask.shellDetail'))}
            {renderDetailMeta(task)}
            <CommandPanel command={task.command || task.filepath} taskId={task.taskId} vscode={vscode} />
            <BashOutputPanel taskId={task.taskId} command={task.command || task.filepath} status={task.status} vscode={vscode} />
        </div>
    );

    const renderAgentDetail = (task: TaskItem) => (
        <div>
            {renderDetailHeader(getTaskDisplayName(task))}
            {renderDetailMeta(task)}
            <div className="task-detail-actions">
                <button
                    className="task-view-detail-btn"
                    onClick={() => vscode.postMessage({ command: 'openAgentDetail', taskId: task.taskId })}
                >
                    {t('config.bgTask.viewDetail')}
                </button>
            </div>
        </div>
    );

    const renderDetailPanel = () => {
        if (!selectedTask) return null;
        return (
            <div className="task-detail-panel">
                {selectedTask.type === TASK_TYPE_SHELL ? renderBashDetail(selectedTask) : renderAgentDetail(selectedTask)}
            </div>
        );
    };

    return (
        <div className="agent-config">
            {/* Detail panel at top */}
            {renderDetailPanel()}

            {/* Task sections */}
            <div className="section-groups">
                {/* Shells（仅运行中） */}
                <div className="section-group">
                    <div className="section-group-title">
                        Shells · {t('config.bgTask.status.running')}
                        {runningShells.length > 0 && (
                            <span className="section-group-count">({runningShells.length})</span>
                        )}
                    </div>
                    {runningShells.length > 0
                        ? <div>{runningShells.map(task => renderTaskRow(task, false))}</div>
                        : <div className="section-empty">{t('config.bgTask.noShell')}</div>
                    }
                </div>

                {/* Agents（仅运行中） */}
                <div className="section-group">
                    <div className="section-group-title">
                        Agents · {t('config.bgTask.status.running')}
                        {runningAgents.length > 0 && (
                            <span className="section-group-count">({runningAgents.length})</span>
                        )}
                    </div>
                    {runningAgents.length > 0
                        ? <div>{runningAgents.map(task => renderTaskRow(task, false))}</div>
                        : <div className="section-empty">{t('config.bgTask.noAgent')}</div>
                    }
                </div>

                {/* 已结束：完成 / 失败 / 已停止，按结束时间倒序，默认折叠 */}
                {endedTasks.length > 0 && (
                    <div className="section-group">
                        <div
                            className="section-group-title section-group-title-collapsible task-ended-group-title"
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => setEndedExpanded(v => !v)}
                        >
                            {t('config.bgTask.endedGroup')}
                            {endedTasks.length > 0 && (
                                <span className="section-group-count">({endedTasks.length})</span>
                            )}
                            <span className={`section-collapse-arrow ${endedExpanded ? '' : 'collapsed'}`} />
                        </div>
                        {endedExpanded && <div>{endedTasks.map(task => renderTaskRow(task, true))}</div>}
                    </div>
                )}
            </div>

        </div>
    );
};

export default BackgroundTaskConfig;
