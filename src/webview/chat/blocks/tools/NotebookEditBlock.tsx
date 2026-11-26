import React, { useState, useCallback, useMemo } from 'react';
import { VscodeApi, DiffContent } from '../../types';
import { PencilIcon } from '../../components/ui/IconButton';
import { FileLabel } from '../../utils/fileRefDisplay';
import ToolRowHeader from './ToolRowHeader';
import { ToolContent } from '../../types';
import CollapsibleDiff from '../../components/ui/CollapsibleDiff';
import { countDiffChanges } from '../../utils/diffParser';
import { hasTextSelection } from '../../utils/selection';
import { useT } from '../../../common/i18n/react';
import { displayPath } from '../../utils/pathDisplay';

interface NotebookEditBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
    language?: string;
    /** 是否位于最后一轮；出现下一条用户输入后自动折叠 */
    inLastTurn?: boolean;
}

const NotebookEditBlock: React.FC<NotebookEditBlockProps> = React.memo(({
    content: toolContent,
    vscode,
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

        // 从 title 中提取 cell 信息，title 中没有则从 summary 中提取；
        // 两处都没有时为 undefined：行头仍显示 cell:0，但不拿它去定位（避免跳到第 1 个 cell）
        let cellNum: number | undefined;
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
                // 宿主对 .ipynb 把这个值当 cell 序号用（不是文本行号）
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
            {/* 行头与 EditBlock 同规格：[铅笔] 已编辑 [文件类型图标] 路径 cell:n +a -b；仅路径可点打开 diff，整行点击折叠。
                文件图标 + 路径是统一的文件高亮外形（plain），路径开头加 LRM 配合 CSS 的 rtl 截断 */}
            <ToolRowHeader
                icon={<PencilIcon />}
                verb={t('tool.edited')}
                target={<FileLabel path={fileName} label={String.fromCharCode(0x200e) + displayPath(fileName)} plain />}
                targetTitle={fileName}
                onTargetClick={handleShowDiff}
                extra={(
                    <>
                        {/* cell:n 只作文字，不参与链接悬浮与点击 */}
                        <span className="cell-info">cell:{cellNum ?? 0}</span>
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
