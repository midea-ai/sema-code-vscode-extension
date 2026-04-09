import React, { useEffect, useRef } from 'react';
import { renderMarkdownToHtml } from '../../utils/markdown';
import '../../style/markdown.css';

interface BtwDialogProps {
    data: { question: string; content: string };
    onClose: () => void;
}

const BtwDialog: React.FC<BtwDialogProps> = ({ data, onClose }) => {
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
        <div className="btw-dialog-overlay">
            <div className="btw-dialog-modal">
                <div className="btw-dialog-header">
                    <span className="btw-dialog-icon">💡</span>
                    <span className="btw-dialog-title">BTW</span>
                    <button className="task-modal-close" onClick={onClose} title="关闭">✕</button>
                </div>
                <div className="btw-dialog-body" ref={bodyRef}>
                    <div className="btw-question">{data.question}</div>
                    <div className="btw-answer">
                        <div
                            className="markdown-content"
                            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(data.content) }}
                        />
                    </div>
                </div>
                <div className="btw-dialog-footer">
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

export default BtwDialog;
