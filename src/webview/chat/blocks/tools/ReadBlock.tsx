import React from 'react';
import { VscodeApi } from '../../types';
import { ToolContent } from '../../types';
import { hasTextSelection } from '../../utils/selection';
import { FileTextIcon } from '../../components/ui/IconButton';
import ToolRowHeader from './ToolRowHeader';
import { useT } from '../../../common/i18n/react';

interface ReadBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
}

const ReadBlock: React.FC<ReadBlockProps> = React.memo(({ content, vscode }) => {
    const t = useT();
    const title = content.title || '';

    const getFileInfo = () => {
        let extractedFileName = title;
        let offset: number | null = null;
        let limit: number | null = null;

        // 匹配 "文件路径:起始行-结束行" 格式
        const rangeMatch = title.match(/^(.+):(\d+)-(\d+)$/);
        if (rangeMatch) {
            extractedFileName = rangeMatch[1];
            const startLine = parseInt(rangeMatch[2]);
            const endLine = parseInt(rangeMatch[3]);
            offset = startLine;
            limit = endLine - startLine;
        } else {
            // 匹配 "文件路径:行号" 格式
            const lineMatch = title.match(/^(.+):(\d+)$/);
            if (lineMatch) {
                extractedFileName = lineMatch[1];
                offset = parseInt(lineMatch[2]);
            }
        }

        return { fileName: extractedFileName, offset, limit };
    };

    const { fileName: finalFileName, offset, limit } = getFileInfo();

    if (!finalFileName) {
        return null;
    }

    const displayFileName = finalFileName.split('/').pop() || finalFileName;

    const handleOpenFile = () => {
        if (hasTextSelection()) {
            return;
        }
        if (finalFileName) {
            const lineNumber = offset !== null ? offset + 1 : 1;
            vscode.postMessage({
                type: 'openFile',
                filePath: finalFileName, 
                line: lineNumber
            });
        }
    };
    
    const getLineRange = () => {
        if (offset !== null && limit !== null) {
            const endLine = offset + limit;
            return `:${offset}-${endLine}`;
        } else if (offset !== null) {
            return `:${offset}`;
        }
        return '';
    };

    const lineRange = getLineRange();

    return (
        <div className="chat-block chat-block--borderless read-block">
            <ToolRowHeader
                icon={<FileTextIcon />}
                verb={t('tool.read')}
                target={`${displayFileName}${lineRange}`}
                targetTitle={finalFileName + lineRange}
                onTargetClick={handleOpenFile}
                onClick={handleOpenFile}
            />
        </div>
    );
});

ReadBlock.displayName = 'ReadBlock';

export default ReadBlock;