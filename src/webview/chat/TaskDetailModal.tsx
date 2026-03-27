import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Message, VscodeApi } from './types';
import MessageItem from './MessageItem';

interface TaskDetailModalProps {
    title: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    taskMessages: Message[];
    vscode: VscodeApi;
    onClose: () => void;
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
    title,
    status,
    taskMessages,
    vscode,
    onClose
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = useState(false);
    const prevMessagesLengthRef = useRef(taskMessages.length);

    // 点击背景关闭弹窗
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    // ESC 键关闭弹窗
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // 应用代码高亮
    useEffect(() => {
        if (window.hljs && contentRef.current) {
            contentRef.current.querySelectorAll('pre code').forEach((block) => {
                if (!block.classList.contains('hljs')) {
                    window.hljs.highlightElement(block);
                }
            });
        }
    }, [taskMessages]);

    // 监听滚动事件，检测用户是否手动滚动
    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = contentElement;
            // 如果用户滚动到了底部，可以重置 userScrolled 状态
            if (scrollHeight - scrollTop - clientHeight < 10) {
                setUserScrolled(false);
            } else {
                // 用户手动滚动到了非底部位置
                setUserScrolled(true);
            }
        };

        contentElement.addEventListener('scroll', handleScroll);
        return () => contentElement.removeEventListener('scroll', handleScroll);
    }, []);

    // 滚动到底部（仅在用户没有手动滚动且确实有新消息时）
    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        // 检查是否有新消息添加
        const hasNewMessages = taskMessages.length > prevMessagesLengthRef.current;
        
        // 只有在用户没有手动滚动，并且确实有新消息时才自动滚动
        if (!userScrolled && hasNewMessages) {
            // 使用 setTimeout 确保在 DOM 更新后滚动
            setTimeout(() => {
                if (contentElement) {
                    contentElement.scrollTop = contentElement.scrollHeight;
                }
            }, 0);
        }

        // 更新上一次的消息长度
        prevMessagesLengthRef.current = taskMessages.length;
    }, [taskMessages, userScrolled]);

    // 获取状态显示文本
    const getStatusText = () => {
        switch (status) {
            case 'running':
                return '运行中...';
            case 'completed':
                return '已完成';
            case 'failed':
                return '失败';
            default:
                return '';
        }
    };

    // 渲染消息列表
    const renderedMessages = useMemo(() => {
        if (!taskMessages || taskMessages.length === 0) {
            return (
                <div className="task-modal-empty">
                    暂无消息记录
                </div>
            );
        }

        return taskMessages.map((message) => (
            <MessageItem
                key={message.id}
                message={message}
                shouldReportChange={false}
                toolPermissionData={null}
                vscode={vscode}
                streamingContent={null}
                streamingToolContent={null}
            />
        ));
    }, [taskMessages, vscode]);

    return ReactDOM.createPortal(
        <div className="task-modal-overlay" onClick={handleBackdropClick}>
            <div className="task-modal-container">
                <div className="task-modal-header">
                    <div className="task-modal-title">
                        <span className={`task-modal-status task-status-${status}`}>
                            {getStatusText()}
                        </span>
                        <span className="task-modal-title-text">{title}</span>
                    </div>
                    <button className="task-modal-close" onClick={onClose} title="关闭">
                        ✕
                    </button>
                </div>
                <div className="task-modal-content" ref={contentRef}>
                    {renderedMessages}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default TaskDetailModal;