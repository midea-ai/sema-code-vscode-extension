import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VscodeApi, FileChange, DiffContent } from '../../types';
import { ToggleIcon } from '../../components/ui/IconButton';
import FileIcon from '../../components/ui/FileIcon';
import { ToolContent } from '../../types';
import UpdateCodeDiff from '../../components/ui/UpdateCodeDiff';
import { hasTextSelection } from '../../utils/selection';

interface NotebookEditBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
    onFileChange?: (change: FileChange) => void;
    language?: string;
}

const NotebookEditBlock: React.FC<NotebookEditBlockProps> = React.memo(({
    content: toolContent,
    vscode,
    onFileChange,
    language = 'python'
}) => {
    const { title, summary, content } = toolContent;

    const [isExpanded, setIsExpanded] = useState(true);

    const parsedContent = useMemo(() => {
        // 解析 title，格式可能是 "example.ipynb cell:4" 或纯文件名 "example.ipynb"
        const titleCellMatch = (title || '').match(/^(.*?)\s+cell:(\d+)$/);
        const fileName = titleCellMatch ? titleCellMatch[1] : (title || '');

        // 从 title 中提取 cell 信息，title 中没有则从 summary 中提取
        let cellNum = 0;
        if (titleCellMatch) {
            cellNum = parseInt(titleCellMatch[2]);
        } else {
            const summaryCellMatch = (summary || '').match(/cell[:\s]+(\d+)/);
            if (summaryCellMatch) {
                cellNum = parseInt(summaryCellMatch[1]);
            }
        }

        // 解析 diff 内容
        let diffContent: DiffContent | null = null;
        let isNewFile = false;

        if (typeof content === 'object' && content !== null && ((content as any).type === 'diff' || (content as any).type === 'new')) {
            diffContent = content as DiffContent;
            isNewFile = (content as any).type === 'new';
        } else if (typeof content === 'string' && content.trim()) {
            // content 是字符串时（cell 原始内容），转换为 new 类型的 diff 格式
            const contentLines = content.split('\n');
            diffContent = {
                type: 'new',
                patch: [{
                    oldStart: 0,
                    oldLines: 0,
                    newStart: 1,
                    newLines: contentLines.length,
                    lines: contentLines.map(line => '+' + line)
                }],
                diffText: ''
            };
            isNewFile = true;
        }

        return {
            fileName,
            cellNum,
            diffContent,
            isNewFile,
        };
    }, [title, summary, content]);

    const { fileName, cellNum, diffContent, isNewFile } = parsedContent;

    const displayFileName = fileName;

    const reportFileChange = useCallback(() => {
        if (onFileChange && fileName) {
            onFileChange({
                fileName: displayFileName,
                fullPath: fileName,
                type: 'edit',
                isNotebook: true,
                additions: cellNum,
                removals: 0,
                minLine: cellNum
            });
        }
    }, [onFileChange, fileName, displayFileName, cellNum]);

    useEffect(() => {
        reportFileChange();
    }, [reportFileChange]);

    const handleCopy = useCallback(() => {
        if (!diffContent) return;

        const lines: string[] = [];
        for (const hunk of diffContent.patch) {
            for (const line of hunk.lines) {
                const marker = line[0];
                const lineContent = line.substring(1);
                if (marker !== '-') {
                    lines.push(lineContent);
                }
            }
        }
        navigator.clipboard.writeText(lines.join('\n'));
    }, [diffContent]);

    const handleToggle = useCallback(() => {
        setIsExpanded(!isExpanded);
    }, [isExpanded]);

    const handleShowDiff = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (hasTextSelection()) {
            return;
        }
        if (fileName) {
            vscode.postMessage({
                type: 'showFileDiff',
                filePath: fileName,
                minLine: cellNum
            });
        }
    }, [fileName, cellNum, vscode]);

    const handleHeaderClick = useCallback(() => {
        // 拖拽选中标题文本时不折叠/展开
        if (hasTextSelection()) {
            return;
        }
        handleToggle();
    }, [handleToggle]);

    if (!fileName || !diffContent) {
        return null;
    }

    return (
        <div className="chat-block edit-block">
            <div className="chat-block-header edit-block-header" onClick={handleHeaderClick}>
                <div className="edit-title-left" onClick={handleShowDiff}>
                    <FileIcon
                        fileName={displayFileName}
                        isDirectory={false}
                        size={18}
                    />
                    <span className="file-name">{displayFileName}</span>
                    <span className="edit-stats">
                        {cellNum >= 0 && (
                            <span className="cell-info">cell:{cellNum}</span>
                        )}
                    </span>
                </div>
                <div className="edit-toggle-btn">
                    <ToggleIcon isExpanded={isExpanded} />
                </div>
                <div className="edit-spacer"></div>
                <div className="edit-copy-btn" onClick={(e) => { e.stopPropagation(); handleCopy(); }}>
                    复制
                </div>
            </div>
            {isExpanded && (
                <div className={`chat-block-content edit-block-content ${isNewFile ? 'new-file' : ''}`}>
                    <UpdateCodeDiff diffContent={diffContent} language={language} />
                </div>
            )}
        </div>
    );
});

NotebookEditBlock.displayName = 'NotebookEditBlock';

export default NotebookEditBlock;
