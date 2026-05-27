import React, { useState, useCallback, useEffect, useRef, useContext } from 'react';
import { DiffContent, FileChange, Message, ToolContent, VscodeApi } from '../../types';
import TaskDetailModal from '../../TaskDetailModal';
import { SessionContext } from '../../SessionContext';
import { countDiffChanges } from '../../utils/diffParser';
import { TOOL_NAME_EDIT_NOTEBOOK, TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE } from '../../../../utils/tool';

// Task 消息内容类型
export interface TaskMessageContent {
    taskId: string;              // 子代理唯一标识
    agent_type: string;          // Default | SearchCodebase 等
    title: string;               // 任务简短描述（3-5个词）
    instructions: string;        // 任务instructions
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    summary: string;             // 实时结果摘要
    taskMessages: Message[];     // 完整消息历史（用于弹窗展示）
    background?: boolean;        // 是否后台运行
}

interface AgentBlockProps {
    content: TaskMessageContent;
    vscode: VscodeApi;
    forceClose?: boolean;
    externalOpen?: boolean;
    onExternalClose?: () => void;
    onFileChange?: (change: FileChange) => void;
}

const isDiffContent = (content: unknown): content is DiffContent => {
    return typeof content === 'object'
        && content !== null
        && ((content as any).type === 'diff' || (content as any).type === 'new');
};

const getDisplayFileName = (fileName: string): string => {
    return fileName.split(/[\\/]/).pop() || fileName;
};

const getNotebookCell = (title: string, summary?: string): { fileName: string; cellNum: number } => {
    const titleCellMatch = (title || '').match(/^(.*?)\s+cell:(\d+)$/);
    const fileName = titleCellMatch ? titleCellMatch[1] : (title || '');
    let cellNum = titleCellMatch ? parseInt(titleCellMatch[2], 10) : 0;

    if (!titleCellMatch) {
        const summaryCellMatch = (summary || '').match(/cell[:\s]+(\d+)/);
        if (summaryCellMatch) {
            cellNum = parseInt(summaryCellMatch[1], 10);
        }
    }

    return { fileName, cellNum };
};

const extractFileChange = (message: Message): FileChange | null => {
    if (message.type !== 'tool') return null;

    const toolContent = message.content as ToolContent | undefined;
    if (!toolContent || typeof toolContent !== 'object') return null;

    if (message.toolName === TOOL_NAME_WRITE_FILE || message.toolName === TOOL_NAME_PATCH_FILE) {
        const fileName = toolContent.title || '';
        if (!fileName || !isDiffContent(toolContent.content)) return null;

        const diffContent = toolContent.content as any;
        const { addedCount, removedCount } = countDiffChanges(diffContent);
        const firstHunk = diffContent.patch?.[0];

        return {
            fileName: getDisplayFileName(fileName),
            fullPath: fileName,
            type: message.toolName === TOOL_NAME_WRITE_FILE ? 'write' : 'edit',
            isNotebook: false,
            additions: addedCount,
            removals: removedCount,
            minLine: firstHunk?.oldStart || 1
        };
    }

    if (message.toolName === TOOL_NAME_EDIT_NOTEBOOK) {
        const { fileName, cellNum } = getNotebookCell(toolContent.title || '', toolContent.summary);
        const hasDiffContent = isDiffContent(toolContent.content)
            || (typeof toolContent.content === 'string' && toolContent.content.trim().length > 0);
        if (!fileName || !hasDiffContent) return null;

        return {
            fileName,
            fullPath: fileName,
            type: 'edit',
            isNotebook: true,
            additions: cellNum,
            removals: 0,
            minLine: cellNum
        };
    }

    return null;
};

const AgentBlock: React.FC<AgentBlockProps> = React.memo(({ content, vscode, forceClose, externalOpen, onExternalClose, onFileChange }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const reportedChangeKeysRef = useRef<Set<string>>(new Set());
    const sessionId = useContext(SessionContext);

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

    useEffect(() => {
        if (!onFileChange) return;

        for (const message of content.taskMessages || []) {
            const change = extractFileChange(message);
            if (!change) continue;

            const changeKey = [
                message.id,
                change.fullPath,
                change.type,
                change.isNotebook ? 'notebook' : 'file',
                change.additions,
                change.removals,
                change.minLine
            ].join(':');

            if (reportedChangeKeysRef.current.has(changeKey)) continue;
            reportedChangeKeysRef.current.add(changeKey);
            onFileChange(change);
        }
    }, [content.taskMessages, onFileChange]);

    const { agent_type, title: agentTitle, status, summary, taskMessages, background } = content;

    // 构建标题
    const title = `${agent_type}(${agentTitle})`;

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
            <div className={`chat-block task-block task-status-${status}`}>
                <div className="chat-block-header task-block-header">
                    <div className="chat-block-title task-block-title">
                        {getStatusIcon()}
                        {background && <span className="task-background-tag">后台</span>}
                        <span className="task-title-text">{title}</span>
                    </div>
                    {status === 'running' && !background && (
                        <button
                            className="task-detail-btn"
                            onClick={() => {
                                vscode.postMessage({ type: 'transferAgentToBackground', sessionId, taskId: content.taskId });
                            }}
                        >
                            转后台
                        </button>
                    )}
                    <button
                        className="task-detail-btn"
                        onClick={handleOpenModal}
                    >
                        查看详情
                    </button>
                </div>
                {summary && (
                    <div className="task-block-summary">
                        {summary.split('\n').map((line, i) => (
                            <div key={i}>{line}</div>
                        ))}
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
