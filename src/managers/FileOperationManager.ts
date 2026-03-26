import * as vscode from 'vscode';
import { EXCLUDED_NAMES, EXCLUDE_GLOB } from '../utils/fileExcludePatterns';

/**
 * 文件操作管理器
 * 负责处理工作区文件的搜索、打开、列表获取等操作
 */
export class FileOperationManager {
    private readonly MAX_SEARCH_FILES = 80;

    /**
     * 打开文件并跳转到指定行，如果有结束行则设置选区
     */
    public async openFileAtLine(filePath: string, line: number = 1, endLine?: number): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

            // 判断是否为绝对路径
            const isAbsolute = filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);

            let fileUri: vscode.Uri;
            if (isAbsolute) {
                fileUri = vscode.Uri.file(filePath);
            } else {
                if (!workspaceFolder) {
                    return;
                }
                fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            }

            // 打开文档并跳转到指定行
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });

            // 计算起始位置（行号从0开始，所以减1）
            const startPosition = new vscode.Position(Math.max(0, line - 1), 0);

            let selection: vscode.Selection;
            let revealRange: vscode.Range;

            if (endLine !== undefined && endLine >= line) {
                // 有结束行，设置选区：从起始行开头到结束行末尾
                const endLineIndex = Math.min(endLine - 1, document.lineCount - 1);
                const endLineText = document.lineAt(endLineIndex);
                const endPosition = new vscode.Position(endLineIndex, endLineText.text.length);
                selection = new vscode.Selection(startPosition, endPosition);
                revealRange = new vscode.Range(startPosition, endPosition);
            } else {
                // 单行，只跳转不选区
                selection = new vscode.Selection(startPosition, startPosition);
                revealRange = new vscode.Range(startPosition, startPosition);
            }

            editor.selection = selection;
            editor.revealRange(revealRange, vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            console.error('Failed to open file:', error);
            vscode.window.showErrorMessage(`无法打开文件: ${filePath}`);
        }
    }

    /**
     * 获取所有打开的文件（可见的在前）
     */
    public getOpenFiles(): { path: string; isDirectory: boolean; isOpen: boolean }[] {
        const visibleFilePaths = new Set(
            vscode.window.visibleTextEditors
                .filter(editor => editor.document.uri.scheme === 'file')
                .map(editor => vscode.workspace.asRelativePath(editor.document.uri, false))
        );

        const allTabFiles = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText)
            .map(tab => vscode.workspace.asRelativePath(
                (tab.input as vscode.TabInputText).uri,
                false
            ));

        const visibleFiles = Array.from(visibleFilePaths);
        const uniqueOtherFiles = Array.from(
            new Set(allTabFiles.filter(path => !visibleFilePaths.has(path)))
        );

        return [
            ...visibleFiles.map(path => ({ path, isDirectory: false, isOpen: true })),
            ...uniqueOtherFiles.map(path => ({ path, isDirectory: false, isOpen: true }))
        ];
    }

    /**
     * 获取工作区文件列表
     */
    public async getWorkspaceFiles(): Promise<{ path: string; isDirectory: boolean; isOpen?: boolean }[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            // 1. 获取所有打开的文件
            const openFiles = this.getOpenFiles();

            // 2. 获取工作区根目录下的文件和目录
            const rootUri = workspaceFolder.uri;
            const entries = await vscode.workspace.fs.readDirectory(rootUri);

            const rootFiles = entries
                .filter(([name]) => !EXCLUDED_NAMES.has(name))
                .map(([name, fileType]) => ({
                    path: name,
                    isDirectory: fileType === vscode.FileType.Directory,
                    isOpen: false
                }));

            // 3. 去重并排序
            const openFilePaths = new Set(openFiles.map(f => f.path));
            const uniqueRootFiles = rootFiles
                .filter(f => !openFilePaths.has(f.path))
                .sort((a, b) => a.path.localeCompare(b.path));

            // 4. 合并并返回
            return [...openFiles, ...uniqueRootFiles];
        } catch (error) {
            console.error('Failed to get workspace files:', error);
            return [];
        }
    }

    /**
     * 搜索包含指定内容的文件
     * 优先搜索已打开的文件，特别是正在编辑的文件
     */
    public async searchContentInFiles(content: string): Promise<{ path: string; startLine: number; endLine: number } | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        try {
            // 清理内容，移除首尾空白并处理换行符
            const cleanContent = content.trim();
            if (!cleanContent) {
                return null;
            }

            // 1. 首先搜索当前活动的编辑器
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.uri.scheme === 'file') {
                const result = this.searchInDocument(activeEditor.document, cleanContent);
                if (result) {
                    return result;
                }
            }

            // 2. 然后搜索所有可见的编辑器
            const visibleEditors = vscode.window.visibleTextEditors
                .filter(editor => editor.document.uri.scheme === 'file');

            for (const editor of visibleEditors) {
                if (editor === activeEditor) {
                    continue;
                }

                const result = this.searchInDocument(editor.document, cleanContent);
                if (result) {
                    return result;
                }
            }

            // 3. 搜索所有已打开的文档（在标签页中）
            const allTabFiles = vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .filter(tab => tab.input instanceof vscode.TabInputText)
                .map(tab => (tab.input as vscode.TabInputText).uri)
                .filter(uri => uri.scheme === 'file');

            const visibleUris = new Set(visibleEditors.map(e => e.document.uri.toString()));
            const uniqueTabUris = allTabFiles.filter(uri => !visibleUris.has(uri.toString()));

            for (const uri of uniqueTabUris) {
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    const result = this.searchInDocument(document, cleanContent);
                    if (result) {
                        return result;
                    }
                } catch (error) {
                    continue;
                }
            }

            return null;
        } catch (error) {
            console.error('Failed to search content in files:', error);
            return null;
        }
    }

    /**
     * 在指定文档中搜索内容
     */
    private searchInDocument(document: vscode.TextDocument, cleanContent: string): { path: string; startLine: number; endLine: number } | null {
        const text = document.getText();

        const index = text.indexOf(cleanContent);
        if (index !== -1) {
            const beforeContent = text.substring(0, index);
            const startLine = beforeContent.split('\n').length;

            const contentLines = cleanContent.split('\n').length;
            const endLine = startLine + contentLines - 1;

            const relativePath = vscode.workspace.asRelativePath(document.uri, false);

            return { path: relativePath, startLine, endLine };
        }

        return null;
    }

    /**
     * 搜索工作区文件
     */
    public async searchWorkspaceFiles(query: string): Promise<{ path: string; isDirectory: boolean; isOpen: boolean }[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            // 1. 获取所有打开的文件并过滤
            const cleanQuery = query.replace(/\/+$/, '').toLowerCase();
            const allOpenFiles = this.getOpenFiles();
            const filteredOpenFiles = allOpenFiles.filter(item =>
                item.path.toLowerCase().includes(cleanQuery)
            );

            // 2. 搜索工作区文件
            const files = await vscode.workspace.findFiles(
                `**/*${query}*`,
                EXCLUDE_GLOB,
                this.MAX_SEARCH_FILES * 2
            );

            // 3. 处理搜索结果
            const searchResults: { path: string; isDirectory: boolean; isOpen: boolean }[] = [];
            const dirSet = new Set<string>();

            for (const file of files) {
                const relativePath = vscode.workspace.asRelativePath(file, false);
                const fileName = relativePath.split('/').pop() || '';

                if (EXCLUDED_NAMES.has(fileName)) {
                    continue;
                }

                searchResults.push({
                    path: relativePath,
                    isDirectory: false,
                    isOpen: false
                });

                // 提取匹配的父目录（只添加路径中包含搜索词的目录）
                const parts = relativePath.split('/');
                for (let i = 1; i < parts.length; i++) {
                    const dirPath = parts.slice(0, i).join('/');
                    const dirName = parts[i - 1];

                    if (EXCLUDED_NAMES.has(dirName) || dirSet.has(dirPath)) {
                        continue;
                    }

                    if (dirPath.toLowerCase().includes(cleanQuery)) {
                        dirSet.add(dirPath);
                        searchResults.push({
                            path: dirPath,
                            isDirectory: true,
                            isOpen: false
                        });
                    }
                }
            }

            // 4. 去重并限制数量
            const openFilePaths = new Set(filteredOpenFiles.map(f => f.path));
            const uniqueSearchResults = searchResults
                .slice(0, this.MAX_SEARCH_FILES)
                .filter(f => !openFilePaths.has(f.path));

            // 5. 按深度和字母顺序排序
            uniqueSearchResults.sort((a, b) => {
                const depthA = (a.path.match(/\//g) || []).length;
                const depthB = (b.path.match(/\//g) || []).length;

                if (depthA !== depthB) {
                    return depthA - depthB;
                }

                return a.path.localeCompare(b.path);
            });

            // 6. 合并并返回
            return [...filteredOpenFiles, ...uniqueSearchResults];
        } catch (error) {
            console.error('Failed to search workspace files:', error);
            return [];
        }
    }

    /**
     * 将 Bash 输出内容以虚拟文档形式在编辑器中打开
     */
    public async openBashOutputAsDocument(content: string, command: string): Promise<void> {
        const docContent = command ? `# ${command}\n\n${content}` : content;
        const document = await vscode.workspace.openTextDocument({
            content: docContent,
            language: 'shellscript'
        });
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.One
        });
    }

    /**
     * 验证文件路径是否存在
     */
    public async verifyFilePath(filePath: string): Promise<boolean> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

            const isAbsolute = filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);

            let fileUri: vscode.Uri;
            if (isAbsolute) {
                fileUri = vscode.Uri.file(filePath);
            } else {
                if (!workspaceFolder) {
                    return false;
                }
                fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            }

            const stat = await vscode.workspace.fs.stat(fileUri);
            return stat.type === vscode.FileType.File;
        } catch {
            return false;
        }
    }
}
