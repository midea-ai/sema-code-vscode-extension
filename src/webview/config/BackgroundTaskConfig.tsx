import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon } from './utils/svgIcons';
import { formatDateTime } from './utils/timeUtils';
import { VscodeApi } from './types';
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

const STATUS_LABELS: Record<TaskStatus, string> = {
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    killed: 'Killed',
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

const formatStartTime = (start: number) => {
    const now = Date.now();
    const diff = now - start;
    const DAY = 24 * 60 * 60 * 1000;
    if (diff >= DAY) {
        const days = Math.floor(diff / DAY);
        return `${days}天前`;
    }
    const d = new Date(start);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
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
                <div className="task-detail-output-label">Output:</div>
                <pre className="task-detail-output">
                    {status === 'running' ? 'Waiting for output...' : 'No output'}
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
            <div className="task-detail-output-label">Output:</div>
            <pre className="task-detail-output">
                {omittedCount > 0 && (
                    <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...省略了 {omittedCount} 行</div>
                )}
                {visibleLines.join('\n')}
            </pre>
        </div>
    );
};

const CommandPanel: React.FC<{ command: string; taskId: string; vscode: VscodeApi }> = ({ command, taskId, vscode }) => {
    const handleViewAll = () => {
        vscode.postMessage({
            command: 'openBashOutput',
            content: command,
            title: 'Command: ' + command.split('\n')[0],
            toolId: taskId + '-cmd'
        });
    };

    const contentLines = command.split('\n').filter(line => line.trim());
    const totalLines = contentLines.length;
    const visibleLines = totalLines > MAX_LINES ? contentLines.slice(0, MAX_LINES) : contentLines;
    const omittedCount = totalLines > MAX_LINES ? totalLines - MAX_LINES : 0;

    return (
        <div className="task-detail-output-section">
            <div className="task-detail-output-label">Command:</div>
            <pre className="task-detail-output">
                {visibleLines.join('\n')}
                {omittedCount > 0 && (
                    <div className="bash-omitted-lines bash-omitted-lines-clickable" onClick={handleViewAll}>...省略了 {omittedCount} 行</div>
                )}
            </pre>
        </div>
    );
};

const BackgroundTaskConfig: React.FC<BackgroundTaskConfigProps> = ({ vscode, refreshTrigger, onCountChange, initialTaskId, initialTaskNonce }) => {
    const [tasks, setTasks] = useState<Map<string, TaskItem>>(new Map());
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
    const autoOpenAppliedRef = useRef<Set<string>>(new Set());

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
        onCountChange?.(Array.from(tasks.values()).filter(t => t.status === 'running').length);
    }, [tasks]);

    // Auto-open detail when only 1 task total
    useEffect(() => {
        const allTasks = Array.from(tasks.values());
        if (allTasks.length === 1 && !selectedTaskId) {
            const task = allTasks[0];
            if (!autoOpenAppliedRef.current.has(task.taskId)) {
                autoOpenAppliedRef.current.add(task.taskId);
                setSelectedTaskId(task.taskId);
            }
        }
    }, [tasks, selectedTaskId]);

    const handleStopTask = (taskId: string) => {
        vscode.postMessage({ command: 'stopTask', taskId });
    };

    const allTasks = Array.from(tasks.values()).sort((a, b) => {
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (a.status !== 'running' && b.status === 'running') return 1;
        return b.startTime - a.startTime;
    });
    const bashTasks = allTasks.filter(t => t.type === TASK_TYPE_SHELL);
    const agentTasks = allTasks.filter(t => t.type === TASK_TYPE_AGENT);
    const selectedTask = selectedTaskId ? tasks.get(selectedTaskId) : null;

    const getTaskDisplayName = (task: TaskItem) => {
        if (task.type === TASK_TYPE_AGENT && task.agentType) {
            return `${task.agentType} > ${task.command || task.filepath}`;
        }
        return task.command || task.filepath;
    };

    const renderTaskRow = (task: TaskItem) => {
        const isSelected = selectedTaskId === task.taskId;
        return (
            <div
                key={task.taskId}
                className={`task-row${isSelected ? ' selected' : ''}`}
                onClick={() => setSelectedTaskId(task.taskId)}
            >
                <span className="task-row-command">
                    <span className="task-time-tag">[{formatStartTime(task.startTime)}]</span>
                    <span className={`task-status-tag ${task.status}`}>[{STATUS_LABELS[task.status]}]</span>
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

    const renderBashDetail = (task: TaskItem) => (
        <div>
            <div className="task-detail-header">
                <span className="task-detail-title">Shell 详情</span>
                <button
                    className="section-icon-btn"
                    title="Close"
                    onClick={() => setSelectedTaskId(null)}
                >
                    <CloseIcon />
                </button>
            </div>
            <div className="task-detail-info">
                <div><strong>任务:</strong> {task.taskId}</div>
                <div><strong>状态:</strong> <span className={`task-status-text ${task.status}`}>{STATUS_LABELS[task.status]}</span></div>
                <div><strong>已运行:</strong> <RuntimeText start={task.startTime} end={task.endTime} status={task.status} /></div>
                {task.status !== 'running' && task.endTime && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px', opacity: 0.8 }}>结束: {formatDateTime(task.endTime)}</div>
                )}
                </div>
            <CommandPanel command={task.command || task.filepath} taskId={task.taskId} vscode={vscode} />
            <BashOutputPanel taskId={task.taskId} command={task.command || task.filepath} status={task.status} vscode={vscode} />
        </div>
    );

    const renderAgentDetail = (task: TaskItem) => (
        <div>
            <div className="task-detail-header">
                <span className="task-detail-title">{getTaskDisplayName(task)}</span>
                <button
                    className="section-icon-btn"
                    title="Close"
                    onClick={() => setSelectedTaskId(null)}
                >
                    <CloseIcon />
                </button>
            </div>
            <div className="task-detail-info">
                <div><strong>任务:</strong> {task.taskId}</div>
                <div><strong>状态:</strong> <span className={`task-status-text ${task.status}`}>{STATUS_LABELS[task.status]}</span></div>
                <div><strong>已运行:</strong> <RuntimeText start={task.startTime} end={task.endTime} status={task.status} /></div>
                {task.status !== 'running' && task.endTime && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.8 }}>结束: {formatDateTime(task.endTime)}</div>
                )}
            </div>
            <div style={{ marginTop: 16, padding: '0 14px 14px' }}>
                <button
                    className="task-view-detail-btn"
                    onClick={() => vscode.postMessage({ command: 'openAgentDetail', taskId: task.taskId })}
                >
                    任务详情
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
                {/* Bashes */}
                <div className="section-group">
                    <div className="section-group-title">
                        Bashes
                        <span className="section-group-count">({bashTasks.length})</span>
                    </div>
                    {bashTasks.length > 0
                        ? <div>{bashTasks.map(renderTaskRow)}</div>
                        : <div className="section-empty">暂无 Bash 任务</div>
                    }
                </div>

                {/* Local agents */}
                <div className="section-group">
                    <div className="section-group-title">
                        Local agents
                        <span className="section-group-count">({agentTasks.length})</span>
                    </div>
                    {agentTasks.length > 0
                        ? <div>{agentTasks.map(renderTaskRow)}</div>
                        : <div className="section-empty">暂无 Agent 任务</div>
                    }
                </div>
            </div>

        </div>
    );
};

export default BackgroundTaskConfig;
