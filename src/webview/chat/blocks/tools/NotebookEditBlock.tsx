import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VscodeApi, FileChange, DiffContent } from '../../types';
import { PencilIcon } from '../../components/ui/IconButton';
import { getFileIconHtml } from '../../components/ui/FileIcon';
import ToolRowHeader from './ToolRowHeader';
import { ToolContent } from '../../types';
import CollapsibleDiff from '../../components/ui/CollapsibleDiff';
import { countDiffChanges } from '../../utils/diffParser';
import { hasTextSelection } from '../../utils/selection';
import { useT } from '../../../common/i18n/react';

interface NotebookEditBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
    onFileChange?: (change: FileChange) => void;
    language?: string;
    /** 是否位于最后一轮；出现下一条用户输入后自动折叠 */
    inLastTurn?: boolean;
}

const NotebookEditBlock: React.FC<NotebookEditBlockProps> = React.memo(({
    content: toolContent,
    vscode,
    onFileChange,
    language = 'python',
    inLastTurn = true
}) => {
    const t = useT();
    const { title, summary, content } = toolContent;

    // null = 用户未手动操作过，展开状态跟随「是否位于最后一轮」；手动操作后钉住用户设的状态
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
    const isExpanded = manualExpanded ?? inLastTurn;

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

        if (typeof content === 'object' && content !== null && ((content as any).type === 'diff' || (content as any).type === 'new')) {
            diffContent = content as DiffContent;
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
        }

        // 通过 diffParser 计算增减行数
        let additions = 0;
        let removals = 0;
        if (diffContent) {
            const { addedCount, removedCount } = countDiffChanges(diffContent);
            additions = addedCount;
            removals = removedCount;
        }

        return {
            fileName,
            cellNum,
            diffContent,
            additions,
            removals,
        };
    }, [title, summary, content]);

    const { fileName, cellNum, diffContent, additions, removals } = parsedContent;

    const displayFileName = useMemo(() => {
        return fileName.split('/').pop() || fileName;
    }, [fileName]);

    // 文件类型图标（SVG 来自内置常量，可直接 innerHTML），与 EditBlock 同色同规格
    const fileIcon = useMemo(() => getFileIconHtml(displayFileName), [displayFileName]);

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
        setManualExpanded(!isExpanded);
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
        <div className="chat-block chat-block--borderless edit-block">
            {/* 行头与 EditBlock 同规格：[铅笔] 已编辑 [文件类型图标] 路径 cell:n +a -b；仅路径可点打开 diff，整行点击折叠 */}
            <ToolRowHeader
                icon={<PencilIcon />}
                verb={t('tool.edited')}
                target={(
                    <>
                        <span className="edit-file-icon" style={{ color: fileIcon.color }} dangerouslySetInnerHTML={{ __html: fileIcon.svg }} />
                        <span className="edit-file-path">{String.fromCharCode(0x200e) + fileName}</span>
                    </>
                )}
                targetTitle={fileName}
                onTargetClick={handleShowDiff}
                extra={(
                    <>
                        {/* cell:n 只作文字，不参与链接悬浮与点击 */}
                        <span className="cell-info">cell:{cellNum}</span>
                        {(additions > 0 || removals > 0) && (
                            <span className="edit-stats">
                                {additions > 0 && <span className="additions">+{additions}</span>}
                                {removals > 0 && <span className="removals">-{removals}</span>}
                            </span>
                        )}
                    </>
                )}
                expandable
                isExpanded={isExpanded}
                onClick={handleHeaderClick}
                className="edit-block-header"
                right={<div className="edit-copy-btn" onClick={(e) => { e.stopPropagation(); handleCopy(); }}>{t('common.copy')}</div>}
            />
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

NotebookEditBlock.displayName = 'NotebookEditBlock';

export default NotebookEditBlock;
