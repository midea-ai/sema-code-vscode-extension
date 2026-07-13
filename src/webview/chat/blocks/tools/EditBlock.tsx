import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VscodeApi, FileChange } from '../../types';
import { ToggleIcon } from '../../components/ui/IconButton';
import FileIcon from '../../components/ui/FileIcon';
import { ToolContent } from '../../types';
import CollapsibleDiff from '../../components/ui/CollapsibleDiff';
import { langMap } from '../../utils/fileLangTypeMap';
import { countDiffChanges } from '../../utils/diffParser';
import { TOOL_NAME_WRITE_FILE } from '../../../../utils/tool';
import { hasTextSelection } from '../../utils/selection';

interface EditBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
    onFileChange?: (change: FileChange) => void;
}

const EditBlock: React.FC<EditBlockProps> = React.memo(({
    content: toolContent,
    vscode,
    onFileChange
}) => {
    const { toolName, title, content } = toolContent;

    const [isExpanded, setIsExpanded] = useState(true);

    const parsedContent = useMemo(() => {
        let fileName = title || '';
        let diffContent: any = null;
        let minLine = 1;

        if (typeof content === 'object' && content !== null && ((content as any).type === 'diff' || (content as any).type === 'new')) {
            diffContent = content;

            if (diffContent.patch && diffContent.patch.length > 0) {
                minLine = diffContent.patch[0].oldStart || 1;
            }
        }

        // 通过 diffParser 计算增减行数
        let additions = 0;
        let removals = 0;
        if (diffContent) {
            const { addedCount, removedCount } = countDiffChanges(diffContent);
            additions = addedCount;
            removals = removedCount;
        }

        // 检测语言类型
        let language = 'plaintext';
        if (fileName) {
            const ext = fileName.split('.').pop()?.toLowerCase();
            if (ext && langMap[ext]) {
                language = langMap[ext];
            }
        }

        return {
            fileName,
            additions,
            removals,
            diffContent,
            language,
            minLine
        };
    }, [title, content]);

    const { fileName, additions, removals, diffContent, language, minLine } = parsedContent;

    const displayFileName = useMemo(() => {
        return fileName.split('/').pop() || fileName;
    }, [fileName]);

    const reportFileChange = useCallback(() => {
        if (onFileChange && fileName) {
            onFileChange({
                fileName: displayFileName,
                fullPath: fileName,
                type: toolName === TOOL_NAME_WRITE_FILE ? 'write' : 'edit',
                isNotebook: false,
                additions: additions,
                removals: removals,
                minLine: minLine
            });
        }
    }, [onFileChange, fileName, displayFileName, toolName, additions, removals, minLine]);

    useEffect(() => {
        reportFileChange();
    }, [reportFileChange]);

    const handleCopy = useCallback(() => {
        if (!diffContent) return;

        // 从 patch 中提取新内容（添加行和上下文行）
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
                minLine: minLine
            });
        }
    }, [fileName, minLine, vscode]);

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
                <div className="edit-title-left" onClick={(e) => { e.stopPropagation(); handleShowDiff(e); }}>
                    <FileIcon
                        fileName={displayFileName}
                        isDirectory={false}
                        size={18}
                    />
                    {/* 开头加 LRM(U+200E) 强制文件名整体按 LTR 排版，避免 direction:rtl 把开头的 "." 排到末尾；title 仍用真实路径 */}
                    <span className="file-name" title={fileName}>{String.fromCharCode(0x200e) + fileName}</span>
                    <span className="edit-stats">
                        {additions > 0 && <span className="additions">+{additions}</span>}
                        {removals > 0 && <span className="removals">-{removals}</span>}
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
                <div className="chat-block-content edit-block-content" onClick={handleShowDiff}>
                    <CollapsibleDiff
                        diffContent={diffContent}
                        language={language}
                    />
                </div>
            )}
        </div>
    );
});

EditBlock.displayName = 'EditBlock';

export default EditBlock;