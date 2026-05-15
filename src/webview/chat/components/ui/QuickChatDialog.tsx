import React, { useEffect, useRef } from 'react';
import { renderMarkdownToHtml } from '../../utils/markdown';
import '../../style/markdown.css';

interface QuickChatDialogProps {
    data: { question: string; content: string };
    onClose: () => void;
}

const QuickChatDialog: React.FC<QuickChatDialogProps> = ({ data, onClose }) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        buttonRef.current?.focus();
    }, []);

    // 代码高亮
    useEffect(() => {
        if (bodyRef.current && window.hljs) {
            bodyRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                window.hljs.highlightElement(block);
            });
        }
    }, [data.content]);

    return (
        <div className="quickchat-dialog-overlay">
            <div className="quickchat-dialog-modal">
                <div className="quickchat-dialog-header">
                    <span className="quickchat-dialog-icon">💡</span>
                    <span className="quickchat-dialog-title">QuickChat</span>
                    <button className="task-modal-close" onClick={onClose} title="关闭">✕</button>
                </div>
                <div className="quickchat-dialog-body" ref={bodyRef}>
                    <div className="quickchat-question">{data.question}</div>
                    <div className="quickchat-answer">
                        <div
                            className="markdown-content"
                            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(data.content) }}
                        />
                    </div>
                </div>
                <div className="quickchat-dialog-footer">
                    <button
                        ref={buttonRef}
                        className="bash-permission-btn bash-permission-btn-reject selected"
                        onClick={onClose}
                    >
                        ❯ 关闭 (Enter)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuickChatDialog;
