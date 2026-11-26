import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 权限 diff 数据类型
interface PermissionDiffContent {
    type: string;
    patch: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>;
    diffText: string;
}

/**
 * 文件 diff 视图管理：只负责「用左右文本打开原生 diff」与权限申请预览。
 *
 * 会话基线不再由宿主保存：基线由 core 在写盘前捕获并持久化（SemaSession.getFileChanges /
 * getFileDiff / revertFileChanges），增删统计与回滚也都由 core 完成，这里只做展示。
 */
export class FileStateDiffManager {
    // 共享 snapshot provider，避免多文件 diff 时 scheme 冲突（每文件注册同一 scheme 会导致内容错乱）。
    // 内容按 URI 常驻到扩展停用：diff 标签还开着时不能删，否则 VSCode 再取文本只会拿到空字符串。
    private sharedSnapshotProvider: MultiUriContentProvider | null = null;
    private snapshotProviderDisposable: vscode.Disposable | null = null;
    private currentProviderDisposable: vscode.Disposable | null = null;

    // permission diff provider
    private sharedPermissionDiffProvider: MultiUriContentProvider | null = null;
    private sharedPermissionDiffProviderDisposable: vscode.Disposable | null = null;

    // inline diff 配置是否已写入，避免每次打开 diff 都触发配置读写
    private _inlineDiffConfigured = false;

    constructor(
        private readonly workingDir: string,
        private readonly openFileAtLine: (filePath: string, line?: number) => Promise<void>
    ) { }

    /**
     * 按会话隔离的虚拟 URI：sessionId 作为 path 前缀（而非 scheme 后用冒号分隔）。
     * 用冒号分隔会在 URI 往返(toString)时被转义，导致 provider 键不匹配、diff 左侧读不到内容。
     */
    private namespacedUri(scheme: string, sessionId: string, fullPath: string): vscode.Uri {
        return vscode.Uri.from({ scheme, path: `/${sessionId}${fullPath}` });
    }

    private snapshotUri(sessionId: string, fullPath: string): vscode.Uri {
        return this.namespacedUri('snapshot', sessionId, fullPath);
    }

    /** 将相对路径转换为绝对路径 */
    private resolveFilePath(filePath: string): string {
        return path.isAbsolute(filePath) ? filePath : path.join(this.workingDir, filePath);
    }

    /** 打开文件并按 1-based 行定位（core 不给可比较内容时的兜底） */
    public async openFile(filePath: string, line?: number): Promise<void> {
        await this.openFileAtLine(filePath, line);
    }

    /**
     * 用 core 给的左右文本打开原生 diff；两侧内容相同时直接打开文件。
     * filePath 用 core 返回的绝对路径（避免相对路径在临时 URI 与当前文件之间不一致）。
     * revealLine 是 1-based 定位行（工具编辑块给这次编辑的锚点行，面板给 core 的首个变更行）；
     * 不给时不定位，停在文件顶部。
     */
    public async showTextDiff(sessionId: string, filePath: string, baselineText: string, currentText: string, revealLine?: number): Promise<void> {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : this.resolveFilePath(filePath);
            if (baselineText === currentText) {
                await this.openFileAtLine(filePath, revealLine);
                return;
            }
            await this.createDiffView(sessionId, fullPath, baselineText, currentText, filePath, revealLine);
        } catch (error) {
            console.error('显示diff失败:', error);
            await this.openFileAtLine(filePath, revealLine);
        }
    }

    /**
     * 打开 Jupyter Notebook 文件（按 cell 定位，文本行号对 notebook 没有意义）
     * cellIndex < 0 表示只打开文件、不选中任何 cell
     */
    public async openNotebook(filePath: string, cellIndex: number): Promise<void> {
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
     * 创建并显示 diff 视图
     * 使用共享 MultiUriContentProvider，避免多文件同时 diff 时同一 scheme 注册多次导致内容错乱
     */
    private async createDiffView(
        sessionId: string,
        fullPath: string,
        leftText: string,
        rightText: string,
        filePath: string,
        revealLine?: number
    ): Promise<void> {
        const originalUri = this.snapshotUri(sessionId, fullPath);
        // 右侧也用本次查询取到的内容：真实文件 URI 会随磁盘再次变化（或展示编辑器未保存内容），
        // 与左侧基线不是同一次比较对象；用虚拟文档保证两侧一致，要看/改真实文件从标题栏或面板点开
        const rightUri = this.namespacedUri('snapshot-current', sessionId, fullPath);

        if (!this.sharedSnapshotProvider) {
            this.sharedSnapshotProvider = new MultiUriContentProvider();
            this.snapshotProviderDisposable = vscode.workspace.registerTextDocumentContentProvider('snapshot', this.sharedSnapshotProvider);
            this.currentProviderDisposable = vscode.workspace.registerTextDocumentContentProvider('snapshot-current', this.sharedSnapshotProvider);
        }

        this.sharedSnapshotProvider.setContent(originalUri, leftText);
        this.sharedSnapshotProvider.setContent(rightUri, rightText);
        // 先把两侧文档带着内容建出来再开 diff：否则首次打开时文档可能先于内容就绪，读到空文本（空白 diff）
        await this.preloadDocuments(originalUri, rightUri);

        await this.ensureInlineDiffConfig();
        const options: vscode.TextDocumentShowOptions = {
            preview: false,
            viewColumn: vscode.ViewColumn.Active
        };
        if (revealLine) {
            const row = Math.max(0, revealLine - 1);
            options.selection = new vscode.Range(row, 0, row, 0);
        }
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            rightUri,
            path.basename(filePath),
            options
        );

        // 复用已开过的 diff 标签时 VSCode 不会再跑「定位到首个变更」，这里显式定位一次
        if (revealLine) this.revealLineInDiffEditor(rightUri, revealLine);
    }

    /** 预热虚拟文档：让文本在 diff 打开前就进入对应文档（失败不影响 vscode.diff 自行加载） */
    private async preloadDocuments(...uris: vscode.Uri[]): Promise<void> {
        for (const uri of uris) {
            try {
                await vscode.workspace.openTextDocument(uri);
            } catch {
                // 忽略：diff 打开时还会再向 provider 要一次内容
            }
        }
    }

    /**
     * 在 diff 编辑器里把右侧（新内容侧）定位到指定行（1-based）。
     * 打开瞬间编辑器对象可能还取不到，稍后重试一次。
     */
    private revealLineInDiffEditor(rightUri: vscode.Uri, line: number): void {
        const target = rightUri.toString();
        const apply = (): boolean => {
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === target);
            if (!editor) return false;
            const row = Math.max(0, Math.min(line - 1, editor.document.lineCount - 1));
            const range = new vscode.Range(row, 0, row, 0);
            editor.selection = new vscode.Selection(row, 0, row, 0);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            return true;
        };
        if (apply()) return;
        setTimeout(apply, 80);
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
     * 显示权限申请中的 diff（inline diff 视图，有语法高亮）
     * 不依赖会话基线，但虚拟 URI 按会话隔离，避免多会话对同一文件的 proposed 内容互相覆盖
     */
    public async showPermissionDiff(sessionId: string, filePath: string, diffContent: PermissionDiffContent): Promise<void> {
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

            const proposedUri = this.namespacedUri('permission-proposed', sessionId, fullPath);

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
                const emptyUri = this.namespacedUri('permission-proposed', sessionId, `/__empty__${fullPath}`);
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

    /** 清理所有资源（在扩展停用时调用；provider 的 dispose 会一并清掉已存的内容） */
    public dispose(): void {
        this.snapshotProviderDisposable?.dispose();
        this.snapshotProviderDisposable = null;
        this.currentProviderDisposable?.dispose();
        this.currentProviderDisposable = null;
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

    /** 写入内容并通知 VSCode 刷新已打开的同一 URI 文档（内容一直被保留，不做删除） */
    setContent(uri: vscode.Uri, content: string): void {
        this.contentMap.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentMap.get(uri.toString()) ?? '';
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.contentMap.clear();
    }
}
