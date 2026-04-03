import React from 'react';
import { getResponseDot } from '../utils/permissionUtils';

interface TaskEndBlockProps {
    status: 'completed' | 'failed' | 'killed';
    summary: string;
}

const STATUS_DOT_COLOR: Record<string, string> = {
    completed: '#4ec9a0',
    failed: '#f48771',
    killed: '#cca700',
};

const TaskEndBlock: React.FC<TaskEndBlockProps> = ({ status, summary }) => {
    return (
        <div className="ai-resp-block">
            <div className="output-line ai-response-content">
                <span className="response-indicator" style={{ color: STATUS_DOT_COLOR[status] }}>{getResponseDot()}</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{summary}</span>
            </div>
        </div>
    );
};

export default TaskEndBlock;
