import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as diff from 'diff';
import * as crypto from 'crypto';
import { EXCLUDED_NAMES, EXCLUDE_GLOB, EXCLUDED_FILES, EXCLUDED_EXTENSIONS } from '../utils/fileExcludePatterns';

// 类型定义
interface DiffViewInfo {
    originalUri: vscode.Uri;
    currentUri: vscode.Uri;
    disposable: vscode.Disposable;
    provider: SnapshotContentProvider;
}

interface FileChangeStats {
    additions: number;
    removals: number;
    minLine: number;
}

interface FileSnapshot {
    content?: string;
    hash: string;
    size: number;
}

/**
 * 文件状态差异管理器 - 用于VS Code扩展
 * 负责管理文件快照、显示diff、恢复更改等功能
 */
export class FileStateDiffManager {
    private fileSnapshots: Map<string, FileSnapshot> = new Map();
    private activeEditorListeners: Map<string, vscode.Disposable> = new Map();
    private diffViewURIs: Map<string, DiffViewInfo> = new Map();
    private workingDir: string;

    // 性能配置
    private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    private static readonly CONCURRENT_READS = 50;

    constructor(
        workingDir: string,
        private readonly openFileAtLine: (filePath: string, line?: number) => Promise<void>
    ) {
        this.workingDir = workingDir;
    }

    /**
     * 将相对路径转换为绝对路径
     */
    private resolveFilePath(filePath: string): string {
        return path.isAbsolute(filePath) ? filePath : path.join(this.workingDir, filePath);
    }

    /**
     * 生成文件内容的hash
     */
    private generateFileHash(content: string): string {
        return crypto.createHash('md5').update(content, 'utf8').digest('hex');
    }

    /**
     * 检查文件是否应该被跳过（基于大小和类型）
     */
    private shouldSkipFile(uri: vscode.Uri, size?: number): boolean {
        const fileName = path.basename(uri.fsPath);
        const ext = path.extname(fileName).toLowerCase();

        if (EXCLUDED_EXTENSIONS.has(ext)) {
            return true;
        }

        if (size && size > FileStateDiffManager.MAX_FILE_SIZE) {
            return true;
        }

        return false;
    }

    /**
     * 批量处理文件，控制并发数量
     */
    private async processBatch<T, R>(
        items: T[],
        processor: (item: T) => Promise<R>,
        batchSize: number = FileStateDiffManager.CONCURRENT_READS
    ): Promise<R[]> {
        const results: R[] = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(processor));
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * 统一错误处理
     */
    private handleError(message: string, error: unknown): void {
        console.error(message, error);
        if (error instanceof Error) {
            console.error(`错误堆栈: ${error.stack}`);
        }
        vscode.window.showErrorMessage(message);
    }

    /**
     * 创建完整文件快照
     */
    public async createSnapshot(): Promise<void> {
        this.cleanupAllListeners();
        this.fileSnapshots.clear();

        const files = await this.getWorkspaceFiles();

        await this.processBatch(files, async (file) => {
            try {
                const stat = await vscode.workspace.fs.stat(file);

                if (this.shouldSkipFile(file, stat.size)) {
                    return;
                }

                const content = await fs.promises.readFile(file.fsPath, 'utf8');
                const hash = this.generateFileHash(content);

                const snapshot: FileSnapshot = {
                    hash,
                    size: stat.size,
                    content: stat.size <= FileStateDiffManager.MAX_FILE_SIZE ? content : undefined
                };

                this.fileSnapshots.set(file.fsPath, snapshot);
            } catch (error) {
                // 文件读取失败，跳过
            }
        });
    }

    /**
     * 清理所有活跃的监听器
     */
    private cleanupAllListeners(): void {
        for (const listener of this.activeEditorListeners.values()) {
            listener.dispose();
        }
        this.activeEditorListeners.clear();
    }

    /**
     * 清理所有diff视图
     */
    private cleanupAllDiffViews(): void {
        for (const diffView of this.diffViewURIs.values()) {
            diffView.disposable.dispose();
            diffView.provider.dispose();
        }
        this.diffViewURIs.clear();
    }

    /**
     * 获取工作区文件
     */
    private async getWorkspaceFiles(): Promise<vscode.Uri[]> {
        const files: vscode.Uri[] = [];
        const MAX_FILES = 5000;

        const workspaceUri = vscode.Uri.file(this.workingDir);
        const pattern = new vscode.RelativePattern(workspaceUri, '**/*');

        try {
            const uris = await vscode.workspace.findFiles(pattern, EXCLUDE_GLOB, MAX_FILES * 10);

            const filteredUris = uris.filter(uri => {
                const filePath = uri.path;
                const fileName = filePath.split('/').pop() || '';
                const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';

                if (EXCLUDED_FILES.has(fileName)) {
                    return false;
                }

                if (EXCLUDED_EXTENSIONS.has(ext.toLowerCase())) {
                    return false;
                }

                const pathParts = filePath.split('/');
                for (const dir of pathParts) {
                    if (EXCLUDED_NAMES.has(dir)) {
                        return false;
                    }
                }

                return true;
            });

            // 按路径深度排序
            const sortedUris = filteredUris.sort((a, b) =>
                a.path.split('/').length - b.path.split('/').length
            );

            for (const uri of sortedUris) {
                if (files.length >= MAX_FILES) {
                    break;
                }

                try {
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.type === vscode.FileType.File) {
                        files.push(uri);
                    }
                } catch (error) {
                    // 忽略无法访问的文件
                }
            }
        } catch (error) {
            console.warn(`搜索工作区文件时出错: ${this.workingDir}`, error);
        }

        return files;
    }

    /**
     * 显示文件diff，如果失败或内容未变化则打开对应文件
     */
    public async showFileDiff(filePath: string, minLine?: number): Promise<void> {
        const isIpynbFile = filePath.toLowerCase().endsWith('.ipynb');
        const defaultMinLine = isIpynbFile ? 0 : 1;
        const finalMinLine = minLine ?? defaultMinLine;

        if (isIpynbFile) {
            await this.openNotebookFile(filePath, finalMinLine);
            return;
        }

        await this.showTextFileDiff(filePath, finalMinLine);
    }

    /**
     * 打开 Jupyter Notebook 文件
     */
    private async openNotebookFile(filePath: string, cellIndex: number): Promise<void> {
        try {
            const fullPath = this.resolveFilePath(filePath);
            const notebookUri = vscode.Uri.file(fullPath);

            const notebookDocument = await vscode.workspace.openNotebookDocument(notebookUri);
            const notebookEditor = await vscode.window.showNotebookDocument(notebookDocument, {
                viewColumn: vscode.ViewColumn.Active
            });

            if (cellIndex >= 0 && cellIndex < notebookDocument.cellCount) {
                const cellRange = new vscode.NotebookRange(cellIndex, cellIndex + 1);
                notebookEditor.selection = cellRange;
                await vscode.commands.executeCommand('notebook.cell.edit');
            }
        } catch (error) {
            console.error('以Notebook方式打开文件失败:', error);
            await this.openFileAtLine(filePath, cellIndex);
        }
    }

    /**
     * 显示文本文件的 diff
     */
    private async showTextFileDiff(filePath: string, minLine: number): Promise<void> {
        try {
            const fullPath = this.resolveFilePath(filePath);
            const { originalContent, currentContent } = await this.getFileContents(fullPath, 'editor');

            if (originalContent === currentContent) {
                await this.openFileAtLine(filePath, minLine);
                return;
            }

            await this.createDiffView(fullPath, originalContent, currentContent, filePath, minLine);

        } catch (error) {
            console.error('显示diff失败:', error);
            await this.openFileAtLine(filePath, minLine);
        }
    }

    /**
     * 获取文件的原始内容（快照）和当前内容
     * @param source 'editor' 从 vscode 编辑器缓冲区读取（含未保存修改），'disk' 从磁盘读取
     */
    private async getFileContents(
        fullPath: string,
        source: 'editor' | 'disk'
    ): Promise<{ originalContent: string; currentContent: string }> {
        const snapshot = this.fileSnapshots.get(fullPath);
        const originalContent = snapshot?.content ?? '';

        let currentContent: string;
        try {
            if (source === 'disk') {
                currentContent = await fs.promises.readFile(fullPath, 'utf8');
            } else {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
                currentContent = doc.getText();
            }
        } catch {
            currentContent = '';
        }

        return { originalContent, currentContent };
    }

    /**
     * 创建并显示 diff 视图
     */
    private async createDiffView(
        fullPath: string,
        originalContent: string,
        currentContent: string,
        filePath: string,
        minLine: number
    ): Promise<void> {
        const currentUri = vscode.Uri.file(fullPath);
        const originalUri = vscode.Uri.parse(`snapshot:${fullPath}`);

        const existingDiffView = this.diffViewURIs.get(fullPath);
        let provider: SnapshotContentProvider;
        let disposable: vscode.Disposable;

        if (existingDiffView) {
            provider = existingDiffView.provider;
            provider.updateContent(originalContent, originalUri);
            disposable = existingDiffView.disposable;
        } else {
            provider = new SnapshotContentProvider(originalContent);
            disposable = vscode.workspace.registerTextDocumentContentProvider('snapshot', provider);
        }

        this.diffViewURIs.set(fullPath, { originalUri, currentUri, disposable, provider });

        await this.ensureInlineDiffConfig();
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            currentUri,
            path.basename(filePath),
            {
                preview: false,
                viewColumn: vscode.ViewColumn.Active,
                selection: new vscode.Range(minLine - 1, 0, minLine - 1, 0)
            }
        );

        this.setupDiffViewListener(fullPath, originalUri, currentUri);
    }

    /**
     * 设置 diff 视图的关闭监听器
     */
    private setupDiffViewListener(fullPath: string, originalUri: vscode.Uri, currentUri: vscode.Uri): void {
        const existingListener = this.activeEditorListeners.get(fullPath);
        if (existingListener) {
            existingListener.dispose();
        }

        const disposableListener = vscode.window.onDidChangeVisibleTextEditors(editors => {
            const diffStillOpen = editors.some(editor =>
                editor.document.uri.toString() === originalUri.toString() ||
                editor.document.uri.toString() === currentUri.toString()
            );

            if (!diffStillOpen) {
                this.cleanupDiffView(fullPath);
                disposableListener.dispose();
                this.activeEditorListeners.delete(fullPath);
            }
        });

        this.activeEditorListeners.set(fullPath, disposableListener);
    }

    /**
     * 确保配置为内联diff模式
     */
    private async ensureInlineDiffConfig(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('diffEditor');
            if (config.get('renderSideBySide') !== false) {
                await config.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
            }
        } catch (error) {
            console.warn(`[FileStateDiffManager] 设置diff配置失败:`, error);
        }
    }

    /**
     * 清理diff视图相关资源
     */
    private cleanupDiffView(filePath: string): void {
        const diffView = this.diffViewURIs.get(filePath);
        if (diffView) {
            diffView.disposable.dispose();
            diffView.provider.dispose();
            this.diffViewURIs.delete(filePath);
        }

        const listener = this.activeEditorListeners.get(filePath);
        if (listener) {
            listener.dispose();
            this.activeEditorListeners.delete(filePath);
        }
    }

    /**
     * 放弃指定更改，恢复到快照状态
     */
    public async revertAllChanges(filePaths?: string[]): Promise<void> {
        if (this.fileSnapshots.size === 0 && (!filePaths || filePaths.length === 0)) {
            vscode.window.showWarningMessage('没有可恢复的快照');
            return;
        }

        const { filesToRevert, filesToDelete } = await this.prepareRevertFiles(filePaths);

        if (filesToRevert.size === 0 && filesToDelete.length === 0) {
            vscode.window.showWarningMessage('没有找到匹配的文件或快照');
            return;
        }

        const results = await this.executeRevert(filesToRevert, filesToDelete);
        this.showRevertResults(results);
    }

    /**
     * 准备要恢复和删除的文件列表
     */
    private async prepareRevertFiles(filePaths?: string[]): Promise<{
        filesToRevert: Map<string, string>;
        filesToDelete: string[];
    }> {
        const filesToRevert = new Map<string, string>();
        const filesToDelete: string[] = [];

        if (filePaths && filePaths.length > 0) {
            for (const targetPath of filePaths) {
                const fullPath = this.resolveFilePath(targetPath);
                const snapshot = this.fileSnapshots.get(fullPath);

                if (snapshot?.content) {
                    filesToRevert.set(fullPath, snapshot.content);
                } else {
                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                        filesToDelete.push(fullPath);
                    } catch (error) {
                        console.warn(`找不到文件或其快照: ${targetPath}`);
                    }
                }
            }
        } else {
            for (const [snapPath, snapshot] of this.fileSnapshots) {
                if (snapshot.content) {
                    filesToRevert.set(snapPath, snapshot.content);
                }
            }
        }

        return { filesToRevert, filesToDelete };
    }

    /**
     * 执行文件恢复操作
     */
    private async executeRevert(
        filesToRevert: Map<string, string>,
        filesToDelete: string[]
    ): Promise<{ successCount: number; errorCount: number }> {
        let successCount = 0;
        let errorCount = 0;

        for (const [filePath, content] of filesToRevert) {
            try {
                await fs.promises.writeFile(filePath, content, 'utf8');
                this.cleanupDiffView(filePath);
                successCount++;
            } catch (error) {
                this.handleError(`恢复文件失败: ${filePath}`, error);
                errorCount++;
            }
        }

        for (const filePath of filesToDelete) {
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
                this.cleanupDiffView(filePath);
                successCount++;
            } catch (error) {
                this.handleError(`删除文件失败: ${filePath}`, error);
                errorCount++;
            }
        }

        return { successCount, errorCount };
    }

    /**
     * 显示恢复操作的结果
     */
    private showRevertResults(results: { successCount: number; errorCount: number }): void {
        const { successCount, errorCount } = results;

        if (errorCount > 0) {
            vscode.window.showErrorMessage(`处理了 ${successCount} 个文件，${errorCount} 个文件操作失败`);
        } else {
            vscode.window.showInformationMessage(`成功处理 ${successCount} 个文件`);
        }
    }

    /**
     * 获取文件变更统计信息
     */
    public async getFileChangeStats(filePath: string): Promise<FileChangeStats> {
        const isIpynbFile = filePath.toLowerCase().endsWith('.ipynb');
        const defaultMinLine = isIpynbFile ? 0 : 1;

        try {
            const fullPath = this.resolveFilePath(filePath);
            const { originalContent, currentContent } = await this.getFileContents(fullPath, 'disk');

            if (originalContent === currentContent) {
                return { additions: 0, removals: 0, minLine: defaultMinLine };
            }

            return this.calculateDiffStats(originalContent, currentContent, defaultMinLine);
        } catch (error) {
            this.handleError(`获取文件变更统计失败: ${filePath}`, error);
            return { additions: 0, removals: 0, minLine: defaultMinLine };
        }
    }

    /**
     * 计算差异统计信息
     */
    private calculateDiffStats(originalContent: string, currentContent: string, defaultMinLine: number): FileChangeStats {
        try {
            const diffResult = diff.diffLines(originalContent, currentContent);
            let additions = 0;
            let removals = 0;
            let minLine = Number.MAX_SAFE_INTEGER;
            let currentLineNum = 1;

            diffResult.forEach((part) => {
                const count = part.count || 0;

                if (part.added) {
                    additions += count;
                    if (currentLineNum < minLine) {
                        minLine = currentLineNum;
                    }
                    currentLineNum += count;
                } else if (part.removed) {
                    removals += count;
                    if (currentLineNum < minLine) {
                        minLine = currentLineNum;
                    }
                } else {
                    currentLineNum += count;
                }
            });

            return {
                additions,
                removals,
                minLine: minLine === Number.MAX_SAFE_INTEGER ? defaultMinLine : minLine
            };
        } catch (error) {
            console.error('Diff 计算失败:', error);
            return { additions: 0, removals: 0, minLine: defaultMinLine };
        }
    }

    /**
     * 清理所有资源（在扩展停用时调用）
     */
    public dispose(): void {
        this.cleanupAllListeners();
        this.cleanupAllDiffViews();
        this.fileSnapshots.clear();
    }
}

/**
 * 快照内容提供者 - 用于在diff视图中显示快照内容
 */
class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
    private content: string;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(content: string) {
        this.content = content;
    }

    updateContent(content: string, uri: vscode.Uri): void {
        this.content = content;
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(_uri: vscode.Uri): string {
        return this.content;
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
