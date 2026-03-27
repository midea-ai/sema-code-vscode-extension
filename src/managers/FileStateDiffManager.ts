import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as diff from 'diff';
import * as crypto from 'crypto';
import { EXCLUDED_EXTENSIONS } from '../utils/fileExcludePatterns';

// 权限 diff 数据类型
interface PermissionDiffContent {
    type: string;
    patch: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>;
    diffText: string;
}

// 类型定义
interface DiffViewInfo {
    originalUri: vscode.Uri;
    currentUri: vscode.Uri;
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
    private diffViewURIs: Map<string, DiffViewInfo> = new Map();

    // 共享 snapshot provider，避免多文件 diff 时 scheme 冲突（每文件注册同一 scheme 会导致内容错乱）
    private sharedSnapshotProvider: MultiUriContentProvider | null = null;
    private snapshotProviderDisposable: vscode.Disposable | null = null;

    // permission diff provider（修复 disposable 泄漏）
    private sharedPermissionDiffProvider: MultiUriContentProvider | null = null;
    private sharedPermissionDiffProviderDisposable: vscode.Disposable | null = null;

    // 单一全局 diff 视图关闭监听器，替代 per-file 监听器，减少事件触发开销
    private globalDiffViewListener: vscode.Disposable | null = null;

    // inline diff 配置是否已写入，避免每次打开 diff 都触发配置读写
    private _inlineDiffConfigured = false;

    private workingDir: string;

    // 性能配置
    private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
     * 重置快照状态（清空快照和监听器）
     */
    public async createSnapshot(): Promise<void> {
        this.cleanupAllListeners();
        this.cleanupAllDiffViews();
        this.fileSnapshots.clear();
    }

    /**
     * 懒加载：仅在首次访问时将文件加入快照
     */
    public async addFileToSnapshotIfNew(filePath: string): Promise<void> {
        const fullPath = this.resolveFilePath(filePath);
        if (this.fileSnapshots.has(fullPath)) return;

        try {
            const fileUri = vscode.Uri.file(fullPath);
            const stat = await vscode.workspace.fs.stat(fileUri);
            if (this.shouldSkipFile(fileUri, stat.size)) return;

            const content = await fs.promises.readFile(fullPath, 'utf8');
            const hash = this.generateFileHash(content);
            this.fileSnapshots.set(fullPath, { hash, size: stat.size, content });
        } catch {
            // 文件不存在（新建文件场景），跳过
        }
    }

    /**
     * 清理全局监听器
     */
    private cleanupAllListeners(): void {
        this.globalDiffViewListener?.dispose();
        this.globalDiffViewListener = null;
    }

    /**
     * 清理所有diff视图，同步清理 sharedSnapshotProvider 中的内容
     */
    private cleanupAllDiffViews(): void {
        if (this.sharedSnapshotProvider) {
            for (const diffView of this.diffViewURIs.values()) {
                this.sharedSnapshotProvider.removeContent(diffView.originalUri);
            }
        }
        this.diffViewURIs.clear();
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
     * 使用共享 MultiUriContentProvider 替代 per-file SnapshotContentProvider，
     * 避免多文件同时 diff 时同一 scheme 注册多次导致内容错乱
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

        if (!this.sharedSnapshotProvider) {
            this.sharedSnapshotProvider = new MultiUriContentProvider();
            this.snapshotProviderDisposable = vscode.workspace.registerTextDocumentContentProvider('snapshot', this.sharedSnapshotProvider);
        }

        this.sharedSnapshotProvider.setContent(originalUri, originalContent);
        this.diffViewURIs.set(fullPath, { originalUri, currentUri });

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

        this.setupGlobalDiffViewListener();
    }

    /**
     * 设置单一全局 diff 视图关闭监听器
     * 替代原来每个文件各注册一个 onDidChangeVisibleTextEditors，
     * 所有 diff 共享一个监听器，编辑器切换时只触发一次
     */
    private setupGlobalDiffViewListener(): void {
        if (this.globalDiffViewListener) return;

        this.globalDiffViewListener = vscode.window.onDidChangeVisibleTextEditors(editors => {
            const visibleUris = new Set(editors.map(e => e.document.uri.toString()));

            const toCleanup: string[] = [];
            for (const [fullPath, diffView] of this.diffViewURIs) {
                const stillOpen =
                    visibleUris.has(diffView.originalUri.toString()) ||
                    visibleUris.has(diffView.currentUri.toString());
                if (!stillOpen) {
                    toCleanup.push(fullPath);
                }
            }

            for (const fullPath of toCleanup) {
                this.cleanupDiffView(fullPath);
            }

            // 所有 diff 都关闭后，释放监听器本身
            if (this.diffViewURIs.size === 0) {
                this.globalDiffViewListener?.dispose();
                this.globalDiffViewListener = null;
            }
        });
    }

    /**
     * 确保配置为内联diff模式
     * 用 _inlineDiffConfigured 标记避免每次打开 diff 都触发一次配置读写
     */
    private async ensureInlineDiffConfig(): Promise<void> {
        if (this._inlineDiffConfigured) return;
        try {
            const config = vscode.workspace.getConfiguration('diffEditor');
            if (config.get('renderSideBySide') !== false) {
                await config.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
            }
            this._inlineDiffConfigured = true;
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
            this.sharedSnapshotProvider?.removeContent(diffView.originalUri);
            this.diffViewURIs.delete(filePath);
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
     * 显示权限申请中的 diff（inline diff 视图，有语法高亮）
     */
    public async showPermissionDiff(filePath: string, diffContent: PermissionDiffContent): Promise<void> {
        try {
            const fullPath = this.resolveFilePath(filePath);

            let currentContent: string;
            let fileExists = true;
            try {
                currentContent = await fs.promises.readFile(fullPath, 'utf8');
            } catch {
                currentContent = '';
                fileExists = false;
            }

            // 从 patch hunks 重建 proposed 内容
            let proposedContent: string | null;
            if (diffContent.type === 'new') {
                proposedContent = this.buildContentFromNewPatch(diffContent.patch);
            } else {
                proposedContent = this.applyPatchHunks(currentContent, diffContent.patch);
            }

            if (proposedContent === null || currentContent === proposedContent) {
                await this.openFileAtLine(filePath, 1);
                return;
            }

            const proposedUri = vscode.Uri.parse(`permission-proposed:${fullPath}`);

            if (!this.sharedPermissionDiffProvider) {
                this.sharedPermissionDiffProvider = new MultiUriContentProvider();
                this.sharedPermissionDiffProviderDisposable = vscode.workspace.registerTextDocumentContentProvider('permission-proposed', this.sharedPermissionDiffProvider);
            }

            this.sharedPermissionDiffProvider.setContent(proposedUri, proposedContent);

            // 文件不存在时使用虚拟空 URI 作为左侧，避免 "file not found" 错误
            let currentUri: vscode.Uri;
            if (fileExists) {
                currentUri = vscode.Uri.file(fullPath);
            } else {
                const emptyUri = vscode.Uri.parse(`permission-proposed:empty:${fullPath}`);
                this.sharedPermissionDiffProvider.setContent(emptyUri, '');
                currentUri = emptyUri;
            }

            await this.ensureInlineDiffConfig();
            const minLine = diffContent.patch?.[0]?.newStart ?? 1;
            await vscode.commands.executeCommand(
                'vscode.diff',
                currentUri,
                proposedUri,
                path.basename(filePath),
                {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Active,
                    selection: new vscode.Range(Math.max(0, minLine - 1), 0, Math.max(0, minLine - 1), 0)
                }
            );
        } catch (error) {
            console.error('显示权限diff失败:', error);
            await this.openFileAtLine(filePath, 1);
        }
    }

    /**
     * 新建文件：从 patch lines 重建文件内容
     */
    private buildContentFromNewPatch(
        patch: Array<{ lines: string[] }>
    ): string {
        return patch
            .flatMap(hunk => hunk.lines)
            .filter(line => !line.startsWith('-'))
            .map(line => line.startsWith('+') ? line.slice(1) : line)
            .join('\n');
    }

    /**
     * 将 patch hunks 应用到当前内容，返回变更后的内容；patch 无效时返回 null
     */
    private applyPatchHunks(
        currentContent: string,
        patch: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>
    ): string | null {
        const currentLines = currentContent.split('\n');
        const resultLines: string[] = [];
        let currentLineIndex = 0;

        for (const hunk of patch) {
            const hunkStart = hunk.oldStart - 1; // 转为 0-based

            if (hunkStart < currentLineIndex || hunkStart > currentLines.length) {
                return null; // patch 位置对不上，兜底打开文件
            }

            while (currentLineIndex < hunkStart) {
                resultLines.push(currentLines[currentLineIndex]);
                currentLineIndex++;
            }

            for (const line of hunk.lines) {
                if (line.startsWith('+')) {
                    resultLines.push(line.slice(1));
                } else if (line.startsWith('-')) {
                    currentLineIndex++;
                } else {
                    resultLines.push(line.startsWith(' ') ? line.slice(1) : line);
                    currentLineIndex++;
                }
            }
        }

        while (currentLineIndex < currentLines.length) {
            resultLines.push(currentLines[currentLineIndex]);
            currentLineIndex++;
        }

        return resultLines.join('\n');
    }

    /**
     * 清理所有资源（在扩展停用时调用）
     */
    public dispose(): void {
        this.cleanupAllListeners();
        this.cleanupAllDiffViews();
        this.fileSnapshots.clear();

        this.snapshotProviderDisposable?.dispose();
        this.snapshotProviderDisposable = null;
        this.sharedSnapshotProvider?.dispose();
        this.sharedSnapshotProvider = null;

        this.sharedPermissionDiffProviderDisposable?.dispose();
        this.sharedPermissionDiffProviderDisposable = null;
        this.sharedPermissionDiffProvider?.dispose();
        this.sharedPermissionDiffProvider = null;
    }
}

/**
 * 多 URI 内容提供者 - 支持按 URI 存储不同内容
 * 同时用于 snapshot scheme 和 permission-proposed scheme
 */
class MultiUriContentProvider implements vscode.TextDocumentContentProvider {
    private contentMap: Map<string, string> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    setContent(uri: vscode.Uri, content: string): void {
        this.contentMap.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    removeContent(uri: vscode.Uri): void {
        this.contentMap.delete(uri.toString());
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentMap.get(uri.toString()) ?? '';
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.contentMap.clear();
    }
}
