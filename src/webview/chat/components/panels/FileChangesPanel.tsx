import React, { useState, useEffect } from 'react';
import { VscodeApi, FileChange } from '../../types';
import { ToggleIcon, CancelCircleIcon } from '../ui/IconButton';
import { FileLabel } from '../../utils/fileRefDisplay';
import { hasTextSelection } from '../../utils/selection';
import { baseName, displayPath } from '../../utils/pathDisplay';
import { useT } from '../../../common/i18n/react';

interface FileChangesPanelProps {
    changes: FileChange[];
    vscode: VscodeApi;
    onScrollToBottom?: () => void;
}

/** 不可文本比较时的状态文案；可比较但只是编码/换行变了时给「格式变化」 */
const statusKey = (change: FileChange) => {
    if (change.status === 'binary') return 'chat.fileChanges.status.binary' as const;
    if (change.status === 'tooLarge') return 'chat.fileChanges.status.tooLarge' as const;
    if (change.status === 'baselineUnavailable') return 'chat.fileChanges.status.baselineUnavailable' as const;
    if (change.status === 'currentUnreadable') return 'chat.fileChanges.status.currentUnreadable' as const;
    if (change.rawChanged) return 'chat.fileChanges.formatChanged' as const;
    return null;
};

/**
 * 文件变更面板：条目来自宿主下发的 core 会话基线清单（已按绝对路径去重、已过滤无差异项），
 * 这里只负责展示与转发「打开 diff / 放弃修改」，不再自己统计或保存快照。
 */
const FileChangesPanel: React.FC<FileChangesPanelProps> = ({ changes, vscode, onScrollToBottom }) => {
    const t = useT();
    const [isExpanded, setIsExpanded] = useState(true);

    useEffect(() => {
        if (isExpanded && onScrollToBottom) {
            const timer = setTimeout(onScrollToBottom, 50);
            return () => clearTimeout(timer);
        }
    }, [changes.length]);

    if (changes.length === 0) {
        return null;
    }

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    // 不带行号：diff 打开后的首个变更定位由宿主 / 编辑器自带行为决定
    const handleFileClick = (change: FileChange) => {
        if (hasTextSelection()) {
            return;
        }
        vscode.postMessage({
            type: 'showFileDiff',
            filePath: change.filePath
        });
    };

    const handleDiscardAll = () => {
        vscode.postMessage({
            type: 'restoreFromSnapshots',
            filePaths: changes.map(change => change.filePath)
        });
    };

    return (
        <div className="file-changes-panel">
            <div className="file-changes-header">
                <div className="file-changes-header-left" onClick={handleToggle}>
                    <ToggleIcon isExpanded={isExpanded} />
                    <span className="file-changes-title">{changes.length} Files</span>
                </div>
                <div className="file-changes-header-right">
                    <button
                        className="file-changes-action-btn discard-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDiscardAll();
                        }}
                        title={t('chat.fileChanges.discardAll')}
                    >
                        <CancelCircleIcon />
                        {t('chat.fileChanges.discardAll')}
                    </button>
                </div>
            </div>
            {isExpanded && (
                <div className="file-changes-content">
                    {changes.map((change, index) => {
                        const label = baseName(change.displayPath);
                        const shownPath = displayPath(change.displayPath);
                        // 目录只保留目录部分（去掉结尾重复的文件名）；目录为空则不显示
                        const dir = shownPath.endsWith(label)
                            ? shownPath.slice(0, -label.length)
                            : shownPath;
                        const status = statusKey(change);
                        const showStats = change.status === 'ok' && !status
                            && ((change.additions ?? 0) > 0 || (change.removals ?? 0) > 0);
                        return (
                            <div
                                key={`${change.filePath}:${index}`}
                                className="file-change-item"
                                onClick={() => handleFileClick(change)}
                            >
                                <div className="file-change-left">
                                    {/* 统一的文件高亮外形（plain：正常字重，颜色与最大宽度由 .file-change-name 给） */}
                                    <FileLabel path={label} label={label} plain className="file-change-name" />
                                    {dir ? (
                                        <span
                                            className="file-change-fullpath"
                                            title={change.displayPath}
                                        >
                                            {/* 首尾包裹 LRM 锚定为 LTR，避免 direction:rtl 下路径首/尾的 "/" 被 bidi 移位 */}
                                            {'‎' + dir + '‎'}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="file-change-right">
                                    {status ? (
                                        <span className="file-change-status" title={t(status)}>{t(status)}</span>
                                    ) : showStats ? (
                                        <div className="file-change-stats">
                                            {(change.additions ?? 0) > 0 && (
                                                <span className="additions">+{change.additions}</span>
                                            )}
                                            {(change.removals ?? 0) > 0 && (
                                                <span className="removals">-{change.removals}</span>
                                            )}
                                        </div>
                                    ) : null}
                                    <span
                                        className="file-change-discard-btn"
                                        title={t('chat.fileChanges.discardFile')}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            vscode.postMessage({
                                                type: 'restoreFromSnapshot',
                                                filePath: change.filePath
                                            });
                                        }}
                                    >
                                        <CancelCircleIcon />
                                        {t('chat.fileChanges.discard')}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default FileChangesPanel;
