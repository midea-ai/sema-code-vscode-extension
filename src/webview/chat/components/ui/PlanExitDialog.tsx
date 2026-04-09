import React, { useState, useEffect, useRef } from 'react';
import { renderMarkdownToHtml } from '../../utils/markdown';

import '../../style/markdown.css';

interface PlanExitRequestData {
    agentId: string;
    planFilePath: string;
    planContent: string;
    options: {
        startEditing: string;
        clearContextAndStart: string;
    };
}

interface PlanExitDialogProps {
    data: PlanExitRequestData;
    onSubmit: (selected: 'startEditing' | 'clearContextAndStart') => void;
    onCancel?: () => void;
    vscode?: any;
}

const PlanExitDialog: React.FC<PlanExitDialogProps> = ({
    data,
    onSubmit,
    onCancel,
    vscode
}) => {
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const optionKeys: ('startEditing' | 'clearContextAndStart' | 'cancel')[] = ['startEditing', 'clearContextAndStart', 'cancel'];

    // 处理键盘事件
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                case 'ArrowUp':
                    event.preventDefault();
                    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : optionKeys.length - 1));
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    setSelectedIndex((prev) => (prev < optionKeys.length - 1 ? prev + 1 : 0));
                    break;
                case 'Enter':
                    event.preventDefault();
                    if (optionKeys[selectedIndex] === 'cancel') {
                        onCancel?.();
                    } else {
                        onSubmit(optionKeys[selectedIndex] as 'startEditing' | 'clearContextAndStart');
                    }
                    break;
                case 'Escape':
                    event.preventDefault();
                    onCancel?.();
                    break;
                case 'c':
                    if (event.ctrlKey) {
                        event.preventDefault();
                        onCancel?.();
                    }
                    break;
            }
        };

        if (containerRef.current) {
            containerRef.current.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            if (containerRef.current) {
                containerRef.current.removeEventListener('keydown', handleKeyDown);
            }
        };
    }, [selectedIndex, onSubmit, onCancel]);

    // 自动聚焦
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.focus();
        }
    }, []);

    // 提取文件名
    const getFileName = () => {
        const parts = data.planFilePath.split('/');
        return parts[parts.length - 1] || data.planFilePath;
    };

    // 点击文件名跳转
    const handleFileClick = () => {
        if (vscode) {
            vscode.postMessage({
                type: 'openFile',
                filePath: data.planFilePath
            });
        }
    };

    return (
        <div
            className="chat-block bash-permission-block"
            tabIndex={0}
            ref={containerRef}
            style={{ outline: 'none' }}
        >
            <div className="chat-block-header bash-permission-header">
                <div className="chat-block-title bash-permission-title">
                    <span className="bash-permission-title-text">Ready to code</span>
                    <span className="bash-permission-status">Pending</span>
                </div>
            </div>
            <div className="bash-permission-content">
                <div className="file-permission-container">
                    {/* 实线 + 文件名 */}
                    <div className="file-permission-title-wrapper">
                        <div className="file-permission-title-divider-top" />
                        {/* <div className="file-permission-title">
                            <strong className="file-permission-action">Plan File: </strong>
                            <span
                                className="file-permission-filename plan-file-link"
                                onClick={handleFileClick}
                                title={data.planFilePath}
                            >
                                {getFileName()}
                            </span>
                        </div> */}
                        {/* 标题区域 */}
                        <div className="plan-implement-header">
                            <span className="plan-implement-header-tag">Plan</span>
                            <span className="plan-implement-title">规划文档</span>
                            <span
                                className="plan-implement-file-name"
                                onClick={handleFileClick}
                            >
                                {getFileName()}
                            </span>
                  
                        </div>
                        <div className="file-permission-title-divider-bottom" />
                    </div>

                    {/* MD 内容 */}
                    <div className="plan-exit-md-content">
                        <div
                            className="markdown-content"
                            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(data.planContent, vscode) }}
                        />
                    </div>

                    {/* 底部虚线 */}
                    <div className="file-permission-code-divider" />
                </div>

                {/* 选项按钮 */}
                <div className="bash-permission-buttons">
                    {optionKeys.map((key, index) => (
                        <button
                            key={key}
                            className={`bash-permission-btn bash-permission-btn-reject ${selectedIndex === index ? 'selected' : ''}`}
                            onClick={() => {
                                setSelectedIndex(index);
                                if (key === 'cancel') {
                                    onCancel?.();
                                } else {
                                    onSubmit(key as 'startEditing' | 'clearContextAndStart');
                                }
                            }}
                        >
                            {selectedIndex === index && '❯ '}{key === 'cancel' ? '拒绝' : data.options[key]}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PlanExitDialog;
