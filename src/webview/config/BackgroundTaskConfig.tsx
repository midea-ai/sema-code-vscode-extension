import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon } from './utils/svgIcons';
import { VscodeApi } from './types';
import './style/task.css';

interface BackgroundTaskConfigProps {
    vscode: VscodeApi;
}

type TaskType = 'Bash' | 'Agent';
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

const BashOutputPanel: React.FC<{ taskId: string; status: TaskStatus; vscode: VscodeApi }> = ({ taskId, status, vscode }) => {
    const [output, setOutput] = useState('');
    const outputRef = useRef<HTMLPreElement>(null);

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

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    return (
        <div className="task-detail-output-section">
            <div className="task-detail-output-label">Output:</div>
            <pre ref={outputRef} className="task-detail-output">
                {output || (status === 'running' ? 'Waiting for output...' : 'No output')}
            </pre>
        </div>
    );
};

const BackgroundTaskConfig: React.FC<BackgroundTaskConfigProps> = ({ vscode }) => {
    const [tasks, setTasks] = useState<Map<string, TaskItem>>(new Map());
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const autoOpenAppliedRef = useRef<Set<string>>(new Set());

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
                                    type: item.type === 'Agent' ? 'Agent' : 'Bash',
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
                            type: msg.data.type || 'Bash',
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
                                type: msg.data.type || 'Bash',
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
    const bashTasks = allTasks.filter(t => t.type === 'Bash');
    const agentTasks = allTasks.filter(t => t.type === 'Agent');
    const selectedTask = selectedTaskId ? tasks.get(selectedTaskId) : null;

    const getTaskDisplayName = (task: TaskItem) => {
        if (task.type === 'Agent' && task.agentType) {
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
                <span className="task-detail-title">Shell details</span>
                <button
                    className="section-icon-btn"
                    title="Close"
                    onClick={() => setSelectedTaskId(null)}
                >
                    <CloseIcon />
                </button>
            </div>
            <div className="task-detail-info">
                <div><strong>TaskID:</strong> {task.taskId}</div>
                <div><strong>Status:</strong> <span className={`task-status-text ${task.status}`}>{STATUS_LABELS[task.status]}</span></div>
                <div><strong>Runtime:</strong> <RuntimeText start={task.startTime} end={task.endTime} status={task.status} /></div>
                {task.status !== 'running' && task.endTime && (
                    <div><strong>End:</strong> {new Date(task.endTime).toLocaleTimeString()}</div>
                )}
                <div className="task-detail-command-row">
                    <strong>Command:</strong>
                    <span className="task-detail-command-value">{task.command || task.filepath}</span>
                </div>
            </div>
            <BashOutputPanel taskId={task.taskId} status={task.status} vscode={vscode} />
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
                <div><strong>TaskID:</strong> {task.taskId}</div>
                <div><strong>Status:</strong> <span className={`task-status-text ${task.status}`}>{STATUS_LABELS[task.status]}</span></div>
                <div><strong>Runtime:</strong> <RuntimeText start={task.startTime} end={task.endTime} status={task.status} /></div>
                {task.status !== 'running' && task.endTime && (
                    <div><strong>End:</strong> {new Date(task.endTime).toLocaleTimeString()}</div>
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
                {selectedTask.type === 'Bash' ? renderBashDetail(selectedTask) : renderAgentDetail(selectedTask)}
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
                {bashTasks.length > 0 && (
                    <div className="section-group">
                        <div className="section-group-title">
                            Bashes
                            <span className="section-group-count">({bashTasks.length})</span>
                        </div>
                        <div>{bashTasks.map(renderTaskRow)}</div>
                    </div>
                )}

                {/* Local agents */}
                {agentTasks.length > 0 && (
                    <div className="section-group">
                        <div className="section-group-title">
                            Local agents
                            <span className="section-group-count">({agentTasks.length})</span>
                        </div>
                        <div>{agentTasks.map(renderTaskRow)}</div>
                    </div>
                )}

                {/* Empty state */}
                {allTasks.length === 0 && (
                    <div className="section-empty">No background tasks</div>
                )}
            </div>

        </div>
    );
};

export default BackgroundTaskConfig;
