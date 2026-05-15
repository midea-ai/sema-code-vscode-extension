import React, { useEffect } from 'react';
import FileIcon from '../../ui/FileIcon';
import { FileItem } from '../../../types';

interface FilePickerProps {
    show: boolean;
    availableFiles: FileItem[];
    selectedIndex: number;
    onFileSelect: (fileItem: FileItem) => void;
    filePickerRef: React.RefObject<HTMLDivElement>;
    showDividers?: boolean;
}

const FilePicker: React.FC<FilePickerProps> = ({
    show,
    availableFiles,
    selectedIndex,
    onFileSelect,
    filePickerRef,
    showDividers = false
}) => {
    useEffect(() => {
        if (!show || !filePickerRef.current) return;
        const selectedEl = filePickerRef.current.querySelector<HTMLElement>('.shortcut-panel-item.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }, [show, selectedIndex, filePickerRef]);

    if (!show) return null;

    const isOutsideProject = (f: FileItem) => {
        const p = f.path;
        return p.startsWith('/') || p.startsWith('~') || /^[a-zA-Z]:[\\/]/.test(p);
    };

    return (
        <div className="shortcut-panel-popup" ref={filePickerRef}>
            {availableFiles.length > 0 ? (
                availableFiles.map((fileItem, index) => {
                    // 仅在 showDividers 时计算分隔线：项目内已打开→项目内未打开、项目内→项目外
                    const prevItem = index > 0 ? availableFiles[index - 1] : null;
                    const curOutside = isOutsideProject(fileItem);
                    const prevOutside = prevItem ? isOutsideProject(prevItem) : false;
                    const needsDivider = showDividers && !!prevItem && (
                        (!curOutside && prevItem.isOpen && !fileItem.isOpen) ||
                        (!prevOutside && curOutside)
                    );
                    const isSelected = index === selectedIndex;

                    const fileName = fileItem.path.split('/').pop() || fileItem.path;
                    // 目录：直接展示完整路径作为名称，不再单独展示路径
                    // 文件：路径仅展示父目录（去掉结尾文件名）；若与文件名一致则隐藏
                    const displayName = fileItem.isDirectory ? fileItem.path : fileName;
                    const lastSlashIdx = fileItem.path.lastIndexOf('/');
                    const parentPath = lastSlashIdx >= 0 ? fileItem.path.substring(0, lastSlashIdx) : '';
                    const showPath = !fileItem.isDirectory && parentPath.length > 0;

                    return (
                        <React.Fragment key={fileItem.path}>
                            {needsDivider && <div className="shortcut-panel-divider"></div>}
                            <div
                                className={`shortcut-panel-item file-picker-item ${fileItem.isOpen ? 'file-open' : ''} ${isSelected ? 'selected' : ''}`}
                                onClick={() => onFileSelect(fileItem)}
                                title={fileItem.path}
                            >
                                <span className="file-icon">
                                    <FileIcon
                                        fileName={fileName}
                                        isDirectory={fileItem.isDirectory}
                                        size={18}
                                    />
                                </span>
                                <div className="file-info">
                                    <span className="file-name shortcut-command">
                                        {displayName}
                                    </span>
                                    {showPath && (
                                        <span className="file-full-path shortcut-desc">
                                            {parentPath}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })
            ) : (
                <div className="file-picker-empty">
                    工作区中没有文件
                </div>
            )}
        </div>
    );
};

export default FilePicker;
