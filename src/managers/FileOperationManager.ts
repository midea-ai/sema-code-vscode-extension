import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { EXCLUDED_NAMES, EXCLUDE_GLOB, NON_TEXT_EXTENSIONS } from '../utils/fileExcludePatterns';
import { scoreItem, compareScored } from '../utils/fileScoring';

const execFileAsync = promisify(execFile);

class BashOutputProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'sema-bash-output';

    private _contentMap = new Map<string, string>();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    static uriForId(toolId: string): vscode.Uri {
        return vscode.Uri.parse(`${BashOutputProvider.scheme}://output/${encodeURIComponent(toolId)}`);
    }

    update(uri: vscode.Uri, content: string): void {
        this._contentMap.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this._contentMap.get(uri.toString()) ?? '';
    }
}

/**
 * 文件操作管理器
 * 负责处理工作区文件的搜索、打开、列表获取等操作
 */
export class FileOperationManager {
    private readonly bashOutputProvider: BashOutputProvider;

    constructor() {
        this.bashOutputProvider = new BashOutputProvider();
        vscode.workspace.registerTextDocumentContentProvider(
            BashOutputProvider.scheme,
            this.bashOutputProvider
        );
    }

    private isTextFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return !NON_TEXT_EXTENSIONS.has(ext);
    }

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

            // 文件不存在时静默退出，避免误点不存在的路径弹错误
            try {
                await vscode.workspace.fs.stat(fileUri);
            } catch {
                return;
            }

            // 二进制/图片等非文本文件无法用 openTextDocument 打开，交给 VS Code 默认查看器
            if (!this.isTextFile(filePath)) {
                await vscode.commands.executeCommand('vscode.open', fileUri);
                return;
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
     * 搜索工作区文件 —— 带过滤值的检索
     * 命中条件：
     *   - basename 含 query / basename 驼峰子序列
     *   - 任意祖先目录名含 query（其本身、其下所有子目录、所有后代文件都纳入）
     * 排序：见 fileScoring.ts 的 bucket 设计
     */
    public async searchWorkspaceFiles(query: string): Promise<{ path: string; isDirectory: boolean; isOpen: boolean }[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const rawQuery = query.replace(/\/+$/, '');
        const cleanQuery = rawQuery.toLowerCase();
        if (!cleanQuery) {
            return [];
        }

        // VSCode glob 不支持 \ 转义，直接剥除元字符以避免语义偏移
        const globSafe = cleanQuery.replace(/[*?{}[\]]/g, '');
        if (!globSafe) {
            return [];
        }

        const MAX_RESULTS = 100;
        // 单次 findFiles 的硬上限：留余量给评分排序，最终仍按 MAX_RESULTS 截断
        const FIND_LIMIT = 2000;

        try {
            // 1. 已打开文件按路径包含过滤；搜索态下排除项目外文件（绝对路径）
            //    用作 isOpen 标记来源，不再独立置顶——排序统一交给评分管道
            const isOutsideProject = (p: string) =>
                p.startsWith('/') || p.startsWith('~') || /^[a-zA-Z]:[\\/]/.test(p);
            const allOpenFiles = this.getOpenFiles();
            const openHits = allOpenFiles.filter(item =>
                item.path.toLowerCase().includes(cleanQuery) && !isOutsideProject(item.path)
            );
            const openPathSet = new Set(openHits.map(f => f.path));

            // 2. 两路 glob 并行：
            //    A. basename 含 query 的文件（高优先级，bucket 0-4）
            //    B. 祖先目录名含 query 的所有后代文件（用作 bucket 5 文件 + 反推目录条目）
            const [fileMatches, descendantMatches] = await Promise.all([
                vscode.workspace.findFiles(`**/*${globSafe}*`, EXCLUDE_GLOB, FIND_LIMIT),
                vscode.workspace.findFiles(`**/*${globSafe}*/**`, EXCLUDE_GLOB, FIND_LIMIT)
            ]);

            const collected = new Map<string, { path: string; isDirectory: boolean; isOpen: boolean }>();

            const addFile = (relativePath: string) => {
                const fileName = relativePath.split('/').pop() || '';
                if (EXCLUDED_NAMES.has(fileName)) {
                    return;
                }
                if (!collected.has(relativePath)) {
                    collected.set(relativePath, {
                        path: relativePath,
                        isDirectory: false,
                        isOpen: openPathSet.has(relativePath)
                    });
                }
            };

            // 已打开文件先入集合，确保即使被 glob 排除（如位于 .git 等目录）也能参与排序
            for (const f of openHits) {
                if (f.isDirectory) continue;
                addFile(f.path);
            }

            // basename 命中的文件本体
            for (const file of fileMatches) {
                addFile(vscode.workspace.asRelativePath(file, false));
            }

            // 祖先命中：文件本体 + 沿路径反推所有 query 命中的目录
            // 例：query='skill' 命中 .sema/skills/cron/scripts/pause_job.py 时，
            //     还会补出 .sema/skills、.sema/skills/cron、.sema/skills/cron/scripts
            for (const file of descendantMatches) {
                const relativePath = vscode.workspace.asRelativePath(file, false);
                addFile(relativePath);

                const parts = relativePath.split('/');
                for (let i = 1; i < parts.length; i++) {
                    const dirName = parts[i - 1];
                    if (EXCLUDED_NAMES.has(dirName)) {
                        continue;
                    }
                    const dirPath = parts.slice(0, i).join('/');
                    if (!dirPath.toLowerCase().includes(cleanQuery)) {
                        continue;
                    }
                    if (!collected.has(dirPath)) {
                        collected.set(dirPath, { path: dirPath, isDirectory: true, isOpen: false });
                    }
                }
            }

            // 3. 评分排序：有查询值时由 fileScoring 统一决定顺序，不再按 isOpen 置顶
            const scored = [...collected.values()].map(item => ({
                item,
                score: scoreItem(item.path, item.isDirectory, cleanQuery, rawQuery)
            }));
            scored.sort((a, b) => {
                const cmp = compareScored(
                    { score: a.score, isDirectory: a.item.isDirectory },
                    { score: b.score, isDirectory: b.item.isDirectory }
                );
                if (cmp !== 0) return cmp;
                return a.item.path.localeCompare(b.item.path);
            });

            return scored.slice(0, MAX_RESULTS).map(s => s.item);
        } catch (error) {
            console.error('Failed to search workspace files:', error);
            return [];
        }
    }

    /**
     * 将 Bash 输出内容以虚拟文档形式在编辑器中打开，相同 toolId 复用同一 tab
     */
    public async openBashOutputAsDocument(content: string, command: string, toolId?: string): Promise<void> {
        const docContent = command ? `# ${command}\n\n${content}` : content;
        const key = toolId || command || 'bash-output';
        const uri = BashOutputProvider.uriForId(key);
        this.bashOutputProvider.update(uri, docContent);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.One
        });
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
    }

    /**
     * 读取系统剪贴板里"复制的文件"路径列表（webview 沙箱拿不到，必须扩展端代劳）
     * 工作区内的文件会被还原为相对路径，与 @mention 现有视觉保持一致
     */
    public async readClipboardFiles(): Promise<string[]> {
        try {
            let absolutePaths: string[] = [];
            if (process.platform === 'darwin') {
                // 单文件返回单个 furl，多文件返回 list；非文件剪贴板会抛错走 on error 分支
                const script = `try
set fileList to (the clipboard as «class furl»)
set out to ""
if class of fileList is list then
repeat with f in fileList
set out to out & POSIX path of f & linefeed
end repeat
else
set out to POSIX path of fileList
end if
return out
on error
return ""
end try`;
                const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 1500 });
                absolutePaths = stdout.split('\n').map(s => s.trim()).filter(Boolean);
            } else if (process.platform === 'win32') {
                const script = [
                    'Add-Type -AssemblyName System.Windows.Forms',
                    '$files = [System.Windows.Forms.Clipboard]::GetFileDropList()',
                    'foreach ($file in $files) { [Console]::WriteLine($file) }'
                ].join('; ');
                const { stdout } = await execFileAsync(
                    'powershell.exe',
                    ['-NoProfile', '-Sta', '-Command', script],
                    { timeout: 1500, windowsHide: true }
                );
                absolutePaths = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            }
            // TODO: Linux 剪贴板文件路径读取

            return absolutePaths.map(abs => vscode.workspace.asRelativePath(vscode.Uri.file(abs), false));
        } catch (error) {
            console.error('Failed to read clipboard files:', error);
            return [];
        }
    }

    /**
     * 解析图片路径为 data URL（base64）
     * 走 data: 协议而不是 webview.asWebviewUri 的原因：
     *   asWebviewUri 受 webview.options.localResourceRoots 白名单约束，
     *   绝对路径（如 ~/Downloads/x.jpg）不在工作区下时无法加载；
     *   把 / 加进白名单等于让 webview 能读任意本地文件，安全降级太大。
     *   data URL 完全绕过 localResourceRoots，CSP 也已允许 data:。
     */
    public async resolveImageDataUri(filePath: string): Promise<string | null> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const isAbsolute = filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);

            let fileUri: vscode.Uri;
            if (isAbsolute) {
                fileUri = vscode.Uri.file(filePath);
            } else {
                if (!workspaceFolder) {
                    return null;
                }
                fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            }

            const stat = await vscode.workspace.fs.stat(fileUri);
            if (stat.type !== vscode.FileType.File) {
                return null;
            }

            const bytes = await vscode.workspace.fs.readFile(fileUri);
            const ext = path.extname(fileUri.fsPath).toLowerCase().slice(1);
            const mimeMap: Record<string, string> = {
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
                bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif'
            };
            const mime = mimeMap[ext] || 'application/octet-stream';
            const base64 = Buffer.from(bytes).toString('base64');
            return `data:${mime};base64,${base64}`;
        } catch {
            return null;
        }
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
