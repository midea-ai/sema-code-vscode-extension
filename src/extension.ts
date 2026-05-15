import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SemaSidebarProvider } from './core/semaSidebarProvider';
import { pet } from './pet/pet-client';

// 保存 sidebarProvider 实例以便在 deactivate 时使用
let sidebarProvider: SemaSidebarProvider;
// 保存当前工作区路径
let currentWorkspacePath: string | undefined;

export function activate(context: vscode.ExtensionContext) {
    // console.log('Sema VSCode Extension is now active!');

    // 检查并设置默认工作区
    checkAndSetDefaultWorkspace();

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
        vscode.window.setStatusBarMessage('✓ 已开始新对话', 3000);
    });

    // 注册历史会话命令
    const openHistoryCommand = vscode.commands.registerCommand('sema-vscode-extension.openHistory', () => {
        sidebarProvider.openHistoryPanel();
    });

    // 注册配置命令
    const configCommand = vscode.commands.registerCommand('sema-vscode-extension.openConfig', () => {
        sidebarProvider.openConfigPanel();
    });

    context.subscriptions.push(newSessionCommand, openHistoryCommand, configCommand);

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

    vscode.window.setStatusBarMessage('✓ Sema 插件已重新加载', 3000);

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
                const readmeContent = `# Sema Demo 工作区

这是 Sema VSCode Extension 的默认工作区。

## 使用说明

1. 在这个目录下创建你的项目文件
2. 使用 Sema 插件进行代码助手功能
3. 如需切换到其他工作区，请使用 VSCode 的 "文件 -> 打开文件夹" 功能

## 开始使用

你可以在这里创建任何类型的项目文件，Sema 插件会自动适配当前工作区环境。
`;
                fs.writeFileSync(path.join(semaDemo, 'README.md'), readmeContent, 'utf8');
               // console.log('已创建 README.md 文件');

            } catch (error) {
                console.error('创建默认工作区失败:', error);
                vscode.window.showErrorMessage(`创建默认工作区失败: ${error}`);
                return;
            }
        }

        // 打开sema-demo目录作为工作区
        const uri = vscode.Uri.file(semaDemo);
        vscode.commands.executeCommand('vscode.openFolder', uri, false).then(() => {
           // console.log(`已打开默认工作区: ${semaDemo}`);
            vscode.window.setStatusBarMessage('✓ 已打开默认工作区 sema-demo', 3000);
        }, (error) => {
            console.error('打开默认工作区失败:', error);
            vscode.window.showErrorMessage(`打开默认工作区失败: ${error}`);
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