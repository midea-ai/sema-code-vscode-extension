import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FileChange, TokenInfo, AppProps, SelectedFile, TodoItem, Message, AgentMode } from './types';
import { streamingStore } from './utils/StreamingStore';
import InputBox, { InputBoxHandle } from './components/input/InputBox';
import MessageItem from './MessageItem';

import FileChangesPanel from './components/panels/FileChangesPanel';
import TodosPanel from './components/panels/TodosPanel';
import Welcome from './components/panels/Welcome';
import DesignModeHint from './components/panels/DesignModeHint';
import PermissionDialog from './components/permission/PermissionDialog';
import AskFormDialog, { AskFormValues, AskFormStatus, PickOptionRequestData } from './components/ui/AskFormDialog';
import PlanExitDialog from './components/ui/PlanExitDialog';
import QuickChatDialog from './components/ui/QuickChatDialog';
import ProcessingSpinner from './components/ui/ProcessingSpinner';
import ModelConfigReminder from './components/ui/ModelConfigReminder';
import { PREVIEW_MODE, getPreviewMessages, mockDialogMap, isPreviewActive } from './utils/mockMessages';
import { TOOL_NAME_RUN_SHELL } from '../../utils/tool';
import { TASK_TYPE_SHELL, TASK_TYPE_AGENT } from '../config/BackgroundTaskConfig';
import PreviewDialogs from './utils/PreviewDialogs';

const App: React.FC<AppProps> = ({ vscode }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
    const [streamingToolId, setStreamingToolId] = useState<string | null>(null);
    const streamingAssistantIdRef = useRef<string | null>(null);
    const streamingToolIdRef = useRef<string | null>(null);
    const messagesRef = useRef<Message[]>([]);
    const [progressMessage, setProgressMessage] = useState<string>('');
    const [tokenInfo, setTokenInfo] = useState<TokenInfo>({ useTokens: 0, maxTokens: 0, promptTokens: 0 });
    const [inputDisabled, setInputDisabled] = useState<boolean>(true);
    const [inputPlaceholder, setInputPlaceholder] = useState<string>('正在初始化 CLI，请稍候...');
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
    const [modelConfigReminder, setModelConfigReminder] = useState<string>('');
    const [spinnerAccumulatedSeconds, setSpinnerAccumulatedSeconds] = useState<number>(0);
    const [agentMode, setAgentMode] = useState<AgentMode>('Agent');
    const [autoEdit, setAutoEdit] = useState<boolean>(false);
    const [skipFileEditPermission, setSkipFileEditPermission] = useState<boolean>(false);
    const [pendingInputs, setPendingInputs] = useState<Array<{ inputId: string; content: string }>>([]);
    const [runningTasks, setRunningTasks] = useState<Map<string, { taskId: string; filepath: string; type: string; startTime: number }>>(new Map());
    const [openAgentTaskId, setOpenAgentTaskId] = useState<string | null>(null);

    const outputContainerRef = useRef<HTMLDivElement>(null);
    const inputBoxRef = useRef<InputBoxHandle>(null);
    const userScrolledUpRef = useRef<boolean>(false);
    const spinnerStartTimeRef = useRef<number>(0);
    const runningTasksRef = useRef(runningTasks);
    const prevMessagesLenRef = useRef<number>(0);

    const handleFileChange = useCallback(async (change: FileChange) => {
        // console.log('app触发handleFileChange')
        try {
            // 先添加到文件变更列表，后续当取得统计信息时再更新
            setFileChanges(prev => {
                // 使用完整路径作为唯一标识
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
                    // 新添加文件变更
                    return [...prev, {
                        ...change,
                        additions: 0,
                        removals: 0,
                        minLine: change.minLine || 1
                    }];
                }
            });

            // 如果有文件路径，调用后端获取详细统计信息
            if (change.fullPath) {
                // console.log('app发送fileChangeStats请求')
                // 调用后端方法获取文件统计信息
                vscode.postMessage({
                    type: 'getFileChangeStats',
                    filePath: change.fullPath
                });
                // 当收到响应时，我们将在 handleMessage 函数中处理
            }
        } catch (error) {
            console.error('handleFileChange error:', error);
        }
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.type) {
                case 'updateContent':
                   // console.log('updateContent:', message)
                    streamingStore.clear();
                    // 会话已被替换，旧的 streaming 指针不能再指向新列表中的同 id 消息，
                    // 否则切回历史时会让一条已持久化的消息被错误地标记为 streaming，
                    // 订阅到已清空的 buffer，最终只渲染出 ⏺ 指示符。
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
                    // 只转发 delta 到 streamingStore，组件自行累积；completeUpdate 时设置最终内容
                    streamingStore.emitText(message.id, { contentDelta: message.contentDelta, reasoningDelta: message.reasoningDelta });
                    // 只在有 contentDelta 时才标记 streaming，避免 thinking 阶段提前渲染 AiResponseBlock
                    if (message.contentDelta !== undefined && streamingAssistantIdRef.current !== message.id) {
                        streamingAssistantIdRef.current = message.id;
                        setStreamingAssistantId(message.id);
                    }
                    if (!userScrolledUpRef.current && outputContainerRef.current) {
                        outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
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
                    // 只转发 delta 到 streamingStore，组件自行累积；updateMessage 时设置最终内容
                    streamingStore.emitTool(message.id, message.contentDelta || '');
                    if (streamingToolIdRef.current !== message.id) {
                        streamingToolIdRef.current = message.id;
                        setStreamingToolId(message.id);
                    }
                    if (!userScrolledUpRef.current && outputContainerRef.current) {
                        outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
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
                    setInputPlaceholder('请输入需求...(/ 指令 | Enter 发送 | Shift+Enter 换行 | ↑↓ 历史)');
                    vscode.postMessage({ type: 'requestSystemConfig' });
                    break;
                case 'disableInput':
                    setInputDisabled(true);
                    setInputPlaceholder(message.message || '正在初始化 CLI，请稍候...');
                    break;
                case 'fileChange':
                    // 接收文件变更信息
                    handleFileChange(message.change);
                    break;
                case 'fileChangeStats':
                    // console.log('app接收fileChangeStats结果')
                    // 接收文件变更统计信息
                    if (message.fullPath && message.stats) {
                        setFileChanges(prev => {
                            const existingIndex = prev.findIndex(c => c.fullPath === message.fullPath);
                            if (existingIndex >= 0) {
                                // 更新现有文件的统计
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
                    // 清空文件变更列表
                    setFileChanges([]);
                    break;
                case 'removeFileChange':
                    // 移除单个文件变更
                    if (message.filePath) {
                        setFileChanges(prev => prev.filter(c => c.fullPath !== message.filePath));
                    }
                    break;
                case 'todosUpdate':
                    // 更新 todos 列表 - 直接使用 SemaCore 的格式
                    if (Array.isArray(message.todos)) {
                        setTodos(message.todos);
                    }
                    break;
                case 'clearTodos':
                    // 清空 todos 列表
                    setTodos([]);
                    break;
                case 'updateModelInfo':
                    // 更新模型信息（包含当前模型和可用模型列表）
                    setModelName(message.modelName || '');
                    setAvailableModels(message.availableModels || []);
                    break;
                case 'modelUpdate':
                    // 处理来自后端的模型更新事件（支持旧格式）
                    if (message.data) {
                        setModelName(message.data.modelName || '');
                        setAvailableModels(message.data.modelList || []);
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
                case 'showModelConfigReminder':
                    // 显示模型配置提醒
                    setModelConfigReminder(message.message || '');
                    break;
                case 'resetTokenInfo':
                    // 重置token信息（新会话时调用）
                    setTokenInfo({ useTokens: 0, maxTokens: 0, promptTokens: 0 });
                    break;
                case 'agentModeUpdate':
                    // 接收后端的模式更新（例如退出Plan模式后自动切换回Agent模式）
                    if (message.mode) {
                        setAgentMode(message.mode);
                    }
                    break;
                case 'systemConfigUpdate':
                    if (typeof message.skipFileEditPermission === 'boolean') {
                        setSkipFileEditPermission(message.skipFileEditPermission);
                    }
                    break;
                case 'autoEditUpdate':
                    if (typeof message.enable === 'boolean') {
                        setAutoEdit(message.enable);
                    }
                    break;
                case 'inputReceived':
                    if (message.data) {
                        setPendingInputs(prev => [...prev, {
                            inputId: message.data.inputId,
                            content: message.data.originalInput || message.data.input
                        }]);
                    }
                    break;
                case 'inputProcessing':
                    if (message.data) {
                        setPendingInputs(prev => prev.filter(p => p.inputId !== message.data.inputId));
                    }
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
            }
        };

        window.addEventListener('message', handleMessage);

        // 在消息监听器设置完成后，通知后端前端已准备就绪
        vscode.postMessage({
            type: 'frontendReady'
        });

        // 请求模型信息
        vscode.postMessage({
            type: 'requestModelInfo'
        });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    // 保持 runningTasksRef 与 state 同步，供 handleMessage 闭包读取
    useEffect(() => { runningTasksRef.current = runningTasks; }, [runningTasks]);

    // 只有 spinner 真正可见时才累计计时，隐藏时暂停
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
        scrollToBottom();
        // 只在消息数量增加时应用代码高亮，避免全量遍历
        if (window.hljs && outputContainerRef.current && messages.length > prevMessagesLenRef.current) {
            outputContainerRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                window.hljs.highlightElement(block);
            });
        }
        prevMessagesLenRef.current = messages.length;
    }, [messages]);

    // 预览模式：首次渲染后对 mock 消息中的代码块应用高亮
    useEffect(() => {
        if (PREVIEW_MODE && window.hljs && outputContainerRef.current) {
            outputContainerRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                window.hljs.highlightElement(block);
            });
        }
    }, []);

    // 当弹窗切换时滚动到底部，权限对话框还需应用代码高亮
    useEffect(() => {
        if (activeDialog && outputContainerRef.current) {
            setTimeout(() => {
                if (outputContainerRef.current) {
                    outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
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

    const isUserAtBottom = (): boolean => {
        if (!outputContainerRef.current) return true;
        const threshold = 100;
        const position = outputContainerRef.current.scrollTop + outputContainerRef.current.clientHeight;
        const bottom = outputContainerRef.current.scrollHeight;
        return bottom - position < threshold;
    };

    const scrollToBottom = () => {
        if (!userScrolledUpRef.current && outputContainerRef.current) {
            outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
        }
    };

    useEffect(() => {
        const container = outputContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            if (isUserAtBottom()) {
                userScrolledUpRef.current = false;
            } else {
                userScrolledUpRef.current = true;
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    const handleSend = (text: string, files: SelectedFile[]) => {
        // 重置滚动状态，让新消息自动滚到底部
        userScrolledUpRef.current = false;
        if (processingState !== 'processing') {
            // 只有在非处理状态时才重置计时
            setSpinnerAccumulatedSeconds(0);
            spinnerStartTimeRef.current = 0;
        }
        vscode.postMessage({
            type: 'sendInput',
            text: text,
            files: files
        });
    };

    const handleStop = () => {
        console.log('[handleStop] fired, processingState =', processingState, 'dialogQueue len =', dialogQueue.length);
        // 为队列中所有前台权限弹窗插入"已中断"记录到消息历史
        for (const item of dialogQueue) {
            if (!item.isBackground && item.type === 'permission') {
                vscode.postMessage({
                    type: 'insertPermissionRequest',
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

        // 中断前台 + 停掉所有后台任务，后端统一处理
        vscode.postMessage({ type: 'interrupt' });

        // 中断后聚焦输入框
        setTimeout(() => {
            inputBoxRef.current?.focus();
        }, 50);
    };

    const handleBashPermission = (action: string) => {
        const permData = activeDialog?.data;

        // 如果用户拒绝，将权限请求插入到消息历史中
        if (action !== 'agree' && action !== 'allow') {
            vscode.postMessage({
                type: 'insertPermissionRequest',
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

        // 出队，显示下一个弹窗
        setDialogQueue(prev => prev.slice(1));

        // 发送工具权限响应给后端
        vscode.postMessage({
            type: 'toolPermissionResponse',
            response: {
                toolId: permData?.toolId || '',
                toolName: permData?.toolName || TOOL_NAME_RUN_SHELL,
                selected: action
            }
        });

        // 拒绝后聚焦于输入框
        if (action === 'refuse') {
            setTimeout(() => {
                inputBoxRef.current?.focus();
            }, 50);
        }
    };

    const handleCloseModelConfigReminder = () => {
        setModelConfigReminder('');
    };

    const handleOpenConfig = () => {
        vscode.postMessage({
            type: 'openConfig'
        });
        setModelConfigReminder('');
    };

    const handleAgentModeChange = (mode: AgentMode) => {
        const requireNewSession = mode === 'Design' || agentMode === 'Design';
        setAgentMode(mode);
        vscode.postMessage({
            type: requireNewSession ? 'switchAgentModeWithNewSession' : 'updateAgentMode',
            mode: mode
        });
    };

    const handleAutoEditChange = (enable: boolean) => {
        vscode.postMessage({
            type: 'updateAutoEdit',
            enable
        });
    };

    const sealAskForm = (status: AskFormStatus, answers: string, values: AskFormValues) => {
        if (!activeDialog || activeDialog.type !== 'askForm') return;
        const askData = activeDialog.data;

        vscode.postMessage({
            type: 'insertAskFormRequest',
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

        // 出队，显示下一个弹窗
        setDialogQueue(prev => prev.slice(1));

        vscode.postMessage({
            type: 'planExitResponse',
            response: {
                agentId: exitData?.agentId || '',
                selected: selected
            }
        });
    };

    const renderedContent = useMemo(() => {
        if (!messages || messages.length === 0) {
            // 预览模式：渲染 mock 消息，方便调试各组件样式对齐
            if (PREVIEW_MODE) {
                return getPreviewMessages().map((message) => (
                    <div key={message.id} className="msg-wrap">
                        <MessageItem
                            message={message}
                            shouldReportChange={false}
                            toolPermissionData={null}
                            vscode={vscode}
                            onFileChange={handleFileChange}
                            streamingAssistantId={null}
                            streamingToolId={null}
                            openAgentTaskId={null}
                            onAgentModalClose={() => {}}
                        />
                    </div>
                ));
            }
            // 只有在有模型配置信息且当前不在处理状态时才显示Welcome组件
            // 处理中时隐藏Welcome，避免Linux上后端响应延迟导致Welcome和Spinner同时显示
            if (modelName && availableModels.length > 0 && processingState !== 'processing') {
                if (agentMode === 'Design') {
                    return <DesignModeHint />;
                }
                return <Welcome />;
            }
            return null;
        }

        // 找到最后一个用户输入的索引
        let lastUserInputIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'user') {
                lastUserInputIndex = i;
                break;
            }
        }

        return messages.map((message, index) => (
            <div key={message.id} className="msg-wrap">
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
                />
            </div>
        ));
    }, [messages, modelName, availableModels, activeDialog, processingState, streamingAssistantId, streamingToolId, openAgentTaskId, agentMode]);

    return (
        <>
            <div id="output-container" ref={outputContainerRef}>
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
                    <div key={p.inputId} className="user-input-block pending">
                        <div className="user-input-content pending">{p.content}</div>
                    </div>
                ))}
                {activeDialog?.type === 'quickchat' && (
                    <QuickChatDialog
                        data={activeDialog.data}
                        onClose={() => setDialogQueue(prev => prev.slice(1))}
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
                {modelConfigReminder && (
                    <ModelConfigReminder
                        message={modelConfigReminder}
                        onClose={handleCloseModelConfigReminder}
                        onOpenConfig={handleOpenConfig}
                    />
                )}
                {PREVIEW_MODE && <PreviewDialogs vscode={vscode} />}
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
                autoEdit={autoEdit}
                skipFileEditPermission={skipFileEditPermission}
                onAutoEditChange={handleAutoEditChange}
            />
        </>
    );
};

export default App;
