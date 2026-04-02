import React from 'react';

interface TaskEndBlockProps {
    status: 'completed' | 'failed' | 'stopped';
    summary: string;
}

const STATUS_DOT_CLASS: Record<string, string> = {
    completed: 'task-end-dot task-end-dot--completed',
    failed: 'task-end-dot task-end-dot--failed',
    stopped: 'task-end-dot task-end-dot--stopped',
};

const TaskEndBlock: React.FC<TaskEndBlockProps> = ({ status, summary }) => {
    return (
        <div className="ai-resp-block">
            <div className="output-line ai-response-content">
                <span className={STATUS_DOT_CLASS[status] || 'task-end-dot'} />
                <span style={{ whiteSpace: 'pre-wrap' }}>{summary}</span>
            </div>
        </div>
    );
};

export default TaskEndBlock;
