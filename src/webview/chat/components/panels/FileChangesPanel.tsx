import React, { useState, useEffect } from 'react';
import { VscodeApi, FileChange } from '../../types';
import { CheckIcon, ToggleIcon, CancelCircleIcon } from '../ui/IconButton';
import FileIcon from '../ui/FileIcon';


interface FileChangesPanelProps {
    changes: FileChange[];
    vscode: VscodeApi;
    onDiscardAll?: () => void;
    onMarkAdopted?: () => void;
    fileStateManager?: any;
    onScrollToBottom?: () => void;
}

const FileChangesPanel: React.FC<FileChangesPanelProps> = ({ changes, vscode, onDiscardAll, onMarkAdopted, fileStateManager, onScrollToBottom }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    // 按完整路径对文件进行去重，保留最新的文件变更
    const uniqueChanges = changes.reduce((acc: FileChange[], current: FileChange) => {
        const existingIndex = acc.findIndex(item => item.fullPath === current.fullPath);
        if (existingIndex >= 0) {
            // 如果已存在相同路径的文件，用最新的替换旧的
            acc[existingIndex] = current;
        } else {
            acc.push(current);
        }
        return acc;
    }, []);

    useEffect(() => {
        if (isExpanded && onScrollToBottom) {
            const timer = setTimeout(onScrollToBottom, 50);
            return () => clearTimeout(timer);
        }
    }, [uniqueChanges.length]);

    if (uniqueChanges.length === 0) {
        return null;
    }

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    const handleFileClick = async (fullPath: string, minLine: number) => {
        // 使用vscode.postMessage直接调用后端的showFileDiff方法
        vscode.postMessage({
            type: 'showFileDiff',
            filePath: fullPath,
            minLine: minLine
        });
    };

    // 处理全部放弃按钮点击
    const handleDiscardAll = () => {
        // 收集所有要放弃的文件路径
        const filePaths = uniqueChanges.map(change => change.fullPath);

        // 调用后端方法恢复文件
       // console.log('FileChangesPanel handleDiscardAll called with file paths:', filePaths);
        vscode.postMessage({
            type: 'restoreFromSnapshots',
            filePaths: filePaths
        });

        // 调用父组件传入的回调函数（如果有）
        if (onDiscardAll) {
            onDiscardAll();
        }
    };

    return (
        <div className="file-changes-panel">
            <div className="file-changes-header">
                <div className="file-changes-header-left" onClick={handleToggle}>
                    <ToggleIcon isExpanded={isExpanded} />
                    <span className="file-changes-title">{uniqueChanges.length} Files</span>
                </div>
                <div className="file-changes-header-right">
                    <button
                        className="file-changes-action-btn discard-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDiscardAll();
                        }}
                        title="全部放弃"
                    >
                        <CancelCircleIcon />
                        全部放弃
                    </button>
                    <button
                        className="file-changes-action-btn adopted-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onMarkAdopted?.();
                        }}
                        title="已采纳"
                    >
                        <CheckIcon />
                        已采纳
                    </button>
                </div>
            </div>
            {isExpanded && (
                <div className="file-changes-content">
                    {uniqueChanges.map((change, index) => (
                        <div
                            key={index}
                            className="file-change-item"
                            onClick={() => handleFileClick(change.fullPath, change.minLine)}
                        >
                            <div className="file-change-left">
                                <FileIcon
                                    fileName={change.fileName}
                                    isDirectory={false}
                                    size={18}
                                />
                                <span className="file-change-name">
                                    {change.fileName}
                                </span>
                                <span
                                    className="file-change-fullpath"
                                    title={change.fullPath}
                                >
                                    {change.fullPath}
                                </span>
                            </div>
                            <div className="file-change-right">
                                {!change.isNotebook && (
                                    <div className="file-change-stats">
                                        {change.additions > 0 && (
                                            <span className="additions">+{change.additions}</span>
                                        )}
                                        {change.removals > 0 && (
                                            <span className="removals">-{change.removals}</span>
                                        )}
                                    </div>
                                )}
                                <span
                                    className="file-change-discard-btn"
                                    title="放弃此文件修改"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        vscode.postMessage({
                                            type: 'restoreFromSnapshot',
                                            filePath: change.fullPath
                                        });
                                    }}
                                >
                                    <CancelCircleIcon />
                                    放弃
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FileChangesPanel;

