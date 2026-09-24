import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VscodeApi, FileChange } from '../../types';
import { PencilIcon } from '../../components/ui/IconButton';
import { getFileIconHtml } from '../../components/ui/FileIcon';
import ToolRowHeader from './ToolRowHeader';
import { ToolContent } from '../../types';
import CollapsibleDiff from '../../components/ui/CollapsibleDiff';
import { langMap } from '../../utils/fileLangTypeMap';
import { countDiffChanges } from '../../utils/diffParser';
import { TOOL_NAME_WRITE_FILE } from '../../../../utils/tool';
import { hasTextSelection } from '../../utils/selection';
import { useT } from '../../../common/i18n/react';

interface EditBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
    onFileChange?: (change: FileChange) => void;
    /** 是否位于最后一轮；出现下一条用户输入后自动折叠 */
    inLastTurn?: boolean;
}

const EditBlock: React.FC<EditBlockProps> = React.memo(({
    content: toolContent,
    vscode,
    onFileChange,
    inLastTurn = true
}) => {
    const t = useT();
    const { toolName, title, content } = toolContent;

    // null = 用户未手动操作过，展开状态跟随「是否位于最后一轮」；手动操作后钉住用户设的状态
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
    const isExpanded = manualExpanded ?? inLastTurn;

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

    // 文件类型图标（SVG 来自内置常量，可直接 innerHTML），与正文文件链接同色同规格
    const fileIcon = useMemo(() => getFileIconHtml(displayFileName), [displayFileName]);

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
        <div className="chat-block chat-block--borderless edit-block">
            {/* 行头与 Read / Shell 同规格：[铅笔] 已编辑 [文件类型图标] 路径 +n -m；路径可点打开 diff，整行点击折叠。
                路径开头加 LRM(U+200E) 强制按 LTR 排版，配合 CSS 的 direction:rtl 实现省略前段、保留文件名尾部 */}
            <ToolRowHeader
                icon={<PencilIcon />}
                verb={toolName === TOOL_NAME_WRITE_FILE ? t('tool.wrote') : t('tool.edited')}
                target={(
                    <>
                        <span className="edit-file-icon" style={{ color: fileIcon.color }} dangerouslySetInnerHTML={{ __html: fileIcon.svg }} />
                        <span className="edit-file-path">{String.fromCharCode(0x200e) + fileName}</span>
                    </>
                )}
                targetTitle={fileName}
                onTargetClick={handleShowDiff}
                extra={(additions > 0 || removals > 0) ? (
                    <span className="edit-stats">
                        {additions > 0 && <span className="additions">+{additions}</span>}
                        {removals > 0 && <span className="removals">-{removals}</span>}
                    </span>
                ) : undefined}
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

EditBlock.displayName = 'EditBlock';

export default EditBlock;