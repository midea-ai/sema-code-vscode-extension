import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as os from 'os';
import { FileStateDiffManager } from '../../managers/FileStateDiffManager';
import { FileOperationManager } from '../../managers/FileOperationManager';
import type { GitReviewManager } from '../../managers/GitReviewManager';
import { SemaProcessWrapper } from '../../core/semaProcessWrapper';
import type { SessionController } from '../../core/semaSidebarProvider';
import { transformCommandToPrompt } from '../../utils/prompt';
import type { InputImageAttachment, FileChangeItem } from 'sema-core/types';
import { isAttachmentPath } from '../common/viz';
import { DEFAULT_CUSTOM_RULES, isBuiltinCustomRules } from '../config/default/defaultConfig';
import { t, getLang, normalizeLang, type Language } from '../common/i18n/core';
import { buildPasteInput, type PasteAttachment } from '../common/paste';
import { savePastedText, removePastedText, readPastedText } from '../../utils/pasteAttachments';
import { buildVizEmbedHtml } from '../../utils/vizEmbed';
import { parseReviewCommand } from '../../utils/review';

const FILE_REFERENCE_QUOTE_REGEX = /[\s。，、；：！？""''「」『』（）《》〈〉【】,;!?]/;

/**
 * 本机 / 局域网 http(s) 地址：loopback、10/172.16-31/192.168 私网段、.localhost/.local/.internal 域
 * 与 webview 侧 markdown.ts 的 isPrivateHost 同一套规则（两个 bundle 独立构建，各持一份）
 */
function isPrivateHttpUrl(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const h = u.hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h === '::1'
            || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
            || /^10\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h);
    } catch {
        return false;
    }
}

function escapeQuotedFileReferencePath(filePath: string): string {
    return filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatFileReference(file: any, quoted = true): string {
    const pathText = String(file.path ?? '');
    const needsQuotes = quoted && FILE_REFERENCE_QUOTE_REGEX.test(pathText);
    const pathRef = needsQuotes ? `"${escapeQuotedFileReferencePath(pathText)}"` : pathText;
    const hasLineRange = file.startLine !== undefined && file.endLine !== undefined;
    return hasLineRange
        ? `@${pathRef}:${file.startLine}-${file.endLine}`
        : `@${pathRef}`;
}

/**
 * ChatWebviewProvider - 管理聊天界面 Webview（单 webview，多会话按 sessionId 路由）
 */
export class ChatWebviewProvider {
    private view?: vscode.WebviewView;
    /** 当前 webview html 的脚本 nonce；可视化 srcdoc iframe 继承 CSP，其脚本要带同一个 nonce 才能跑 */
    private nonce = '';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly processWrapper: SemaProcessWrapper,
        private readonly fileStateDiffManager: FileStateDiffManager,
        private readonly fileOperationManager: FileOperationManager,
        private readonly gitReviewManager: GitReviewManager,
        private readonly onOpenConfig: (page?: string, taskId?: string) => void,
        private readonly context: vscode.ExtensionContext,
        private readonly sessionController: SessionController,
        private readonly onLanguageChange?: (lang: Language) => void
    ) { }

    private static readonly INPUT_HISTORY_KEY = 'sema.inputHistory';
    /** globalState 键：欢迎页跑马灯最后一次点「不再显示」的内容 id（独立于系统配置，不受恢复默认影响；内容定义见 welcomeTip.ts） */
    private static readonly WELCOME_TIP_DISMISSED_ID_KEY = 'sema.welcomeTipDismissedId';
    private static readonly INPUT_HISTORY_MAX = 50;

    public setWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        const workspaceFolderUris = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
        this.view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri, ...workspaceFolderUris]
        };
        this.view.webview.html = this.getHtmlContent(this.view.webview);

        this.view.webview.onDidReceiveMessage(async (msg) => {
            const sid: string | undefined = msg.sessionId;
            const handlers: Record<string, () => Promise<void> | void> = {
                // ── 会话生命周期 ──
                frontendReady: () => this.onFrontendReady(),
                createSession: () => { void this.sessionController.createSession(msg.mode); },
                switchSession: () => this.sessionController.switchSession(msg.sessionId),
                closeSession: () => this.sessionController.closeSession(msg.sessionId),
                // 输入框有草稿：该会话不参与「打开后无变化」的自动回收
                sessionDraftActivity: () => { if (sid) this.sessionController.markSessionDraft(sid); },
                webviewSessionReady: () => this.sessionController.getSessionWrapper(msg.sessionId)?.sendInitialState(),

                // ── 会话级交互 ──
                sendInput: () => this.handleUserInput(sid, msg.text, msg.files, msg.attachments, msg.pastes),
                interrupt: () => this.interrupt(sid),
                toolPermissionResponse: () => this.sessionController.getSessionWrapper(sid!)?.respondToToolPermission(msg.response),
                askFormResponse: () => this.sessionController.getSessionWrapper(sid!)?.respondToPickOption(msg.response),
                planExitResponse: () => this.handlePlanExitResponse(sid, msg.response),
                insertPermissionRequest: () => this.sessionController.getSessionWrapper(sid!)?.insertPermissionRequestMessage(msg.permissionData),
                updateAgentMode: () => this.sessionController.getSessionWrapper(sid!)?.updateAgentMode(msg.mode),
                updatePermissionLevel: () => this.sessionController.getSessionWrapper(sid!)?.updatePermissionLevel(msg.level),
                // 长期目标：暂停 / 恢复 / 清除 与 更新文字，不排队立即生效，状态经 goal:update 回前端
                goalAction: () => this.sessionController.getSessionWrapper(sid!)?.goalAction(msg.action),
                updateGoal: () => this.sessionController.getSessionWrapper(sid!)?.updateGoal(msg.text),
                transferAgentToBackground: () => { this.sessionController.getSessionWrapper(sid!)?.transferAgentToBackground(msg.taskId); },
                // 模型显示是会话级的（来自 core 会话级事件/拉取）；切换 = 本会话 + 全局默认，其他已打开会话不动
                requestModelInfo: () => this.sessionController.getSessionWrapper(sid!)?.refreshModelInfo(true),
                switchModel: () => this.switchModel(sid, msg.modelName),

                // ── 进程级 / 工具类 ──
                openConfig: () => this.onOpenConfig(msg.page, msg.taskId),
                openFile: () => this.fileOperationManager.openFileAtLine(msg.filePath, msg.line, msg.endLine),
                requestWorkspaceFiles: () => this.sendWorkspaceFiles(msg.reqId),
                searchWorkspaceFiles: () => this.searchWorkspaceFiles(msg.query || '', msg.reqId),
                restoreFromSnapshots: () => this.handleRevertFiles(sid, msg.filePaths),
                restoreFromSnapshot: () => this.handleRevertFiles(sid, msg.filePath ? [msg.filePath] : []),
                getForkPreview: () => this.handleGetForkPreview(sid, msg.uuid, msg.reqId),
                forkSession: () => this.handleForkSession(sid, msg.uuid, msg.restoreFiles, msg.reqId),
                branchSession: () => this.handleBranchSession(sid, msg.reqId, msg.beforeMessageUuid),
                // 文件变更：清单整表下发、单文件按 core 左右文本开 diff、放弃修改走 core 恢复基线
                requestFileChanges: () => this.pushFileChanges(sid),
                showFileDiff: () => this.handleShowFileDiff(sid, msg.filePath, msg.minLine),
                showPermissionDiff: () => this.fileStateDiffManager.showPermissionDiff(sid!, msg.filePath, msg.diffContent),
                searchContentInFiles: () => this.searchContentInFiles(msg.content),
                requestClipboardFiles: () => this.requestClipboardFiles(),
                verifyFilePath: () => this.verifyFilePath(msg.filePath, msg.tempId, msg.originalCode, msg.lineInfo),
                resolveImagePath: () => this.resolveImagePath(msg.filePath, msg.tempId),
                openExternal: () => this.openExternal(msg.url),
                requestSystemConfig: () => this.sendSystemConfig(),
                dismissWelcomeTip: () => { void this.context.globalState.update(ChatWebviewProvider.WELCOME_TIP_DISMISSED_ID_KEY, msg.id); },
                updateLanguage: () => this.updateLanguage(msg.lang),
                requestCommands: () => this.sendCommands(),
                requestSkills: () => this.sendSkills(),
                requestAgents: () => this.sendAgents(),
                // /review 面板：审查范围信息（有无仓库、未提交改动规模）与最近提交列表
                requestReviewInfo: async () => this.postMessage({ type: 'reviewInfoLoaded', info: await this.gitReviewManager.getInfo() }),
                requestReviewCommits: async () => this.postMessage({ type: 'reviewCommitsLoaded', commits: await this.gitReviewManager.getRecentCommits() }),
                openBashOutput: () => this.fileOperationManager.openBashOutputAsDocument(msg.content, msg.command, msg.toolId),
                requestInputHistory: () => this.sendInputHistory(),
                saveInputHistory: () => this.appendInputHistory(msg.item),
                // 超长粘贴转附件：落盘（含退场）/ 删除 / 读回（fork 回填）；与会话无关
                savePastedText: () => {
                    try {
                        this.postMessage({ type: 'pastedTextSaved', reqId: msg.reqId, path: savePastedText(String(msg.text ?? '')).path });
                    } catch (error) {
                        console.error('Failed to save pasted text:', error);
                        this.postMessage({ type: 'pastedTextSaved', reqId: msg.reqId, path: null });
                    }
                },
                removePastedText: () => { try { removePastedText(String(msg.path || '')); } catch { /* ignore */ } },
                readPastedText: () => this.postMessage({ type: 'pastedTextRead', reqId: msg.reqId, path: msg.path, content: readPastedText(String(msg.path || '')) }),
                // 可视化产物内联嵌入：复制到临时目录并注入 viz-runtime，回 webview 可加载的 url
                prepareVizEmbed: () => this.prepareVizEmbed(String(msg.path || ''), msg.reqId),
                copyVizText: () => { if (typeof msg.text === 'string' && msg.text) void vscode.env.clipboard.writeText(msg.text); },
            };
            await handlers[msg.type]?.();
        });
    }

    public postMessage(message: any): void {
        this.view?.webview.postMessage(message);
    }

    public isViewResolved(): boolean {
        return !!this.view;
    }

    /** 清空指定会话的面板（权限/表单/计划/待办/文件变更等） */
    public clearSessionPanels(sessionId: string): void {
        this.postMessage({ type: 'closePermissionPanel', sessionId });
        this.postMessage({ type: 'closeAskFormPanel', sessionId });
        this.postMessage({ type: 'closePlanExitPanel', sessionId });
        this.postMessage({ type: 'clearPendingInputs', sessionId });
        this.postMessage({ type: 'clearTodos', sessionId });
        this.postMessage({ type: 'clearFileChanges', sessionId });
    }

    // ─── 消息 handlers ────────────────────────────────────────────────────────

    private async onFrontendReady(): Promise<void> {
        // 路径展示环境（home 缩写 ~）先于任何会话消息下发，保证历史消息首次渲染就有真值
        this.postMessage({
            type: 'envInfo',
            homeDir: os.homedir(),
            platform: process.platform,
        });
        // 模型未配置横幅不在此一次性判断：前端按 updateModelInfo / modelUpdate 的模型列表实时派生
        await this.sessionController.createSession();
    }

    private async handleUserInput(sessionId: string | undefined, text: string, files?: Array<any>, attachments?: InputImageAttachment[], pastes?: PasteAttachment[]): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper) return;
        // /review：不把原文交给 core，由宿主解析范围后给会话发审查指令（见 utils/review.ts）
        const reviewRequest = parseReviewCommand(text);
        if (reviewRequest) {
            await this.sessionController.startReview(wrapper, reviewRequest);
            return;
        }
        try {
            let content = text;
            const body = text;
            if (files && files.length > 0) {
                const refs = files.map((file: any) => ({
                    encoded: formatFileReference(file),
                    display: formatFileReference(file, false)
                }));
                for (const { encoded, display } of refs) {
                    if (encoded !== display) {
                        content = content.split(display).join(encoded);
                    }
                }
                const fileContext = refs
                    .filter(({ encoded }: { encoded: string; display: string }) => !content.includes(encoded))
                    .map(({ encoded }: { encoded: string }) => encoded)
                    .join(' ');
                content = fileContext ? `${content} ${fileContext} ` : content;
            }

            const transformedContent = transformCommandToPrompt(content);
            // 有粘贴附件：模型收到的 input 按模板把粘贴文件以 @路径 引用；originalInput 传用户实际打的正文（没打字就是空串，不是不传）
            if (pastes && pastes.length > 0) {
                const expanded = transformedContent && transformedContent !== content ? transformedContent : content;
                wrapper.processUserInput(buildPasteInput(pastes, expanded), body, attachments);
            } else if (transformedContent && transformedContent !== content) {
                wrapper.processUserInput(transformedContent, content, attachments);
            } else {
                wrapper.processUserInput(content, undefined, attachments);
            }
        } catch (error) {
            this.postMessage({
                type: 'error',
                sessionId,
                message: error instanceof Error ? error.message : t('host.inputError')
            });
        }
    }

    private interrupt(sessionId: string | undefined): void {
        if (!sessionId) return;
        const wrapper = this.sessionController.getSessionWrapper(sessionId);
        if (!wrapper) return;
        try {
            this.postMessage({ type: 'closePermissionPanel', sessionId });
            this.postMessage({ type: 'closeAskFormPanel', sessionId });
            this.postMessage({ type: 'closePlanExitPanel', sessionId });
            this.postMessage({ type: 'clearPendingInputs', sessionId });
            wrapper.interruptSession();
            wrapper.stopAllTasks();
        } catch (error) {
            console.error('Error interrupting session:', error);
        }
    }

    private async handlePlanExitResponse(sessionId: string | undefined, response: any): Promise<void> {
        if (!sessionId) return;
        const wrapper = this.sessionController.getSessionWrapper(sessionId);
        if (!wrapper) return;

        if (response.selected === 'clearContextAndStart') {
            wrapper.clearMessageHistory();
            this.postMessage({ type: 'closePermissionPanel', sessionId });
            this.postMessage({ type: 'closeAskFormPanel', sessionId });
            this.postMessage({ type: 'closePlanExitPanel', sessionId });
            this.postMessage({ type: 'clearPendingInputs', sessionId });
            this.postMessage({ type: 'clearTodos', sessionId });
            this.postMessage({ type: 'resetTokenInfo', sessionId });
        }
        wrapper.respondToPlanExit(response);
        wrapper.updateAgentMode('Agent');
        this.postMessage({ type: 'agentModeUpdate', sessionId, mode: 'Agent' });
    }

    private async sendWorkspaceFiles(reqId?: number): Promise<void> {
        const files = await this.fileOperationManager.getWorkspaceFiles();
        this.postMessage({
            type: 'workspaceFiles',
            reqId,
            files: files.map(item => ({ path: item.path, isDirectory: item.isDirectory, isOpen: item.isOpen }))
        });
    }

    private async searchWorkspaceFiles(query: string, reqId?: number): Promise<void> {
        const files = await this.fileOperationManager.searchWorkspaceFiles(query);
        this.postMessage({
            type: 'workspaceFiles',
            reqId,
            files: files.map(item => ({ path: item.path, isDirectory: item.isDirectory, isOpen: item.isOpen }))
        });
    }

    private async sendSystemConfig(): Promise<void> {
        try {
            const config = this.processWrapper.getSystemConfig();
            this.postMessage({
                type: 'systemConfigUpdate',
                skipFileEditPermission: config.skipFileEditPermission || false,
                thinking: config.thinking !== false,
                showThinkingText: (config as Record<string, any>).showThinkingText !== false,
                welcomeTipDismissedId: this.context.globalState.get<string>(ChatWebviewProvider.WELCOME_TIP_DISMISSED_ID_KEY, ''),
                lang: (config as Record<string, any>).lang
            });
        } catch (error) {
            console.error('Error sending system config:', error);
        }
    }

    /**
     * 首次配置提醒中的语言切换：行为与系统配置页保持一致。
     * 除了持久化 lang，当前规则仍为内置默认值时，也切换成目标语言的默认规则。
     */
    private async updateLanguage(value: unknown): Promise<void> {
        const lang = normalizeLang(value);
        try {
            const config = this.processWrapper.getSystemConfig() as Record<string, any>;
            const isDefaultRules = isBuiltinCustomRules(config.customRules);

            await this.processWrapper.updateSystemConfigByKey('lang', lang);
            if (isDefaultRules) {
                await this.processWrapper.updateSystemConfigByKey('customRules', DEFAULT_CUSTOM_RULES[lang]);
            }

            await this.sendSystemConfig();
            this.onLanguageChange?.(lang);
        } catch (error) {
            // 前端采用即时切换；保存失败时用实际落盘配置回填，避免显示与配置不一致。
            await this.sendSystemConfig();
            this.postMessage({
                type: 'error',
                message: t('host.saveConfigFailed', {
                    error: error instanceof Error ? error.message : t('common.unknownError')
                })
            });
        }
    }

    /**
     * 输入框切换主模型 = 改本会话 + 写全局默认（新建/加载会话取全局），其他已打开会话各自钉住不受影响。
     * 先会话级（本会话立即生效，显示由 core 会话级 model:update 驱动），再全局
     * （落 model.conf，经 onModelUpdate 回调刷新配置页与模型列表；活跃会话同步到同一模型，core 去重不重发）。
     */
    private async switchModel(sessionId: string | undefined, modelName: string): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper) return;
        try {
            await wrapper.switchModel(modelName);
            await this.processWrapper.switchModel(modelName);
        } catch (error) {
            this.postMessage({ type: 'error', message: t('host.switchModelFailed', { error: error instanceof Error ? error.message : t('common.unknownError') }) });
        }
    }

    /**
     * 把 core 的会话基线清单整表推给前端。attachments/<uuid>/ 下的文件（可视化产物、粘贴转存）
     * 是宿主自己的落盘目录，不算「编辑了项目文件」，在宿主侧过滤掉。
     */
    public async pushFileChanges(sessionId: string | undefined): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper) return;
        try {
            const changes: FileChangeItem[] = (await wrapper.getFileChanges())
                .filter(item => !isAttachmentPath(item.filePath));
            this.postMessage({ type: 'fileChanges', sessionId, changes });
        } catch (error) {
            console.error('Failed to load file changes:', error);
        }
    }

    /** 放弃修改：由 core 按会话基线恢复 / 删除文件，完成后整表刷新（失败项提示出来） */
    private async handleRevertFiles(sessionId: string | undefined, filePaths?: string[]): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper) return;
        try {
            const results = await wrapper.revertFileChanges(filePaths);
            const failed = results.filter(r => r.action === 'failed');
            if (failed.length > 0) {
                this.postMessage({
                    type: 'error',
                    message: t('host.revertFilesFailed', {
                        files: failed.map(f => f.displayPath).join(', '),
                        error: failed[0].error || t('common.unknownError')
                    })
                });
            }
            await this.pushFileChanges(sessionId);
        } catch (error) {
            this.postMessage({
                type: 'error',
                message: t('host.revertFilesFailed', {
                    files: String(filePaths?.length ?? ''),
                    error: error instanceof Error ? error.message : t('common.unknownError')
                })
            });
        }
    }

    /**
     * 打开单文件 diff：用 core 给的会话基线 + 查询时磁盘内容开原生 diff。
     * minLine 由工具编辑块给（这次编辑的锚点行）；面板点击不给，改用 core 返回的首个变更行，
     * 保证复用已打开的 diff 标签时也能定位到变更处。
     * 二进制 / 超出文本上限 / 基线不可用等不可比较的情况退回打开文件，不伪造空基线。
     */
    private async handleShowFileDiff(sessionId: string | undefined, filePath: string, minLine?: number): Promise<void> {
        if (!sessionId || !filePath) return;
        const wrapper = this.sessionController.getSessionWrapper(sessionId);
        if (!wrapper) return;
        // notebook 按 cell 定位，行号对 notebook 没有意义：编辑块给的是 cell 序号；
        // 面板点击不带 minLine，传 -1 只打开文件、不选 cell
        if (filePath.toLowerCase().endsWith('.ipynb')) {
            await this.fileStateDiffManager.openNotebook(filePath, minLine ?? -1);
            return;
        }
        try {
            const diff = await wrapper.getFileDiff(filePath);
            if (diff.status !== 'ok') {
                await this.fileStateDiffManager.openFile(diff.filePath, minLine ?? diff.line ?? 1);
                return;
            }
            await this.fileStateDiffManager.showTextDiff(
                sessionId,
                diff.filePath,
                diff.baselineText ?? '',
                diff.currentText ?? '',
                minLine ?? diff.line
            );
        } catch (error) {
            console.error('显示diff失败:', error);
            await this.fileStateDiffManager.openFile(filePath, minLine ?? 1);
        }
    }

    private handleGetForkPreview(sessionId: string | undefined, uuid: string, reqId: string): void {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper || !uuid) {
            this.postMessage({ type: 'forkPreviewResult', sessionId, reqId, error: t('host.forkPreviewFailed') });
            return;
        }
        try {
            const preview = wrapper.getForkPreview(uuid);
            this.postMessage({ type: 'forkPreviewResult', sessionId, reqId, preview });
        } catch (error) {
            this.postMessage({
                type: 'forkPreviewResult', sessionId, reqId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async handleForkSession(sessionId: string | undefined, uuid: string, restoreFiles: boolean, reqId: string): Promise<void> {
        const wrapper = sessionId ? this.sessionController.getSessionWrapper(sessionId) : undefined;
        if (!wrapper || !uuid) {
            this.postMessage({ type: 'forkResult', sessionId, reqId, uuid, result: { ok: false, error: t('host.sessionUnavailable') } });
            return;
        }
        try {
            const result = await wrapper.fork(uuid, { restoreFiles: !!restoreFiles });
            this.postMessage({ type: 'forkResult', sessionId, reqId, uuid, result });
            // 回退会截断基线与文件，面板按 core 的最新清单整表刷新（restoreFiles=false 时也刷新）
            if (result.ok !== false) await this.pushFileChanges(sessionId);
        } catch (error) {
            this.postMessage({
                type: 'forkResult', sessionId, reqId, uuid,
                result: { ok: false, error: error instanceof Error ? error.message : String(error) }
            });
        }
    }

    /** 分支到新聊天：成功时由 createNewSession 发 sessionOpened 打开新 tab，失败由 controller 发 sessionCreateFailed；
     *  这里只把结果回给源会话，用于解除前端的「分支中」状态 */
    private async handleBranchSession(sessionId: string | undefined, reqId: string, beforeMessageUuid?: string): Promise<void> {
        if (!sessionId) return;
        const result = await this.sessionController.branchSession(sessionId, beforeMessageUuid);
        this.postMessage({ type: 'branchResult', sessionId, reqId, ok: result.ok, error: result.error });
    }

    private async searchContentInFiles(content: string): Promise<void> {
        try {
            const result = await this.fileOperationManager.searchContentInFiles(content);
            this.postMessage({ type: 'contentSearchResult', result });
        } catch (error) {
            console.error('Failed to search content in files:', error);
            this.postMessage({ type: 'contentSearchResult', result: null });
        }
    }

    /** 回 srcdoc 用的 html 字符串（脚本带本 webview 的 nonce、内联 runtime）；失败回 null */
    private prepareVizEmbed(htmlPath: string, reqId: string): void {
        let html: string | null = null;
        try {
            const runtimeFile = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'viz-runtime.js').fsPath;
            html = buildVizEmbedHtml(htmlPath, runtimeFile, this.nonce);
        } catch (error) {
            console.error('Failed to prepare viz embed:', error);
        }
        this.postMessage({ type: 'vizEmbedReady', reqId, html });
    }

    private async requestClipboardFiles(): Promise<void> {
        try {
            const paths = await this.fileOperationManager.readClipboardFiles();
            this.postMessage({ type: 'clipboardFilesResult', paths });
        } catch (error) {
            console.error('Failed to read clipboard files:', error);
            this.postMessage({ type: 'clipboardFilesResult', paths: [] });
        }
    }

    private async resolveImagePath(filePath: string, tempId: string): Promise<void> {
        try {
            const dataUri = await this.fileOperationManager.resolveImageDataUri(filePath);
            if (!dataUri) {
                this.postMessage({ type: 'imagePathResolved', tempId, exists: false });
                return;
            }
            this.postMessage({ type: 'imagePathResolved', tempId, exists: true, src: dataUri });
        } catch (error) {
            console.error('Failed to resolve image path:', error);
            this.postMessage({ type: 'imagePathResolved', tempId, exists: false });
        }
    }

    private async verifyFilePath(filePath: string, tempId: string, originalCode: string, lineInfo?: string): Promise<void> {
        try {
            // exists 语义保持"是文件"（markdown 链接只对文件可点）；isDirectory 供用户气泡把目录引用也显示为芯片
            const { exists, isDirectory } = await this.fileOperationManager.statFilePath(filePath);
            this.postMessage({ type: 'filePathVerified', tempId, exists, isDirectory, filePath, originalCode, lineInfo });
        } catch (error) {
            console.error('Failed to verify file path:', error);
            this.postMessage({ type: 'filePathVerified', tempId, exists: false, filePath, originalCode, lineInfo });
        }
    }

    /**
     * 打开聊天正文里的链接（对齐 webui openLink 的分流策略）：
     * - 本机 / 局域网 http(s) 地址：VS Code 内置 Simple Browser 打开（dev server 预览留在编辑器内），命令不可用时回退系统浏览器
     * - 其余（公网、file:// 等）：系统浏览器 / 系统默认程序
     * 不做"能否内嵌"探测：有延迟且行为不可预期，Simple Browser 自带"在浏览器打开"按钮可兜底
     */
    private openExternal(url: string): void {
        if (!url) return;
        if (isPrivateHttpUrl(url)) {
            Promise.resolve(vscode.commands.executeCommand('simpleBrowser.show', url)).catch((error) => {
                console.warn('simpleBrowser.show failed, fallback to system browser:', error);
                this.openInSystemBrowser(url);
            });
            return;
        }
        this.openInSystemBrowser(url);
    }

    private openInSystemBrowser(url: string): void {
        try {
            vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (error) {
            console.error('Failed to open external url:', error);
        }
    }

    private sendInputHistory(): void {
        const items = this.context.workspaceState.get<any[]>(ChatWebviewProvider.INPUT_HISTORY_KEY, []);
        this.postMessage({ type: 'inputHistoryLoaded', items: Array.isArray(items) ? items : [] });
    }

    private async appendInputHistory(item: any): Promise<void> {
        if (!item || typeof item.text !== 'string' || !item.text.trim()) return;
        const list = this.context.workspaceState.get<any[]>(ChatWebviewProvider.INPUT_HISTORY_KEY, []);
        const arr = Array.isArray(list) ? list.slice() : [];
        const last = arr[arr.length - 1];
        const isDup = last && last.text === item.text
            && JSON.stringify(last.mentions || []) === JSON.stringify(item.mentions || []);
        if (!isDup) arr.push(item);
        while (arr.length > ChatWebviewProvider.INPUT_HISTORY_MAX) arr.shift();
        await this.context.workspaceState.update(ChatWebviewProvider.INPUT_HISTORY_KEY, arr);
    }

    private async sendCommands(): Promise<void> {
        try {
            const commands = await this.processWrapper.getCommandsInfo();
            this.postMessage({ type: 'customCommandsLoaded', commands });
        } catch (error) {
            console.error('Error loading commands:', error);
        }
    }

    private async sendSkills(): Promise<void> {
        try {
            // 禁用的 skill 不进聊天斜杠列表
            const skills = (await this.processWrapper.getSkillsInfo()).filter(s => s.status !== false);
            this.postMessage({ type: 'skillsLoaded', skills });
        } catch (error) {
            console.error('Error loading skills:', error);
        }
    }

    private async sendAgents(): Promise<void> {
        try {
            const agents = await this.processWrapper.getAgentsInfo();
            this.postMessage({ type: 'agentsLoaded', agents });
        } catch (error) {
            console.error('Error loading agents:', error);
        }
    }

    // ─── HTML ─────────────────────────────────────────────────────────────────

    private getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js')
        );
        const nonce = this.nonce = this.getNonce();
        // <html lang> 由 i18n 模块在 webview 启动时读取作为初始语言，避免首屏闪中文
        // connect-src 放行 jsdelivr：可视化 srcdoc iframe 继承本 CSP，地图类图表要从那里拉 TopoJSON
        return `<!DOCTYPE html>
<html lang="${getLang()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;
        script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;
        connect-src https://cdn.jsdelivr.net;
        font-src ${webview.cspSource} data:;
        img-src ${webview.cspSource} https: data: blob:;
        frame-src ${webview.cspSource};">
    <title>Code Assistant</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private getNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }
}
