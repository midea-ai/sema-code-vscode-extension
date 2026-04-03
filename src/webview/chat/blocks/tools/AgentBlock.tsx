import React, { useState, useCallback, useEffect } from 'react';
import { Message, VscodeApi } from '../../types';
import TaskDetailModal from '../../TaskDetailModal';

// Task 消息内容类型
export interface TaskMessageContent {
    taskId: string;              // 子代理唯一标识
    subagent_type: string;       // Explore | Plan 等
    description: string;         // 任务简短描述（3-5个词）
    prompt: string;              // 任务prompt
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    summary: string;             // 实时结果摘要
    taskMessages: Message[];     // 完整消息历史（用于弹窗展示）
    run_in_background?: boolean; // 是否后台运行
}

interface AgentBlockProps {
    content: TaskMessageContent;
    vscode: VscodeApi;
    forceClose?: boolean;
    externalOpen?: boolean;
    onExternalClose?: () => void;
}

const AgentBlock: React.FC<AgentBlockProps> = React.memo(({ content, vscode, forceClose, externalOpen, onExternalClose }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    // 当有权限请求时自动关闭详情弹窗
    useEffect(() => {
        if (forceClose && isModalOpen) {
            setIsModalOpen(false);
        }
    }, [forceClose]);

    // 外部触发打开
    useEffect(() => {
        if (externalOpen && !isModalOpen) {
            setIsModalOpen(true);
        }
    }, [externalOpen]);

    const { subagent_type, description, status, summary, taskMessages, run_in_background } = content;

    // 构建标题
    const title = `${subagent_type}(${description})`;

    // 截断每行超过100字符的内容
    const truncateSummary = (text: string) => {
        return text.split('\n').map(line =>
            line.length > 100 ? line.slice(0, 100) + '…' : line
        ).join('\n');
    };

    // 获取状态图标
    const getStatusIcon = () => {
        switch (status) {
            case 'running':
                return <span className="task-status-icon running">●</span>;
            case 'completed':
                return <span className="task-status-icon completed">✓</span>;
            case 'failed':
            case 'interrupted':
                return <span className="task-status-icon failed">✗</span>;
            default:
                return null;
        }
    };

    const handleOpenModal = useCallback(() => {
        setIsModalOpen(true);
    }, []);

    const handleCloseModal = useCallback(() => {
        setIsModalOpen(false);
        onExternalClose?.();
    }, [onExternalClose]);

    return (
        <>
            <div className={`task-block task-status-${status}`}>
                <div className="task-block-header">
                    <div className="task-block-title">
                        {getStatusIcon()}
                        {run_in_background && <span className="task-background-tag">后台</span>}
                        <span className="task-title-text">{title}</span>
                    </div>
                    <button
                        className="task-detail-btn"
                        onClick={handleOpenModal}
                    >
                        查看详情
                    </button>
                </div>
                {summary && (
                    <div className="task-block-summary">
                        <pre>{truncateSummary(summary)}</pre>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <TaskDetailModal
                    title={title}
                    status={status}
                    taskMessages={taskMessages}
                    vscode={vscode}
                    onClose={handleCloseModal}
                />
            )}
        </>
    );
});

AgentBlock.displayName = 'AgentBlock';

export default AgentBlock;
