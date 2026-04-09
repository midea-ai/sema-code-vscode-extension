import React from 'react';
import { getResponseDot } from '../utils/symbols';

interface TaskEndBlockProps {
    status: 'completed' | 'failed' | 'killed';
    summary: string;
}

const STATUS_DOT_CLASS: Record<string, string> = {
    completed: 'dot-success',
    failed: 'dot-error',
    killed: 'dot-killed',
};

const TaskEndBlock: React.FC<TaskEndBlockProps> = ({ status, summary }) => {
    return (
        <div className="chat-block chat-block--borderless ai-resp-block">
            <div className="output-line ai-response-content">
                <span className={`response-indicator ${STATUS_DOT_CLASS[status] || ''}`}>{getResponseDot()}</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{summary}</span>
            </div>
        </div>
    );
};

export default TaskEndBlock;
