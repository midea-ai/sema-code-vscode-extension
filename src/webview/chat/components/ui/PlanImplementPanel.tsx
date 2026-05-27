import React, { useState } from 'react';
import { renderMarkdownToHtml, hasMarkdownFormatting } from '../../utils/markdown';
import { ToggleIcon } from './IconButton';
import CollapsibleContent from './CollapsibleContent';
import '../../style/markdown.css';

interface PlanImplementPanelProps {
    planFilePath: string;
    planContent: string;
    vscode: any;
}

const PlanImplementPanel: React.FC<PlanImplementPanelProps> = ({
    planFilePath,
    planContent,
    vscode
}) => {
    const [isExpanded, setIsExpanded] = useState<boolean>(true);

    const handleFileNameClick = () => {
        // 点击文件名时打开文件
        vscode.postMessage({
            type: 'openFile',
            filePath: planFilePath
        });
    };

    const toggleExpanded = () => {
        setIsExpanded(prev => !prev);
    };

    // 从完整路径中提取文件名
    const fileName = planFilePath.split('/').pop() || planFilePath;

    return (
        <div className="chat-block bash-permission-block plan-implement-panel">
            <div className="plan-implement-content">
                {/* 标题区域 */}
                <div className="plan-implement-header">
                    <span className="plan-implement-header-tag">Plan</span>
                    <span className="plan-implement-title">规划文档</span>
                    <span
                        className="plan-implement-file-name"
                        onClick={handleFileNameClick}
                        title={`点击打开: ${planFilePath}`}
                    >
                        {fileName}
                    </span>
                    <button
                        className="plan-implement-toggle-btn"
                        onClick={toggleExpanded}
                        title={isExpanded ? '收起' : '展开'}
                    >
                        <ToggleIcon isExpanded={isExpanded} />
                    </button>
                </div>

                {/* 计划内容 - 可展开/收起 */}
                {isExpanded && (
                    <div className="plan-implement-plan-content">
                        <CollapsibleContent>
                            {hasMarkdownFormatting(planContent) ? (
                                <div
                                    className="markdown-content"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(planContent, vscode) }}
                                />
                            ) : (
                                <pre>{planContent}</pre>
                            )}
                        </CollapsibleContent>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PlanImplementPanel;
