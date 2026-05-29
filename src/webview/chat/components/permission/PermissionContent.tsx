import React from 'react';
import BaseBashContent from '../ui/BaseBashContent';
import CollapsibleDiff from '../ui/CollapsibleDiff';
import CollapsibleContent from '../ui/CollapsibleContent';
import FileIcon from '../ui/FileIcon';
import { langMap } from '../../utils/fileLangTypeMap';
import { DiffContent } from '../../types';
import {
    isNotebookType,
    isMcpToolType,
    isSkillType,
    parseMcpToolName,
    stringToDiffContent
} from '../../utils/permissionUtils';
import { countDiffChanges } from '../../utils/diffParser';
import { TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_RUN_SHELL, TOOL_NAME_FETCH_URL } from '../../../../utils/tool';

interface PermissionContentProps {
    toolName: string;
    title: string;
    content: string | DiffContent;
    vscode?: any;
}

const PermissionContent: React.FC<PermissionContentProps> = ({
    toolName,
    title,
    content,
    vscode
}) => {
    // 计算增删行数
    const getDiffStats = () => {
        // 只有文件编辑/创建操作才显示 diff 统计
        if (
            toolName === TOOL_NAME_PATCH_FILE ||
            toolName === TOOL_NAME_WRITE_FILE
        ) {
            if (typeof content === 'object' && 'type' in content && 'patch' in content) {
                const { addedCount, removedCount } = countDiffChanges(content as DiffContent);
                if (addedCount > 0 || removedCount > 0) {
                    return { addedCount, removedCount };
                }
            }
        }
        return null;
    };

    const diffStats = getDiffStats();

    // 渲染 diff 统计信息
    const renderDiffStats = () => {
        if (!diffStats) return null;

        return (
            <span className="bash-permission-diff-stats">
                {diffStats.addedCount > 0 && (
                    <span className="diff-added">+{diffStats.addedCount}</span>
                )}
                {diffStats.addedCount > 0 && diffStats.removedCount > 0 && ' '}
                {diffStats.removedCount > 0 && (
                    <span className="diff-removed">-{diffStats.removedCount}</span>
                )}
            </span>
        );
    };

    // 渲染Notebook相关的内容
    const renderNotebookContent = () => {
        // 解析 title，格式如:
        // "Update Cell - example.ipynb cell:4"
        // "Create Cell - example.ipynb"
        // "Delete Cell - example.ipynb cell:4"
        // 或旧格式: "example.ipynb cell:4" (默认为 Update Cell)

        let actionLabel = 'Update Cell';
        let filePart = title;

        // 尝试提取操作类型 (Update Cell / Create Cell / Delete Cell)
        const actionMatch = title.match(/^(Update Cell|Create Cell|Delete Cell)\s*-\s*(.+)$/);
        if (actionMatch) {
            actionLabel = actionMatch[1];
            filePart = actionMatch[2];
        }

        // 解析文件路径和 cell 编号
        const cellMatch = filePart.match(/^(.*?)\s+cell:(\d+)$/);
        const filePath = cellMatch ? cellMatch[1] : filePart;
        const cellNumber = cellMatch ? cellMatch[2] : null;
        const displayFileName = filePath.split('/').pop() || filePath;
        const language = 'python';

        const diffContent = typeof content === 'string'
            ? stringToDiffContent(content)
            : content as DiffContent;

        const handleFileClick = () => {
            if (vscode && filePath) {
                vscode.postMessage({
                    type: 'showFileDiff',
                    filePath: filePath,
                    minLine: cellNumber ? parseInt(cellNumber) : 0
                });
            }
        };

        return (
            <div className="file-permission-container">
                <div className="file-permission-title-wrapper">
                    <div className="file-permission-title-divider-top" />
                    <div className="file-permission-title">
                        <strong className="file-permission-action">{actionLabel} </strong>
                        <div
                            className={`file-permission-file-left${vscode ? ' file-permission-file-left-clickable' : ''}`}
                            onClick={vscode ? handleFileClick : undefined}
                        >
                            <FileIcon fileName={displayFileName} isDirectory={false} size={18} />
                            <span className="file-permission-filename">{displayFileName}</span>
                            {cellNumber && <span className="file-permission-cell-label">cell:{cellNumber}</span>}
                        </div>
                    </div>
                    <div className="file-permission-title-divider-bottom" />
                </div>
                <CollapsibleDiff
                    diffContent={diffContent}
                    language={language}
                />
                <div className="file-permission-code-divider" />
            </div>
        );
    };

    // 渲染MCP工具内容
    const renderMcpToolContent = () => {
        const { mcpName, toolName: parsedToolName } = parseMcpToolName(toolName);
        const displayName = `${mcpName} - ${parsedToolName}${title ? `(${title})` : ''}`;

        return (
            <div className="file-permission-container">
                <div className="file-permission-title-wrapper">
                    <div className="file-permission-title-divider-top" />
                    <div className="file-permission-title">
                        <strong className="file-permission-action">Tool use</strong>
                        <div className="file-permission-file-left">
                            <span className="file-permission-filename">{displayName}</span>
                        </div>
                    </div>
                    <div className="file-permission-title-divider-bottom" />
                </div>
                <div className="mcp-tool-content">
                    <CollapsibleContent>
                        {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
                    </CollapsibleContent>
                </div>
                <div className="file-permission-code-divider" />
            </div>
        );
    };

    // 渲染Skill内容
    const renderSkillContent = () => {
        const skillName = title;

        return (
            <div className="file-permission-container">
                <div className="file-permission-title-wrapper">
                    <div className="file-permission-title-divider-top" />
                    <div className="file-permission-title">
                        <strong className="file-permission-action">Use skill</strong>
                        <div className="file-permission-file-left">
                            <span className="file-permission-filename">"{skillName}"</span>
                        </div>
                    </div>
                    <div className="file-permission-title-divider-bottom" />
                </div>
                <div className="skill-permission-info">
                    Code Agent may use instructions, code, or files from this Skill.
                </div>
                <div className="skill-permission-content">
                    <CollapsibleContent>
                        {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
                    </CollapsibleContent>
                </div>
                <div className="file-permission-code-divider" />
            </div>
        );
    };

    // 渲染常规文件内容
    const renderRegularFileContent = () => {
        const fileName = title;
        const displayFileName = fileName.split('/').pop() || fileName;

        // 检测语言类型
        let language = 'plaintext';
        if (fileName) {
            const ext = fileName.split('.').pop()?.toLowerCase();
            if (ext && langMap[ext]) {
                language = langMap[ext];
            }
        }

        const diffContent = typeof content === 'string'
            ? stringToDiffContent(content)
            : content as DiffContent;
        const isUpdate = toolName === TOOL_NAME_PATCH_FILE || (diffContent && diffContent.type === 'diff');
        const actionLabel = isUpdate ? 'Update File' : 'Create File';

        const handleFileClick = () => {
            if (vscode && fileName) {
                vscode.postMessage({
                    type: 'showPermissionDiff',
                    filePath: fileName,
                    diffContent: diffContent
                });
            }
        };

        return (
            <div className="file-permission-container">
                <div className="file-permission-title-wrapper">
                    <div className="file-permission-title-divider-top" />
                    <div
                        className={`file-permission-title${vscode ? ' file-permission-title-clickable' : ''}`}
                        onClick={vscode ? handleFileClick : undefined}
                    >
                        <strong className="file-permission-action">{actionLabel}</strong>
                        <div className="file-permission-file-left">
                            <FileIcon fileName={displayFileName} isDirectory={false} size={18} />
                            <span className="file-permission-filename">{fileName}</span>
                            {renderDiffStats()}
                        </div>
                    </div>
                    <div className="file-permission-title-divider-bottom" />
                </div>
                <CollapsibleDiff
                    diffContent={diffContent}
                    language={language}
                />
                <div className="file-permission-code-divider" />
            </div>
        );
    };

    // 渲染Bash命令内容
    const renderBashContent = () => {
        const handleBashTitleClick = () => {
            if (vscode) {
                vscode.postMessage({
                    type: 'openBashOutput',
                    content: title,
                    command: '',
                    toolId: ''
                });
            }
        };

        return (
            <div className="file-permission-container">
                <div className="file-permission-title-wrapper">
                    <div className="file-permission-title-divider-top" />
                    <div
                        className={`file-permission-title${vscode ? ' file-permission-title-clickable' : ''}`}
                        onClick={vscode ? handleBashTitleClick : undefined}
                    >
                        <strong className="file-permission-action">Shell command</strong>
                    </div>
                </div>
                <div className="bash-permission-bash-body">
                    <div className="bash-permission-bash-command">
                        <BaseBashContent command={title} onOpenFull={vscode ? handleBashTitleClick : undefined} />
                    </div>
                    <div className="bash-permission-bash-description">
                        {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
                    </div>
                </div>
            </div>
        );
    };

    // 渲染WebFetch内容
    const renderWebFetchContent = () => {
        const url = typeof title === 'string' ? title : '';

        const handleOpenUrl = () => {
            if (vscode) {
                vscode.postMessage({
                    type: 'openBashOutput',
                    content: url,
                    command: '',
                    toolId: ''
                });
            }
        };

        return (
            <div className="file-permission-container">
                <div className="file-permission-title-wrapper">
                    <div className="file-permission-title-divider-top" />
                    <div className="file-permission-title">
                        <strong className="file-permission-action">Fetch URL</strong>
                    </div>
                </div>
                <div className="bash-permission-bash-body">
                    <div className="bash-permission-bash-command">
                        <BaseBashContent command={url} onOpenFull={vscode ? handleOpenUrl : undefined} />
                    </div>
                </div>
            </div>
        );
    };

    // 根据工具类型渲染对应内容
    if (toolName === TOOL_NAME_RUN_SHELL) {
        return renderBashContent();
    } else if (toolName === TOOL_NAME_FETCH_URL) {
        return renderWebFetchContent();
    } else if (isSkillType(toolName)) {
        return renderSkillContent();
    } else if (isMcpToolType(toolName)) {
        return renderMcpToolContent();
    } else if (isNotebookType(toolName)) {
        return renderNotebookContent();
    } else if (
        toolName === TOOL_NAME_WRITE_FILE ||
        toolName === TOOL_NAME_PATCH_FILE
    ) {
        return renderRegularFileContent();
    }

    return null;
};

export default PermissionContent;
