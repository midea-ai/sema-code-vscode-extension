import React from 'react';
import { VscodeApi } from '../../types';
import { ToolContent } from '../../types';

interface ReadBlockProps {
    content: ToolContent;
    vscode: VscodeApi;
}

const ReadBlock: React.FC<ReadBlockProps> = React.memo(({ content, vscode }) => {
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
            <div className="chat-block-header read-block-header" onClick={handleOpenFile}>
                <div className="chat-block-title">
                    <span className="chat-block-title-label">Read</span>
                    <span className="chat-block-title-detail read-file-name" title={finalFileName + lineRange}>
                        {displayFileName}{lineRange}
                    </span>
                </div>
            </div>
        </div>
    );
});

ReadBlock.displayName = 'ReadBlock';

export default ReadBlock;