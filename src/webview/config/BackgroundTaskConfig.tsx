import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CloseIcon } from './utils/svgIcons';
import { VscodeApi } from './types';
import './style/task.css';

interface BackgroundTaskConfigProps {
    vscode: VscodeApi;
}

type TaskType = 'Bash' | 'Agent';
type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

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
}

const STATUS_LABELS: Record<TaskStatus, string> = {
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    stopped: 'Stopped',
};

const BackgroundTaskConfig: React.FC<BackgroundTaskConfigProps> = ({ vscode }) => {
    const [tasks, setTasks] = useState<Map<string, TaskItem>>(new Map());
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [taskOutput, setTaskOutput] = useState<string>('');
    const outputRef = useRef<HTMLPreElement>(null);
    const watchingRef = useRef<string | null>(null);
    const autoOpenAppliedRef = useRef<Set<string>>(new Set());

    const scrollToBottom = useCallback(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, []);

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
                                    startTime: Date.now(),
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
                            startTime: Date.now(),
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
                                endTime: Date.now(),
                                exitCode: msg.data.exitCode,
                                summary: msg.data.summary,
                            });
                        } else {
                            next.set(msg.data.taskId, {
                                taskId: msg.data.taskId,
                                filepath: msg.data.filepath,
                                type: msg.data.type || 'Bash',
                                status: msg.data.status || 'completed',
                                startTime: Date.now(),
                                endTime: Date.now(),
                                exitCode: msg.data.exitCode,
                                summary: msg.data.summary,
                            });
                        }
                        return next;
                    });
                    break;
                case 'taskUpdate':
                    setTasks(prev => {
                        const next = new Map(prev);
                        const existing = next.get(msg.data.taskId);
                        if (existing) {
                            next.set(msg.data.taskId, {
                                ...existing,
                                status: msg.data.status,
                            });
                        }
                        return next;
                    });
                    break;
                case 'taskDelta':
                    if (msg.taskId === watchingRef.current) {
                        setTaskOutput(prev => prev + msg.delta);
                    }
                    break;
                case 'stopTaskResult':
                    if (msg.success) {
                        setTasks(prev => {
                            const next = new Map(prev);
                            const existing = next.get(msg.taskId);
                            if (existing) {
                                next.set(msg.taskId, { ...existing, status: 'stopped', endTime: Date.now() });
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

    // Auto-scroll on new output
    useEffect(() => {
        scrollToBottom();
    }, [taskOutput, scrollToBottom]);

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

    // Watch/unwatch on selection change
    useEffect(() => {
        if (watchingRef.current) {
            vscode.postMessage({ command: 'unwatchTask', taskId: watchingRef.current });
            watchingRef.current = null;
        }
        if (selectedTaskId) {
            setTaskOutput('');
            vscode.postMessage({ command: 'watchTask', taskId: selectedTaskId });
            watchingRef.current = selectedTaskId;
        }
        return () => {
            if (watchingRef.current) {
                vscode.postMessage({ command: 'unwatchTask', taskId: watchingRef.current });
                watchingRef.current = null;
            }
        };
    }, [selectedTaskId, vscode]);

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

    const formatRuntime = (start: number, end?: number) => {
        const dur = Math.round(((end || Date.now()) - start) / 1000);
        if (dur < 60) return `${dur}s`;
        const m = Math.floor(dur / 60);
        const s = dur % 60;
        if (m < 60) return `${m}min${s > 0 ? s + 's' : ''}`;
        const h = Math.floor(m / 60);
        return `${h}h${m % 60}min`;
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
                    <span className={`task-status-tag ${task.status}`}>[{STATUS_LABELS[task.status]}]</span>
                    {task.command || task.filepath}
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
                    className="mcp-icon-btn"
                    title="Close"
                    onClick={() => setSelectedTaskId(null)}
                >
                    <CloseIcon />
                </button>
            </div>
            <div className="task-detail-info">
                <div><strong>Status:</strong> <span className={`task-status-text ${task.status}`}>{STATUS_LABELS[task.status]}</span></div>
                <div><strong>Runtime:</strong> {formatRuntime(task.startTime, task.endTime)}</div>
                <div className="task-detail-command-row">
                    <strong>Command:</strong>
                    <span className="task-detail-command-value">{task.command || task.filepath}</span>
                </div>
            </div>
            <div className="task-detail-output-section">
                <div className="task-detail-output-label">Output:</div>
                <pre ref={outputRef} className="task-detail-output">
                    {taskOutput || (task.status === 'running' ? 'Waiting for output...' : 'No output')}
                </pre>
            </div>
        </div>
    );

    const renderAgentDetail = (task: TaskItem) => (
        <div>
            <div className="task-detail-header">
                <span className="task-detail-title">Explore &gt; {task.filepath}</span>
                <button
                    className="mcp-icon-btn"
                    title="Close"
                    onClick={() => setSelectedTaskId(null)}
                >
                    <CloseIcon />
                </button>
            </div>
            {/* Agent detail content - TBD */}
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
            <div className="agent-sections">
                {/* Bashes */}
                {bashTasks.length > 0 && (
                    <div className="agent-section">
                        <div className="section-group-title">
                            Bashes
                            <span className="section-group-count">({bashTasks.length})</span>
                        </div>
                        <div>{bashTasks.map(renderTaskRow)}</div>
                    </div>
                )}

                {/* Local agents */}
                {agentTasks.length > 0 && (
                    <div className="agent-section">
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
