import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SemaSidebarProvider } from './core/semaSidebarProvider';
import { pet } from './pet/pet-client';
import { SystemConfigManager } from './managers/SystemConfigManager';
import { SkillCatalogManager } from './managers/SkillCatalogManager';
import { t } from './webview/common/i18n/core';

/** globalState 键：已处理过的默认安装 skill id（用户卸载后不再重装） */
const DEFAULT_SKILLS_INSTALLED_KEY = 'sema.defaultSkillsInstalled';

// 保存 sidebarProvider 实例以便在 deactivate 时使用
let sidebarProvider: SemaSidebarProvider;
// 保存当前工作区路径
let currentWorkspacePath: string | undefined;

export function activate(context: vscode.ExtensionContext) {
    // 先按落盘配置确定界面语言，后续宿主文案（含默认工作区 README）都据此取值
    SystemConfigManager.initLang(context);

    // 检查并设置默认工作区
    checkAndSetDefaultWorkspace();

    // 内置资源里标记 defaultInstall 的 skill 首次激活时装到用户级；异步不阻塞启动，失败只打日志下次重试
    const handled = context.globalState.get<string[]>(DEFAULT_SKILLS_INSTALLED_KEY, []);
    void new SkillCatalogManager(path.join(context.extensionPath, 'resources'))
        .installDefaultSkills(handled)
        .then(ids => { if (ids.length) return context.globalState.update(DEFAULT_SKILLS_INSTALLED_KEY, [...new Set([...handled, ...ids])]); })
        .then(undefined, err => console.error('[skill-catalog] default install failed:', err));

    sidebarProvider = new SemaSidebarProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'sema-vscode-view',
            sidebarProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );
    
    // 注册开始新对话命令
    const newSessionCommand = vscode.commands.registerCommand('sema-vscode-extension.newSession', () => {
        sidebarProvider.newSession();
        vscode.window.setStatusBarMessage(t('host.newSessionStarted'), 3000);
    });

    // 注册历史会话命令
    const openHistoryCommand = vscode.commands.registerCommand('sema-vscode-extension.openHistory', () => {
        sidebarProvider.openHistoryPanel();
    });

    // 注册配置命令
    const configCommand = vscode.commands.registerCommand('sema-vscode-extension.openConfig', () => {
        sidebarProvider.openConfigPanel();
    });

    // 资源管理器/编辑器标签右键「添加到聊天」：多选时 uris 有值，否则用单个 uri，再回退到当前活动编辑器
    const addToChatCommand = vscode.commands.registerCommand('sema-vscode-extension.addToChat', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const targets = (uris && uris.length > 0 ? uris : uri ? [uri] : [vscode.window.activeTextEditor?.document.uri])
            .filter((u): u is vscode.Uri => !!u && u.scheme === 'file');
        if (targets.length === 0) return;
        const files: { path: string; isDirectory: boolean }[] = [];
        for (const u of targets) {
            let isDirectory = false;
            try {
                isDirectory = (await vscode.workspace.fs.stat(u)).type === vscode.FileType.Directory;
            } catch { /* 取不到状态按文件处理 */ }
            // 与 @ 面板列表同一格式：工作区相对路径，统一为 / 分隔
            files.push({ path: vscode.workspace.asRelativePath(u, false).replace(/\\/g, '/'), isDirectory });
        }
        await sidebarProvider.addFilesToChat(files);
    });

    context.subscriptions.push(newSessionCommand, openHistoryCommand, configCommand, addToChatCommand);

    // 初始化当前工作区路径
    currentWorkspacePath = getCurrentWorkspacePath();

    // 监听工作区文件夹变更
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        const newWorkspacePath = getCurrentWorkspacePath();

        // 如果工作区路径发生变化，重新加载插件
        if (newWorkspacePath !== currentWorkspacePath) {
           // console.log(`工作区已变更: ${currentWorkspacePath} -> ${newWorkspacePath}`);
            currentWorkspacePath = newWorkspacePath;

            // 重新初始化插件
            reloadExtension(context);
        }
    });

    context.subscriptions.push(workspaceWatcher);

    // 桌宠：开关由「系统配置 → 基础设置 → 启用桌宠」控制，默认关闭
    if (sidebarProvider.isPetEnabled()) void sidebarProvider.startPet();
}

/**
 * 获取当前工作区路径
 */
function getCurrentWorkspacePath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }
    return undefined;
}

/**
 * 重新加载插件
 */
function reloadExtension(context: vscode.ExtensionContext) {
    // console.log('重新加载 Sema VSCode Extension...');

    // 销毁当前的 sidebarProvider
    if (sidebarProvider) {
        // 如果 sidebarProvider 有清理方法，在这里调用
        if (typeof (sidebarProvider as any).dispose === 'function') {
            (sidebarProvider as any).dispose();
        }
    }

    // 重新创建 sidebarProvider
    sidebarProvider = new SemaSidebarProvider(context);

    // 重新注册 webview provider (因为新的工作区可能需要重新注册)
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'sema-vscode-view',
            sidebarProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    vscode.window.setStatusBarMessage(t('host.reloaded'), 3000);

    // 工作区切换后 sema-core 实例已重建，桌宠订阅需重新挂载
    sidebarProvider.rewirePetEventsIfEnabled();
}

/**
 * 检查并设置默认工作区
 */
function checkAndSetDefaultWorkspace() {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    // 如果没有打开任何工作区
    if (!workspaceFolders || workspaceFolders.length === 0) {
       // console.log('未检测到工作区，准备创建默认工作区...');

        // 获取用户主目录
        const homeDir = os.homedir();
        const semaDemo = path.join(homeDir, 'sema-demo');

        // 检查sema-demo目录是否存在，不存在则创建
        if (!fs.existsSync(semaDemo)) {
            try {
                fs.mkdirSync(semaDemo, { recursive: true });
               // console.log(`已创建默认工作区目录: ${semaDemo}`);

                // 创建一个简单的README文件
                fs.writeFileSync(path.join(semaDemo, 'README.md'), t('host.demoReadme'), 'utf8');
               // console.log('已创建 README.md 文件');

            } catch (error) {
                console.error('创建默认工作区失败:', error);
                vscode.window.showErrorMessage(t('host.createDemoFailed', { error: String(error) }));
                return;
            }
        }

        // 打开sema-demo目录作为工作区
        const uri = vscode.Uri.file(semaDemo);
        vscode.commands.executeCommand('vscode.openFolder', uri, false).then(() => {
           // console.log(`已打开默认工作区: ${semaDemo}`);
            vscode.window.setStatusBarMessage(t('host.openDemoDone'), 3000);
        }, (error) => {
            console.error('打开默认工作区失败:', error);
            vscode.window.showErrorMessage(t('host.openDemoFailed', { error: String(error) }));
        });
    }
}

export async function deactivate(): Promise<void> {
    // console.log('Sema VSCode Extension is now deactivated!');
    if (sidebarProvider) {
        sidebarProvider.dispose();
    }
    await pet.dispose();
}