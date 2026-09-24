import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FileChange, TokenInfo, AppProps, SelectedFile, TodoItem, Message, AgentMode, PermissionLevel, SessionMeta, ForkPreview, ImageAttachment, VscodeApi, InputSource } from './types';
import { streamingStore } from './utils/StreamingStore';
import InputBox, { InputBoxHandle } from './components/input/InputBox';
import MessageItem from './MessageItem';
import UserInputBlock from './blocks/UserInputBlock';
import { parsePasteInput, type PasteAttachment } from '../common/paste';
import GroupedToolBlock from './blocks/tools/GroupedToolBlock';
import SessionTabs from './components/SessionTabs';
import { SessionActiveContext, SessionContext } from './SessionContext';

import FileChangesPanel from './components/panels/FileChangesPanel';
import TodosPanel from './components/panels/TodosPanel';
import Welcome from './components/panels/Welcome';
import DesignModeHint from './components/panels/DesignModeHint';
import PermissionDialog from './components/permission/PermissionDialog';
import AskFormDialog, { AskFormValues, AskFormStatus, PickOptionRequestData } from './components/ui/AskFormDialog';
import PlanExitDialog from './components/ui/PlanExitDialog';
import QuickChatDialog from './components/ui/QuickChatDialog';
import ForkDialog from './components/ui/ForkDialog';
import ProcessingSpinner from './components/ui/ProcessingSpinner';
import { useT, setLang, type Language } from '../common/i18n/react';
import ModelConfigReminder from './components/ui/ModelConfigReminder';
import { PREVIEW_MODE, getPreviewMessages, mockDialogMap, isPreviewActive } from './utils/mockMessages';
import { groupMessages, getToolName, getToolTitle } from './utils/groupMessages';
import VizEmbed from './blocks/VizEmbed';
import { isAttachmentPath, isVizPath } from '../common/viz';
import { TOOL_NAME_RUN_SHELL, TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE } from '../../utils/tool';
import { TASK_TYPE_SHELL, TASK_TYPE_AGENT } from '../config/BackgroundTaskConfig';
import PreviewDialogs from './utils/PreviewDialogs';

interface ChatSessionProps {
    vscode: AppProps['vscode'];
    sessionId: string;
    active: boolean;
    /** 上报本会话是否有待用户响应的权限/表单弹窗 */
    onWaitingChange?: (sessionId: string, waiting: boolean) => void;
}

/**
 * 单个会话视图。每个会话一个实例，自带独立 state；非 active 时隐藏但保持挂载，
 * 后台事件持续更新其内存状态。
 */
const ChatSession: React.FC<ChatSessionProps> = ({ vscode: rawVscode, sessionId, active, onWaitingChange }) => {
    const t = useT();
    // 包一层：给本会话子树发出的所有消息自动补 sessionId（未显式设置时），
    // 避免 FileChangesPanel/EditBlock 等子组件发的 showFileDiff/restore 因缺 sessionId
    // 落到后端后取不到本会话快照（diff 左侧空、恢复失败）。
    const vscode = useMemo<VscodeApi>(() => ({
        postMessage: (message: any) => {
            if (message && typeof message === 'object' && message.sessionId === undefined) {
                rawVscode.postMessage({ ...message, sessionId });
            } else {
                rawVscode.postMessage(message);
            }
        },
        getState: () => rawVscode.getState(),
        setState: (state: any) => rawVscode.setState(state),
    }), [rawVscode, sessionId]);

    const [messages, setMessages] = useState<Message[]>([]);
    const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
    const [streamingToolId, setStreamingToolId] = useState<string | null>(null);
    const streamingAssistantIdRef = useRef<string | null>(null);
    const streamingToolIdRef = useRef<string | null>(null);
    const messagesRef = useRef<Message[]>([]);
    const [progressMessage, setProgressMessage] = useState<string>('');
    const [tokenInfo, setTokenInfo] = useState<TokenInfo>({ useTokens: 0, maxTokens: 0, promptTokens: 0 });
    const [inputDisabled, setInputDisabled] = useState<boolean>(true);
    // null 表示用默认文案（按禁用态取「初始化中」/「请输入需求」，随语言切换），非空为宿主指定的提示
    const [inputPlaceholderMsg, setInputPlaceholderMsg] = useState<string | null>(null);
    const [processingState, setProcessingState] = useState<'idle' | 'processing'>('idle');
    const [fileChanges, setFileChanges] = useState<FileChange[]>(isPreviewActive('FileChangesPanel') ? (mockDialogMap.FileChangesPanel?.[0]?.changes || []) : []);
    const [todos, setTodos] = useState<TodoItem[]>(isPreviewActive('TodosPanel') ? (mockDialogMap.TodosPanel?.[0]?.todos || []) : []);
    const [modelName, setModelName] = useState<string>('');
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    type DialogQueueItem =
        | { type: 'permission';  data: any; isBackground: boolean }
        | { type: 'askForm'; data: PickOptionRequestData; isBackground: boolean }
        | { type: 'planExit';    data: any; isBackground: boolean }
        | { type: 'quickchat';         data: { question: string; content: string }; isBackground: false };
    const [dialogQueue, setDialogQueue] = useState<DialogQueueItem[]>([]);
    const activeDialog = dialogQueue[0] ?? null;
    const [forkDialog, setForkDialog] = useState<{ uuid: string; preview: ForkPreview } | null>(null);

    // 队列中存在权限/表单/计划弹窗时，向 App 上报本会话处于「等待用户响应」状态
    useEffect(() => {
        const waiting = dialogQueue.some(
            d => d.type === 'permission' || d.type === 'askForm' || d.type === 'planExit'
        );
        onWaitingChange?.(sessionId, waiting);
    }, [dialogQueue, sessionId, onWaitingChange]);

    /** 是否已收到过一次模型信息：未收到前不显示横幅，避免加载瞬间误报 */
    const [modelInfoLoaded, setModelInfoLoaded] = useState<boolean>(false);
    /** 用户主动关闭/点开配置后临时隐藏；模型列表一旦非空再变空会重新显示 */
    const [modelReminderDismissed, setModelReminderDismissed] = useState<boolean>(false);
    /**
     * updateModelInfo（会话级，带本会话生效模型名）/ modelUpdate（进程级，只带模型列表）统一入口。
     * 模型是会话级的：name 为 undefined 时保留当前会话模型名不动，只更新列表；列表非空时复位关闭标记。
     */
    const applyModelInfo = (name: string | undefined, list: string[] | undefined) => {
        const models = Array.isArray(list) ? list : [];
        if (name !== undefined) setModelName(name || '');
        setAvailableModels(models);
        setModelInfoLoaded(true);
        if (models.length > 0) setModelReminderDismissed(false);
    };
    const [spinnerAccumulatedSeconds, setSpinnerAccumulatedSeconds] = useState<number>(0);
    const [agentMode, setAgentMode] = useState<AgentMode>('Agent');
    const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>('Ask');
    const [skipFileEditPermission, setSkipFileEditPermission] = useState<boolean>(false);
    const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(true);
    const [showThinkingText, setShowThinkingText] = useState<boolean>(false);
    // 排队中的用户输入：content 为用户实际打的正文（originalInput），附件随 input:received 一并回显
    const [pendingInputs, setPendingInputs] = useState<Array<{ inputId: string; content: string; source?: InputSource; attachments?: ImageAttachment[]; pastes?: PasteAttachment[] }>>([]);
    // 用户输入预测（core input:predict 事件；空串 = 预计不会回复，清除提示）
    const [inputPrediction, setInputPrediction] = useState<string>('');
    const [runningTasks, setRunningTasks] = useState<Map<string, { taskId: string; filepath: string; type: string; startTime: number }>>(new Map());
    const [openAgentTaskId, setOpenAgentTaskId] = useState<string | null>(null);

    const outputContainerRef = useRef<HTMLDivElement>(null);
    const outputContentRef = useRef<HTMLDivElement>(null);
    const inputBoxRef = useRef<InputBoxHandle>(null);
    // 贴底跟随：state 驱动回到底部按钮显隐，ref 供 scroll/ResizeObserver 回调同步读取
    const [stick, setStick] = useState<boolean>(true);
    const stickRef = useRef<boolean>(true);
    // 内容是否超出一屏，不可滚动时不显示回到底部按钮
    const [overflow, setOverflow] = useState<boolean>(false);
    const programmaticScrollRef = useRef<boolean>(false);
    const lastScrollTopRef = useRef<number>(0);
    const spinnerStartTimeRef = useRef<number>(0);
    const runningTasksRef = useRef(runningTasks);
    const prevMessagesLenRef = useRef<number>(0);
    const forkReqRef = useRef<string | null>(null);
    const branchReqRef = useRef<string | null>(null);

    const handleFileChange = useCallback(async (change: FileChange) => {
        // attachments/<uuid>/ 下的文件（可视化产物、粘贴转存）是宿主自己的落盘目录，不算「编辑了项目文件」
        if (isAttachmentPath(change.fullPath)) return;
        try {
            setFileChanges(prev => {
                const existingIndex = prev.findIndex(c => c.fullPath === change.fullPath);
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                        ...updated[existingIndex],
                        isNotebook: change.isNotebook,
                        type: change.type
                    };
                    return updated;
                } else {
                    return [...prev, {
                        ...change,
                        additions: 0,
                        removals: 0,
                        minLine: change.minLine || 1
                    }];
                }
            });

            if (change.fullPath) {
                vscode.postMessage({
                    type: 'getFileChangeStats',
                    sessionId,
                    filePath: change.fullPath
                });
            }
        } catch (error) {
            console.error('handleFileChange error:', error);
        }
    }, [sessionId]);

    // 点击用户输入块的 Fork 角标：先取预览，收到 forkPreviewResult 后再开弹窗。
    // 仅 idle 时按钮可点（UserInputBlock 已用 canFork 拦截），这里只负责发起预览请求。
    const handleFork = useCallback((uuid: string) => {
        const reqId = `fork-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        forkReqRef.current = reqId;
        vscode.postMessage({ type: 'getForkPreview', sessionId, uuid, reqId });
    }, [sessionId, vscode]);

    // 点击 AI 回复下的「分支到新聊天」：core 复制截至该轮的历史到新会话，扩展侧以新 tab 打开。
    // 锚点取被点消息之后的第一条用户输入（core branch 语义：截到该用户输入之前）；
    // 最后一轮无后续用户输入，不传锚点即全量复制。
    // 新 tab 由 sessionOpened 打开、失败由 sessionCreateFailed 提示，这里只做防重复点击。
    const handleBranch = useCallback((messageId: string) => {
        if (branchReqRef.current) return;
        const clickedIndex = messages.findIndex(m => m.id === messageId);
        if (clickedIndex < 0) return;
        const nextUser = messages.slice(clickedIndex + 1).find(m => m.type === 'user');
        // 锚点用 uuid（== core inputId）；中间轮次的按钮仅在下一轮用户输入有 uuid 时展示，
        // 这里兜底：有下一轮却拿不到锚点时不发起，避免误发全量分支
        if (nextUser && !nextUser.uuid) return;
        const reqId = `branch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        branchReqRef.current = reqId;
        vscode.postMessage({ type: 'branchSession', sessionId, reqId, beforeMessageUuid: nextUser?.uuid });
    }, [sessionId, vscode, messages]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            // 仅处理本会话的消息；进程级消息（无 sessionId）所有会话均可处理
            if (message.sessionId && message.sessionId !== sessionId) return;

            switch (message.type) {
                case 'updateContent':
                    streamingStore.clear(sessionId);
                    streamingAssistantIdRef.current = null;
                    streamingToolIdRef.current = null;
                    setStreamingAssistantId(null);
                    setStreamingToolId(null);
                    messagesRef.current = (message.messages || []).slice();
                    setMessages(message.messages || []);
                    break;
                case 'appendMessages': {
                    const newMsgs = message.messages || [];
                    messagesRef.current = [...messagesRef.current, ...newMsgs];
                    setMessages([...messagesRef.current]);
                    break;
                }
                case 'updateMessage': {
                    const updateIdx = messagesRef.current.findIndex(m => m.id === message.id);
                    if (updateIdx >= 0) {
                        messagesRef.current[updateIdx] = { ...messagesRef.current[updateIdx], content: message.content };
                        setMessages([...messagesRef.current]);
                    }
                    if (streamingToolIdRef.current === message.id) {
                        streamingToolIdRef.current = null;
                        setStreamingToolId(null);
                    }
                    break;
                }
                case 'chunkUpdate': {
                    streamingStore.emitText(sessionId, message.id, { contentDelta: message.contentDelta, reasoningDelta: message.reasoningDelta });
                    if (message.contentDelta !== undefined && streamingAssistantIdRef.current !== message.id) {
                        streamingAssistantIdRef.current = message.id;
                        setStreamingAssistantId(message.id);
                    }
                    break;
                }
                case 'completeUpdate': {
                    const msgIndex = messagesRef.current.findIndex(m => m.id === message.id);
                    if (msgIndex >= 0) {
                        const msg = messagesRef.current[msgIndex];
                        messagesRef.current[msgIndex] = {
                            ...msg,
                            ...(message.content !== undefined && { content: message.content }),
                            ...(message.reasoning !== undefined && { reasoning: message.reasoning })
                        };
                    }
                    streamingAssistantIdRef.current = null;
                    setStreamingAssistantId(null);
                    setMessages([...messagesRef.current]);
                    break;
                }
                case 'toolChunkUpdate': {
                    streamingStore.emitTool(sessionId, message.id, message.contentDelta || '');
                    if (streamingToolIdRef.current !== message.id) {
                        streamingToolIdRef.current = message.id;
                        setStreamingToolId(message.id);
                    }
                    break;
                }
                case 'showProgress':
                    setProgressMessage(message.message);
                    break;
                case 'stateUpdate':
                    setProcessingState(message.state);
                    break;
                case 'updateTokenInfo':
                    setTokenInfo(message.tokenInfo);
                    break;
                case 'enableInput':
                    setInputDisabled(false);
                    setInputPlaceholderMsg(null);
                    vscode.postMessage({ type: 'requestSystemConfig' });
                    break;
                case 'disableInput':
                    setInputDisabled(true);
                    setInputPlaceholderMsg(message.message || null);
                    break;
                case 'fileChange':
                    handleFileChange(message.change);
                    break;
                case 'fileChangeStats':
                    if (message.fullPath && message.stats) {
                        setFileChanges(prev => {
                            const existingIndex = prev.findIndex(c => c.fullPath === message.fullPath);
                            if (existingIndex >= 0) {
                                const updated = [...prev];
                                updated[existingIndex] = {
                                    ...updated[existingIndex],
                                    additions: message.stats.additions,
                                    removals: message.stats.removals,
                                    minLine: message.stats.minLine
                                };
                                return updated;
                            }
                            return prev;
                        });
                    }
                    break;
                case 'clearFileChanges':
                    setFileChanges([]);
                    break;
                case 'removeFileChange':
                    if (message.filePath) {
                        setFileChanges(prev => prev.filter(c => c.fullPath !== message.filePath));
                    }
                    break;
                case 'todosUpdate':
                    if (Array.isArray(message.todos)) {
                        setTodos(message.todos);
                    }
                    break;
                case 'clearTodos':
                    setTodos([]);
                    break;
                case 'updateModelInfo':
                    applyModelInfo(message.modelName, message.availableModels);
                    break;
                case 'modelUpdate':
                    // 进程级：data.modelName 是全局主模型指针，不是本会话生效模型，这里只取列表
                    if (message.data) {
                        applyModelInfo(undefined, message.data.modelList);
                    }
                    break;
                case 'toolPermissionRequest':
                    if (message.data) {
                        setOpenAgentTaskId(null);
                        setDialogQueue(prev => [...prev, { type: 'permission', data: message.data, isBackground: runningTasksRef.current.has(message.data.agentId) }]);
                    }
                    break;
                case 'closePermissionPanel':
                    setDialogQueue(prev => prev.filter(d => d.type !== 'permission'));
                    break;
                case 'askFormRequest':
                    if (message.data) {
                        setOpenAgentTaskId(null);
                        setDialogQueue(prev => [...prev, { type: 'askForm', data: message.data, isBackground: runningTasksRef.current.has(message.data.agentId) }]);
                    }
                    break;
                case 'closeAskFormPanel':
                    setDialogQueue(prev => prev.filter(d => d.type !== 'askForm'));
                    break;
                case 'planExitRequest':
                    if (message.data) {
                        setOpenAgentTaskId(null);
                        setDialogQueue(prev => [...prev, { type: 'planExit', data: message.data, isBackground: false }]);
                    }
                    break;
                case 'closePlanExitPanel':
                    setDialogQueue(prev => prev.filter(d => d.type !== 'planExit'));
                    break;
                case 'resetTokenInfo':
                    setTokenInfo({ useTokens: 0, maxTokens: 0, promptTokens: 0 });
                    break;
                case 'agentModeUpdate':
                    if (message.mode) {
                        setAgentMode(message.mode);
                    }
                    break;
                case 'systemConfigUpdate':
                    if (typeof message.lang === 'string') {
                        setLang(message.lang);
                    }
                    if (typeof message.skipFileEditPermission === 'boolean') {
                        setSkipFileEditPermission(message.skipFileEditPermission);
                    }
                    if (typeof message.thinking === 'boolean') {
                        setThinkingEnabled(message.thinking);
                    }
                    if (typeof message.showThinkingText === 'boolean') {
                        setShowThinkingText(message.showThinkingText);
                    }
                    break;
                case 'permissionLevelUpdate':
                    if (message.level) {
                        setPermissionLevel(message.level);
                    }
                    break;
                case 'inputReceived':
                    if (message.data) {
                        setPendingInputs(prev => [...prev, {
                            inputId: message.data.inputId,
                            // originalInput 存在就用它（空串 = 只有粘贴附件没打字），缺省才退回完整 input
                            content: message.data.originalInput ?? message.data.input ?? '',
                            source: message.data.source,
                            attachments: Array.isArray(message.data.attachments) && message.data.attachments.length > 0 ? message.data.attachments : undefined,
                            pastes: parsePasteInput(message.data.input),
                        }]);
                    }
                    break;
                case 'inputProcessing':
                    if (message.data) {
                        setPendingInputs(prev => prev.filter(p => p.inputId !== message.data.inputId));
                    }
                    // 新一轮输入开始处理，上一轮的预测已过期
                    setInputPrediction('');
                    break;
                case 'inputPredict':
                    setInputPrediction(message.data?.prediction || '');
                    break;
                case 'clearPendingInputs':
                    setPendingInputs([]);
                    break;
                case 'taskStart':
                    if (message.data) {
                        setRunningTasks(prev => {
                            const next = new Map(prev);
                            next.set(message.data.taskId, {
                                taskId: message.data.taskId,
                                filepath: message.data.filepath,
                                type: message.data.type,
                                startTime: Date.now(),
                            });
                            return next;
                        });
                    }
                    break;
                case 'taskEnd':
                    if (message.data) {
                        setRunningTasks(prev => {
                            const next = new Map(prev);
                            next.delete(message.data.taskId);
                            return next;
                        });
                    }
                    break;
                case 'quickchatResponse':
                    if (message.data) {
                        setDialogQueue(prev => [{ type: 'quickchat', data: message.data, isBackground: false as const }, ...prev]);
                    }
                    break;
                case 'openAgentDetail':
                    if (message.taskId) {
                        setOpenAgentTaskId(message.taskId);
                    }
                    break;
                case 'forkPreviewResult':
                    // 仅处理最新一次预览请求，旧响应丢弃
                    if (message.reqId && message.reqId === forkReqRef.current) {
                        forkReqRef.current = null;
                        if (message.error || !message.preview) {
                            console.error('[fork] preview failed:', message.error);
                        } else {
                            setForkDialog({ uuid: message.preview.messageUuid, preview: message.preview });
                        }
                    }
                    break;
                case 'forkResult': {
                    setForkDialog(null);
                    const result = message.result;
                    if (!result || !result.ok) {
                        console.error('[fork] fork failed:', result?.error);
                        break;
                    }
                    // 1) 截断对话：移除该用户消息及其之后的所有消息
                    const forkUuid = message.uuid;
                    const idx = messagesRef.current.findIndex(m => m.uuid === forkUuid);
                    if (idx >= 0) {
                        const originalContent = messagesRef.current[idx]?.content;
                        const originalAttachments = messagesRef.current[idx]?.attachments;
                        const originalPastes = messagesRef.current[idx]?.pastes;
                        const truncated = messagesRef.current.slice(0, idx);
                        messagesRef.current = truncated;
                        setMessages(truncated);
                        // 回填原输入（文本 + 图片 + 长文粘贴附件），方便用户改了重发；纯附件无文字也要回填
                        const originalText = typeof originalContent === 'string' ? originalContent : '';
                        if (originalText || (originalAttachments && originalAttachments.length > 0) || (originalPastes && originalPastes.length > 0)) {
                            inputBoxRef.current?.setText(originalText, originalAttachments, originalPastes);
                        }
                    }
                    // 2) 文件回滚：移除已回滚的变更条目（restoreFiles=false 时 restoredFiles 为空，不动面板）。
                    //    core 回滚的是绝对路径，而面板 fullPath 取决于工具调用入参（可能是相对路径/文件名），
                    //    故按"绝对路径相等，或绝对路径以 /相对路径 结尾"判断等价（带 / 边界避免误配同名后缀）。
                    const restoredFiles: string[] = Array.isArray(result.restoredFiles) ? result.restoredFiles : [];
                    if (restoredFiles.length > 0) {
                        const isRestored = (fullPath: string) =>
                            restoredFiles.some(rf => rf === fullPath || rf.endsWith('/' + fullPath));
                        setFileChanges(prev => prev.filter(c => !isRestored(c.fullPath)));
                    }
                    // 3) todos：core 回档后会重发 todos:update，前端 todosUpdate 已整体替换，无需处理
                    break;
                }
                case 'branchResult':
                    if (message.reqId && message.reqId === branchReqRef.current) {
                        branchReqRef.current = null;
                        if (!message.ok) {
                            console.error('[branch] branch failed:', message.error);
                        }
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);

        // 消息监听器就位后，通知后端本会话视图已挂载，回放当前状态
        vscode.postMessage({ type: 'webviewSessionReady', sessionId });
        vscode.postMessage({ type: 'requestModelInfo' });
        vscode.postMessage({ type: 'requestSystemConfig' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [sessionId]);

    useEffect(() => { runningTasksRef.current = runningTasks; }, [runningTasks]);

    // 会话切走（新建/切换 tab）时清掉外部触发的子代理详情，弹窗本体由 SessionActiveContext 关闭
    useEffect(() => {
        if (!active) {
            setOpenAgentTaskId(null);
        }
    }, [active]);

    const isSpinnerVisible = processingState === 'processing' && !progressMessage && !activeDialog;

    useEffect(() => {
        if (isSpinnerVisible) {
            spinnerStartTimeRef.current = Date.now();
        } else {
            if (spinnerStartTimeRef.current > 0) {
                const elapsed = Math.floor((Date.now() - spinnerStartTimeRef.current) / 1000);
                setSpinnerAccumulatedSeconds(prev => prev + elapsed);
                spinnerStartTimeRef.current = 0;
            }
        }
    }, [isSpinnerVisible]);

    useEffect(() => {
        if (active && window.hljs && outputContainerRef.current && messages.length > prevMessagesLenRef.current) {
            outputContainerRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                window.hljs.highlightElement(block);
            });
        }
        prevMessagesLenRef.current = messages.length;
    }, [messages, active]);

    useEffect(() => {
        if (PREVIEW_MODE && window.hljs && outputContainerRef.current) {
            outputContainerRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                window.hljs.highlightElement(block);
            });
        }
    }, []);

    useEffect(() => {
        if (activeDialog && outputContainerRef.current) {
            setTimeout(() => {
                if (outputContainerRef.current) {
                    doScrollToBottom();
                    if (activeDialog.type === 'permission' && window.hljs) {
                        outputContainerRef.current.querySelectorAll('pre code').forEach((block) => {
                            if (!block.classList.contains('hljs')) {
                                window.hljs.highlightElement(block);
                            }
                        });
                    }
                }
            }, 50);
        }
    }, [activeDialog]);

    const setStickState = (v: boolean) => {
        stickRef.current = v;
        setStick(v);
    };

    // 程序触发的置底:打标志位,让 scroll 监听能区分“程序滚的”和“用户滚的”
    const doScrollToBottom = () => {
        const el = outputContainerRef.current;
        if (!el) return;
        // scrollTop 已在最底时赋值不会触发 scroll 事件,此时不能留下标志位,否则会吞掉下一次用户滚动
        if (el.scrollTop < el.scrollHeight - el.clientHeight - 1) {
            programmaticScrollRef.current = true;
        }
        el.scrollTop = el.scrollHeight;
    };

    const scrollToBottom = () => {
        if (stickRef.current) {
            doScrollToBottom();
        }
    };

    // 用户点击回到底部：置底并恢复贴底跟随
    const handleScrollBottomClick = () => {
        doScrollToBottom();
        setStickState(true);
    };

    // 置底由内容/视口尺寸变化驱动（流式 setState commit、hljs 高亮、iframe 加载、面板展开都会改高度），
    // ResizeObserver 在 layout 之后回调，此时 scrollHeight 已是新值，不会像事件里同步置底那样慢一拍
    useEffect(() => {
        const container = outputContainerRef.current;
        const content = outputContentRef.current;
        if (!container || !content) return;

        const onResize = () => {
            const canScroll = container.scrollHeight - container.clientHeight > 1;
            setOverflow(canScroll);
            if (stickRef.current && canScroll) {
                doScrollToBottom();
            }
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(container);
        ro.observe(content);
        return () => ro.disconnect();
    }, []);

    // 贴底判定按滚动方向：向上滚立即离底，不设距离阈值（流式高频置底时小步上滑会被反复拽回）；
    // 向下滚到底部附近恢复贴底。dist>1 排除 macOS 橡皮筋回弹与内容缩短时的 scrollTop 钳位被误判为上滑。
    useEffect(() => {
        const container = outputContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const top = container.scrollTop;
            const up = top < lastScrollTopRef.current;
            lastScrollTopRef.current = top;
            if (programmaticScrollRef.current) {
                programmaticScrollRef.current = false;
                return;
            }
            const dist = container.scrollHeight - top - container.clientHeight;
            if (up && dist > 1) {
                setStickState(false);
            } else if (!up && dist < 80) {
                setStickState(true);
            }
        };

        // wheel 在 scroll 事件之前触发,能在流式置底与用户滚动合并成一次 scroll 事件时保住用户的上划意图
        const handleWheel = (e: WheelEvent) => {
            if (e.deltaY < 0 && container.scrollHeight - container.clientHeight > 1) {
                setStickState(false);
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        container.addEventListener('wheel', handleWheel, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            container.removeEventListener('wheel', handleWheel);
        };
    }, []);

    const handleSend = (text: string, files: SelectedFile[], attachments: ImageAttachment[] = [], pastes: PasteAttachment[] = []) => {
        setStickState(true);
        setInputPrediction('');
        if (processingState !== 'processing') {
            setSpinnerAccumulatedSeconds(0);
            spinnerStartTimeRef.current = 0;
        }
        vscode.postMessage({
            type: 'sendInput',
            sessionId,
            text: text,
            files: files,
            attachments: attachments,
            pastes: pastes.length ? pastes : undefined
        });
    };

    const handleStop = () => {
        for (const item of dialogQueue) {
            if (!item.isBackground && item.type === 'permission') {
                vscode.postMessage({
                    type: 'insertPermissionRequest',
                    sessionId,
                    permissionData: {
                        agentId: item.data?.agentId || '',
                        toolName: item.data?.toolName || 'Unknown',
                        title: item.data?.title || '',
                        content: item.data?.content || '',
                        action: 'interrupted'
                    }
                });
            }
        }

        vscode.postMessage({ type: 'interrupt', sessionId });

        setTimeout(() => {
            inputBoxRef.current?.focus();
        }, 50);
    };

    const handleBashPermission = (action: string) => {
        const permData = activeDialog?.data;

        if (action !== 'agree' && action !== 'allow') {
            vscode.postMessage({
                type: 'insertPermissionRequest',
                sessionId,
                permissionData: {
                    agentId: permData?.agentId || '',
                    toolName: permData?.toolName || 'Unknown',
                    title: permData?.title || '',
                    content: permData?.content || '',
                    action: 'refuse',
                    refuseMessage: action !== 'refuse' ? action : undefined
                }
            });
        }

        setDialogQueue(prev => prev.slice(1));

        vscode.postMessage({
            type: 'toolPermissionResponse',
            sessionId,
            response: {
                toolId: permData?.toolId || '',
                toolName: permData?.toolName || TOOL_NAME_RUN_SHELL,
                selected: action
            }
        });

        if (action === 'refuse') {
            setTimeout(() => {
                inputBoxRef.current?.focus();
            }, 50);
        }
    };

    const handleCloseModelConfigReminder = () => {
        setModelReminderDismissed(true);
    };

    // 只打开配置页，不关闭提示卡片：卡片按模型列表实时派生，加好模型后自动消失；未加模型切回来时仍应可见
    const handleOpenConfig = () => {
        vscode.postMessage({ type: 'openConfig' });
    };

    const handleLanguageChange = (lang: Language) => {
        // 与配置页一致：先即时刷新当前 webview，再交给宿主持久化并同步其他面板。
        setLang(lang);
        vscode.postMessage({ type: 'updateLanguage', lang });
    };

    /** 未配置模型提示卡片：模型列表为空且未被用户关闭时显示，文案由组件自取 */
    const showModelReminder = modelInfoLoaded && availableModels.length === 0 && !modelReminderDismissed;
    const inputPlaceholder = inputPlaceholderMsg ?? (inputDisabled ? t('chat.initializing') : t('chat.inputPlaceholder'));

    const handleAgentModeChange = (mode: AgentMode) => {
        setAgentMode(mode);
        vscode.postMessage({
            type: 'updateAgentMode',
            sessionId,
            mode: mode
        });
    };

    const handlePermissionLevelChange = (level: PermissionLevel) => {
        setPermissionLevel(level);
        vscode.postMessage({
            type: 'updatePermissionLevel',
            sessionId,
            level
        });
    };

    const sealAskForm = (status: AskFormStatus, answers: string, values: AskFormValues) => {
        if (!activeDialog || activeDialog.type !== 'askForm') return;
        const askData = activeDialog.data;

        vscode.postMessage({
            type: 'insertAskFormRequest',
            sessionId,
            askFormData: {
                agentId: askData.agentId || '',
                data: askData,
                status,
                values,
            }
        });

        setDialogQueue(prev => prev.slice(1));

        vscode.postMessage({
            type: 'askFormResponse',
            sessionId,
            response: {
                agentId: askData.agentId || '',
                answers,
            }
        });
    };

    const handleAskFormSubmit = (answers: string, values: AskFormValues) => {
        sealAskForm('submitted', answers, values);
    };

    const handleAskFormSkip = (answers: string, values: AskFormValues) => {
        sealAskForm('skipped', answers, values);
    };

    const handlePlanExitSubmit = (selected: 'startEditing' | 'clearContextAndStart') => {
        const exitData = activeDialog?.data;

        setDialogQueue(prev => prev.slice(1));

        vscode.postMessage({
            type: 'planExitResponse',
            sessionId,
            response: {
                agentId: exitData?.agentId || '',
                selected: selected
            }
        });
    };

    const renderedContent = useMemo(() => {
        const shouldShowThinkingText = thinkingEnabled && showThinkingText;

        // 本轮新建/修改的可视化产物（attachments/<uuid>/*.html）：轮次结束后在消息末尾内联嵌入（避免半成品页面）
        const vizPathsOf = (items: Array<{ message: Message }>): string[] => {
            const out: string[] = [];
            for (const { message } of items) {
                if (message.type !== 'tool') continue;
                const name = getToolName(message);
                if (name !== TOOL_NAME_WRITE_FILE && name !== TOOL_NAME_PATCH_FILE) continue;
                const p = getToolTitle(message);
                if (p && isVizPath(p) && !out.includes(p)) out.push(p);
            }
            return out;
        };
        const renderVizEmbeds = (paths: string[]) => paths.map(p => (
            <div key={`viz:${p}`} className="msg-wrap">
                <VizEmbed path={p} vscode={vscode} />
            </div>
        ));

        if (!messages || messages.length === 0) {
            if (PREVIEW_MODE) {
                return groupMessages(getPreviewMessages(), { showThinkingText: shouldShowThinkingText }).map((item) => {
                    if (item.kind === 'group') {
                        return (
                            <div key={item.id} className="msg-wrap">
                                <GroupedToolBlock messages={item.messages} vscode={vscode} />
                            </div>
                        );
                    }

                    return (
                        <div key={item.message.id} className="msg-wrap">
                            <MessageItem
                                message={item.message}
                                shouldReportChange={false}
                                toolPermissionData={null}
                                vscode={vscode}
                                onFileChange={handleFileChange}
                                streamingAssistantId={null}
                                streamingToolId={null}
                                openAgentTaskId={null}
                                onAgentModalClose={() => {}}
                                showThinkingText={shouldShowThinkingText}
                            />
                        </div>
                    );
                });
            }
            if (modelName && availableModels.length > 0 && processingState !== 'processing') {
                if (agentMode === 'Design') {
                    return <DesignModeHint />;
                }
                return <Welcome />;
            }
            return null;
        }

        // 末尾的「仅思考、无正文」assistant 消息不算最后一个块：
        // Bash 块保持展开，直到出现正文或新的工具块才折叠
        let lastMessageId = '';
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.type === 'assistant') {
                const hasContent = streamingAssistantId === m.id
                    || !!(m.content?.content && m.content.content.trim());
                if (!hasContent) continue;
            }
            lastMessageId = m.id;
            break;
        }

        let lastUserInputIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'user') {
                lastUserInputIndex = i;
                break;
            }
        }

        // 按「轮次」分组：每条用户输入开启一组，后续消息归入同组。
        // 用户输入在组内 position:sticky 吸顶，被下一组顶替。
        const groups: Array<{ key: string; items: Array<{ message: Message; index: number }> }> = [];
        messages.forEach((message, index) => {
            if (message.type === 'user' || groups.length === 0) {
                groups.push({ key: message.id, items: [] });
            }
            groups[groups.length - 1].items.push({ message, index });
        });

        // 「分支到新聊天」挂在每一轮最后一条有正文的 assistant 消息上，且会话 idle
        // （无排队输入、无弹窗、无流式）。idle 时整轮已完整落盘，全量复制不会产生孤儿 tool_use，
        // 因此不限制该轮是否有工具调用。分支始终复制全量历史，按钮位置只是入口。
        const branchMessageIds = new Set<string>();
        const canBranchNow = processingState === 'idle'
            && pendingInputs.length === 0
            && !activeDialog
            && !streamingAssistantId;
        if (canBranchNow) {
            for (let gi = 0; gi < groups.length; gi++) {
                const group = groups[gi];
                if (group.items[0]?.message.type !== 'user') continue;
                // 中间轮次需要下一轮用户输入的 uuid 作为 core 截断锚点；
                // 旧历史恢复的消息无 uuid，无法截断，则该轮不显示按钮（最后一轮全量分支不受影响）
                const nextGroup = groups[gi + 1];
                if (nextGroup && !nextGroup.items[0]?.message.uuid) continue;
                for (let i = group.items.length - 1; i >= 0; i--) {
                    const m = group.items[i].message;
                    if (m.type === 'assistant' && m.content?.completed !== false
                        && !!(m.content?.content && m.content.content.trim())) {
                        branchMessageIds.add(m.id);
                        break;
                    }
                }
            }
        }

        // 非最后一轮后面已有下一轮的用户输入，轮末的终端命令数量不会再变，可以折叠成组
        return groups.map((group, gi) => (
            <div key={group.key} className="turn-group">
                {groupMessages(group.items.map(item => item.message), { streamingToolId, showThinkingText: shouldShowThinkingText, tailClosed: gi < groups.length - 1 }).map((item) => {
                    if (item.kind === 'group') {
                        const groupStartIndex = group.items[item.originalStartIndex].index;
                        return (
                            <div key={item.id} className="msg-wrap">
                                <GroupedToolBlock
                                    messages={item.messages}
                                    vscode={vscode}
                                    onFileChange={groupStartIndex > lastUserInputIndex ? handleFileChange : undefined}
                                />
                            </div>
                        );
                    }

                    const { message, index } = group.items[item.originalIndex];

                    // 思考阶段（无正文、未进入流式、且思考文本不展示）的 assistant 消息会渲染为空，
                    // 不输出空的 .msg-wrap，避免其 content-visibility 占位高度把下方 Spinner 顶下去再回弹。
                    if (message.type === 'assistant') {
                        const hasReasoning = shouldShowThinkingText && !!(message.reasoning && message.reasoning.trim());
                        const isStreaming = streamingAssistantId === message.id;
                        const hasContent = isStreaming || !!(message.content?.content && message.content.content.trim());
                        if (!hasReasoning && !hasContent) return null;
                    }

                    return (
                        <div
                            key={message.id}
                            className={`msg-wrap${message.type === 'user' ? ' msg-wrap--sticky-user' : ''}`}
                        >
                            <MessageItem
                                message={message}
                                shouldReportChange={index > lastUserInputIndex}
                                toolPermissionData={activeDialog}
                                vscode={vscode}
                                onFileChange={handleFileChange}
                                streamingAssistantId={streamingAssistantId}
                                streamingToolId={streamingToolId}
                                openAgentTaskId={activeDialog ? null : openAgentTaskId}
                                onAgentModalClose={() => setOpenAgentTaskId(null)}
                                showThinkingText={shouldShowThinkingText}
                                processingState={processingState}
                                onFork={handleFork}
                                isLastMessage={message.id === lastMessageId}
                                inLastTurn={gi === groups.length - 1}
                                canBranch={branchMessageIds.has(message.id)}
                                onBranch={handleBranch}
                            />
                        </div>
                    );
                })}
                {(gi < groups.length - 1 || processingState === 'idle') && renderVizEmbeds(vizPathsOf(group.items))}
            </div>
        ));
    }, [messages, modelName, availableModels, activeDialog, processingState, streamingAssistantId, streamingToolId, openAgentTaskId, agentMode, thinkingEnabled, showThinkingText, handleFork, handleBranch, pendingInputs]);

    return (
        <SessionContext.Provider value={sessionId}>
            <SessionActiveContext.Provider value={active}>
            <div className="chat-session" style={{ display: active ? 'flex' : 'none' }}>
                <div className="output-scroll-wrap">
                <div id="output-container" ref={outputContainerRef}>
                <div className="output-content" ref={outputContentRef}>
                    {renderedContent}
                    {progressMessage && (
                        <div className="output-line ai-response-block" id="progress-message">
                            {progressMessage}
                        </div>
                    )}
                    {isSpinnerVisible && (
                        <ProcessingSpinner
                            accumulatedSeconds={spinnerAccumulatedSeconds}
                            in_progress={todos.find(t => t.status === 'in_progress')?.progressText || ''}
                            next_progress={todos.find(t => t.status === 'pending')?.title || ''}
                        />
                    )}
                    {runningTasks.size > 0 && (() => {
                        const tasks = Array.from(runningTasks.values());
                        const bashCount = tasks.filter(t => t.type === TASK_TYPE_SHELL).length;
                        const agentCount = tasks.filter(t => t.type === TASK_TYPE_AGENT).length;
                        let label: string;
                        if (bashCount > 0 && agentCount > 0) {
                            label = `${tasks.length} background tasks`;
                        } else if (agentCount > 0) {
                            label = `${agentCount} background agent${agentCount > 1 ? 's' : ''}`;
                        } else {
                            label = `${bashCount} background bash${bashCount > 1 ? 'es' : ''}`;
                        }
                        return (
                            <div
                                className="running-tasks-bar"
                                onClick={() => {
                                    const latestTaskId = tasks[tasks.length - 1]?.taskId;
                                    vscode.postMessage({ type: 'openConfig', page: 'task', taskId: latestTaskId });
                                }}
                            >
                                <span className="running-task-dot" />
                                <span className="running-task-label">{label}</span>
                            </div>
                        );
                    })()}
                    {pendingInputs.map(p => (
                        <UserInputBlock
                            key={p.inputId}
                            pending
                            content={p.content}
                            attachments={p.attachments}
                            pastes={p.pastes}
                            source={p.source}
                            vscode={vscode}
                        />
                    ))}
                    {activeDialog?.type === 'quickchat' && (
                        <QuickChatDialog
                            data={activeDialog.data}
                            onClose={() => setDialogQueue(prev => prev.slice(1))}
                        />
                    )}
                    {forkDialog && (
                        <ForkDialog
                            preview={forkDialog.preview}
                            onConfirm={(restoreFiles) => {
                                vscode.postMessage({
                                    type: 'forkSession',
                                    sessionId,
                                    uuid: forkDialog.uuid,
                                    restoreFiles,
                                    reqId: `forkrun-${Date.now()}`
                                });
                            }}
                            onCancel={() => setForkDialog(null)}
                        />
                    )}
                    {activeDialog?.type === 'permission' && (
                        <PermissionDialog
                            permissionData={activeDialog.data}
                            onPermissionSelect={handleBashPermission}
                            onCancel={handleStop}
                            vscode={vscode}
                        />
                    )}
                    {activeDialog?.type === 'askForm' && (
                        <AskFormDialog
                            data={activeDialog.data}
                            onSubmit={handleAskFormSubmit}
                            onSkip={handleAskFormSkip}
                            onCancel={handleStop}
                        />
                    )}
                    {activeDialog?.type === 'planExit' && (
                        <PlanExitDialog
                            data={activeDialog.data}
                            onSubmit={handlePlanExitSubmit}
                            onCancel={handleStop}
                            vscode={vscode}
                        />
                    )}
                    {showModelReminder && (
                        <ModelConfigReminder
                            visible
                            onClose={handleCloseModelConfigReminder}
                            onOpenConfig={handleOpenConfig}
                            onLanguageChange={handleLanguageChange}
                        />
                    )}
                    {PREVIEW_MODE && <PreviewDialogs vscode={vscode} />}
                </div>
                </div>
                {/* 回到底部：内容超出一屏且离底时悬浮显示；运行中换成三点动画表示仍在生成 */}
                {overflow && !stick && (
                    <button
                        className="scroll-bottom-btn"
                        title={t('chat.scrollBottom')}
                        onClick={handleScrollBottomClick}
                    >
                        {processingState === 'processing' ? (
                            <span className="run-dots"><i /><i /><i /></span>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" />
                            </svg>
                        )}
                    </button>
                )}
                </div>
                <TodosPanel todos={todos} onScrollToBottom={scrollToBottom} />
                <FileChangesPanel changes={fileChanges} vscode={vscode} onScrollToBottom={scrollToBottom} />
                <InputBox
                    ref={inputBoxRef}
                    vscode={vscode}
                    disabled={inputDisabled}
                    placeholder={inputPlaceholder}
                    isGenerating={processingState === 'processing'}
                    showBashPermission={!!activeDialog}
                    onSend={handleSend}
                    onStop={handleStop}
                    tokenInfo={tokenInfo}
                    modelName={modelName}
                    availableModels={availableModels}
                    agentMode={agentMode}
                    onAgentModeChange={handleAgentModeChange}
                    permissionLevel={permissionLevel}
                    onPermissionLevelChange={handlePermissionLevelChange}
                    prediction={inputPrediction}
                />
            </div>
            </SessionActiveContext.Provider>
        </SessionContext.Provider>
    );
};

/**
 * 顶层应用：管理多会话 tab 与会话集合。
 * 每个会话渲染一个常驻挂载的 ChatSession，非 active 时隐藏。
 */
const App: React.FC<AppProps> = ({ vscode }) => {
    const t = useT();
    const [sessions, setSessions] = useState<SessionMeta[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [errorBanner, setErrorBanner] = useState<string>('');
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showError = useCallback((msg: string) => {
        setErrorBanner(msg);
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setErrorBanner(''), 4000);
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'sessionOpened':
                    setSessions(prev => {
                        if (prev.some(s => s.id === message.sessionId)) {
                            return prev.map(s => s.id === message.sessionId
                                ? { ...s, title: message.title || s.title }
                                : s);
                        }
                        return [...prev, { id: message.sessionId, title: message.title || t('common.newSession'), processing: false, waiting: false, isClaw: !!message.isClaw }];
                    });
                    setActiveId(message.sessionId);
                    break;
                case 'sessionClosed':
                    streamingStore.clear(message.sessionId);
                    setSessions(prev => prev.filter(s => s.id !== message.sessionId));
                    setActiveId(prev => (prev === message.sessionId ? (message.nextActiveId ?? null) : prev));
                    break;
                case 'sessionCreateFailed':
                    showError(message.error || t('chat.createSessionFailed'));
                    break;
                case 'sessionTitleUpdate':
                    setSessions(prev => prev.map(s => s.id === message.sessionId
                        ? { ...s, title: message.title || s.title }
                        : s));
                    break;
                case 'switchToSession':
                    setActiveId(message.sessionId);
                    break;
                case 'stateUpdate':
                    if (message.sessionId) {
                        setSessions(prev => prev.map(s => s.id === message.sessionId
                            ? { ...s, processing: message.state === 'processing' }
                            : s));
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ type: 'frontendReady' });

        return () => {
            window.removeEventListener('message', handleMessage);
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        };
    }, []);

    const handleSwitch = (id: string) => {
        setActiveId(id);
        vscode.postMessage({ type: 'switchSession', sessionId: id });
    };

    const handleClose = (id: string) => {
        vscode.postMessage({ type: 'closeSession', sessionId: id });
    };

    const handleWaitingChange = useCallback((id: string, waiting: boolean) => {
        setSessions(prev => prev.map(s =>
            s.id === id && s.waiting !== waiting ? { ...s, waiting } : s
        ));
    }, []);

    return (
        <>
            <SessionTabs
                sessions={sessions}
                activeId={activeId}
                onSwitch={handleSwitch}
                onClose={handleClose}
            />
            {errorBanner && (
                <div className="session-error-banner" onClick={() => setErrorBanner('')}>
                    {errorBanner}
                </div>
            )}
            <div className="sessions-host">
                {sessions.map(s => (
                    <ChatSession
                        key={s.id}
                        vscode={vscode}
                        sessionId={s.id}
                        active={s.id === activeId}
                        onWaitingChange={handleWaitingChange}
                    />
                ))}
            </div>
        </>
    );
};

export default App;
