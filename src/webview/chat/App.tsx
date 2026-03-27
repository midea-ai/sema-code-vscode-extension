import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FileChange, TokenInfo, AppProps, SelectedFile, TodoItem, Message } from './types';
import InputBox, { InputBoxHandle } from './components/input/InputBox';

import EditBlock from './blocks/tools/EditBlock';
import NotebookEditBlock from './blocks/tools/NotebookEditBlock';
import ReadBlock from './blocks/tools/ReadBlock';
import PubBlock from './blocks/tools/PubBlock';
import BashBlock from './blocks/tools/BashBlock';
import TaskBlock from './blocks/tools/TaskBlock';
import ToolErrorBlock from './blocks/ToolErrorBlock';
import FileChangesPanel from './components/panels/FileChangesPanel';
import TodosPanel from './components/panels/TodosPanel';
import UserInputBlock from './blocks/UserInputBlock';
import AiResponseBlock from './blocks/AiResponseBlock';
import ThoughtBlock from './blocks/ThoughtBlock';
import Welcome from './components/panels/Welcome';
import PermissionDialog from './components/permission/PermissionDialog';
import AskQuestionDialog from './components/ui/AskQuestionDialog';
import PlanExitDialog from './components/ui/PlanExitDialog';
import PlanImplementPanel from './components/ui/PlanImplementPanel';
import SupplementaryInfo from './components/ui/SupplementaryInfo';
import PermissionRequestBlock from './components/permission/PermissionRequestBlock';
import ProcessingSpinner from './components/ui/ProcessingSpinner';
import ModelConfigReminder from './components/ui/ModelConfigReminder';

const App: React.FC<AppProps> = ({ vscode }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [progressMessage, setProgressMessage] = useState<string>('');
    const [tokenInfo, setTokenInfo] = useState<TokenInfo>({ useTokens: 0, maxTokens: 0, promptTokens: 0 });
    const [inputDisabled, setInputDisabled] = useState<boolean>(true);
    const [inputPlaceholder, setInputPlaceholder] = useState<string>('正在初始化 CLI，请稍候...');
    const [processingState, setProcessingState] = useState<'idle' | 'processing'>('idle');
    const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
    const [todos, setTodos] = useState<TodoItem[]>([]);
    const [modelName, setModelName] = useState<string>('');
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [toolPermissionData, setToolPermissionData] = useState<any>(null);
    const [askQuestionData, setAskQuestionData] = useState<any>(null);
    const [planExitData, setPlanExitData] = useState<any>(null);
    const [modelConfigReminder, setModelConfigReminder] = useState<string>('');
    const [projectInputHistory, setProjectInputHistory] = useState<string[]>([]);
    const [spinnerAccumulatedSeconds, setSpinnerAccumulatedSeconds] = useState<number>(0);
    const [agentMode, setAgentMode] = useState<'Agent' | 'Plan'>('Agent');
    const [pendingInputs, setPendingInputs] = useState<Array<{ inputId: string; content: string }>>([]);

    const outputContainerRef = useRef<HTMLDivElement>(null);
    const inputBoxRef = useRef<InputBoxHandle>(null);
    const userScrolledUpRef = useRef<boolean>(false);
    const spinnerStartTimeRef = useRef<number>(0);

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
                    setMessages(message.messages || []);
                    break;
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
                    // 处理工具权限请求（如果是bash工具，显示权限对话框）
                    if (message.data) {
                        setToolPermissionData(message.data);
                    }
                    break;
                case 'closePermissionPanel':
                    // 关闭权限申请面板
                    setToolPermissionData(null);
                    break;
                case 'askQuestionRequest':
                    // 处理问答请求
                    if (message.data) {
                        setAskQuestionData(message.data);
                    }
                    break;
                case 'closeAskQuestionPanel':
                    // 关闭问答面板
                    setAskQuestionData(null);
                    break;
                case 'planExitRequest':
                    // 处理退出Plan模式请求
                    if (message.data) {
                        setPlanExitData(message.data);
                    }
                    break;
                case 'closePlanExitPanel':
                    // 关闭退出Plan模式面板
                    setPlanExitData(null);
                    break;
                case 'showModelConfigReminder':
                    // 显示模型配置提醒
                    setModelConfigReminder(message.message || '');
                    break;
                case 'initializeInputHistory':
                    // 初始化输入历史数据
                    if (message.projectInputHistory && Array.isArray(message.projectInputHistory)) {
                        // console.log('Received project input history:', message.projectInputHistory);
                        setProjectInputHistory(message.projectInputHistory);
                    }
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

    // 只有 spinner 真正可见时才累计计时，隐藏时暂停
    const isSpinnerVisible = processingState === 'processing' && !progressMessage && !toolPermissionData && !askQuestionData && !planExitData;

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
        // 应用代码高亮
        if (window.hljs) {
            outputContainerRef.current?.querySelectorAll('pre code').forEach((block) => {
                // 只对未高亮的元素进行高亮处理，避免 "Element previously highlighted" 警告
                if (!block.classList.contains('hljs')) {
                    window.hljs.highlightElement(block);
                }
            });
        }
    }, [messages]);

    // 当显示权限对话框时，确保对话框完全可见并应用代码高亮
    useEffect(() => {
        if (toolPermissionData && outputContainerRef.current) {
            // 延迟一小段时间确保DOM已更新
            setTimeout(() => {
                if (outputContainerRef.current) {
                    outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;

                    // 应用代码高亮到权限对话框中的代码块
                    if (window.hljs) {
                        outputContainerRef.current.querySelectorAll('pre code').forEach((block) => {
                            if (!block.classList.contains('hljs')) {
                                window.hljs.highlightElement(block);
                            }
                        });
                    }
                }
            }, 50);
        }
    }, [toolPermissionData]);

    // 当显示问答对话框时，确保对话框完全可见
    useEffect(() => {
        if (askQuestionData && outputContainerRef.current) {
            setTimeout(() => {
                if (outputContainerRef.current) {
                    outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
                }
            }, 50);
        }
    }, [askQuestionData]);

    // 当显示退出Plan模式对话框时，确保对话框完全可见
    useEffect(() => {
        if (planExitData && outputContainerRef.current) {
            setTimeout(() => {
                if (outputContainerRef.current) {
                    outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
                }
            }, 50);
        }
    }, [planExitData]);

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
            // 只有在非处理状态时才重置计时和清空列表
            setSpinnerAccumulatedSeconds(0);
            spinnerStartTimeRef.current = 0;
            setTodos([]);
        }
        vscode.postMessage({
            type: 'sendInput',
            text: text,
            files: files
        });
    };

    const handleStop = () => {
        // 如果当前显示权限面板，将权限请求插入到消息历史中，然后隐藏它
        if (toolPermissionData) {
            vscode.postMessage({
                type: 'insertPermissionRequest',
                permissionData: {
                    agentId: toolPermissionData?.agentId || '',
                    toolName: toolPermissionData?.toolName || 'Unknown',
                    title: toolPermissionData?.title || '',
                    content: toolPermissionData?.content || '',
                    action: 'interrupted'
                }
            });
            setToolPermissionData(null);
        }
        // 如果当前显示问答面板，关闭它
        if (askQuestionData) {
            setAskQuestionData(null);
        }
        // 如果当前显示退出Plan模式面板，关闭它
        if (planExitData) {
            setPlanExitData(null);
        }
        vscode.postMessage({
            type: 'interrupt'
        });

        // 中断后聚焦于输入框
        setTimeout(() => {
            inputBoxRef.current?.focus();
        }, 50);
    };

    const handleBashPermission = (action: string) => {
        // console.log(`bashPermission触发: ${action}`);

        // 如果用户拒绝，将权限请求插入到消息历史中
        if (action !== 'agree' && action !== 'allow') {
            vscode.postMessage({
                type: 'insertPermissionRequest',
                permissionData: {
                    agentId: toolPermissionData?.agentId || '',
                    toolName: toolPermissionData?.toolName || 'Unknown',
                    title: toolPermissionData?.title || '',
                    content: toolPermissionData?.content || '',
                    action: 'refuse',
                    refuseMessage: action !== 'refuse' ? action : undefined
                }
            });
        }

        // 隐藏权限对话框
        setToolPermissionData(null);

        // 构建工具权限响应对象，使用后端期望的格式
        const toolPermissionResponse = {
            toolName: toolPermissionData?.toolName || 'Bash',
            selected: action  // 直接使用 action 值：'agree'、'allow' 或 'refuse'
        };

        // 发送工具权限响应给后端
        vscode.postMessage({
            type: 'toolPermissionResponse',
            response: toolPermissionResponse
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

    const handleAgentModeChange = (mode: 'Agent' | 'Plan') => {
        setAgentMode(mode);
        vscode.postMessage({
            type: 'updateAgentMode',
            mode: mode
        });
    };

    const handleAskQuestionSubmit = (answers: Record<string, string>) => {
        // console.log('Ask question submit:', answers);

        // 隐藏问答对话框
        setAskQuestionData(null);

        // 发送问答响应给后端
        vscode.postMessage({
            type: 'askQuestionResponse',
            response: {
                agentId: askQuestionData?.agentId || '',
                answers: answers
            }
        });
    };

    const handlePlanExitSubmit = (selected: 'startEditing' | 'clearContextAndStart') => {
        // console.log('Plan exit submit:', selected);

        // 隐藏退出Plan模式对话框
        setPlanExitData(null);

        // 发送退出Plan模式响应给后端
        vscode.postMessage({
            type: 'planExitResponse',
            response: {
                agentId: planExitData?.agentId || '',
                selected: selected
            }
        });
    };

    // 工具消息渲染函数
    const renderToolMessage = useCallback((
        message: Message,
        key: string,
        shouldReportChange: boolean,
        forceClose?: boolean
    ) => {

        // 根据工具类型选择组件
        switch (message.toolName) {
            case 'Write':
            case 'Edit':
                return (
                    <EditBlock
                        key={key}
                        content={message.content}
                        vscode={vscode}
                        onFileChange={shouldReportChange ? handleFileChange : undefined}
                    />
                );

            case 'NotebookEdit':
                return (
                    <NotebookEditBlock
                        key={key}
                        content={message.content}
                        vscode={vscode}
                        onFileChange={shouldReportChange ? handleFileChange : undefined}
                    />
                );

            case 'TodoWrite':
                return;

            case 'Read':
            case 'NotebookRead':
                return <ReadBlock key={key} content={message.content} vscode={vscode} />;

            case 'Bash':
                return <BashBlock key={key} content={message.content} vscode={vscode} />;

            case 'Task':
                return (
                    <TaskBlock
                        key={key}
                        content={message.content}
                        vscode={vscode}
                        forceClose={forceClose}
                    />
                );

            default:
                return <PubBlock key={key} content={message.content} vscode={vscode} />;

        }
    }, [vscode, handleFileChange]);

    // 使用 useMemo 缓存渲染内容，避免不必要的重新计算
    const renderedContent = useMemo(() => {
        if (!messages || messages.length === 0) {
            // 只有在有模型配置信息且当前不在处理状态时才显示Welcome组件
            // 处理中时隐藏Welcome，避免Linux上后端响应延迟导致Welcome和Spinner同时显示
            if (modelName && availableModels.length > 0 && processingState !== 'processing') {
                return <Welcome />;
            }
            // 没有模型配置信息或正在处理时返回null，不显示Welcome组件
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

        return messages.map((message, index) => {
            const key = message.id;
            const shouldReportChange = index > lastUserInputIndex;

            switch (message.type) {
                case 'user':
                    return <UserInputBlock key={key} content={message.content} />;
                case 'assistant':
                    // 检查是否有 reasoning（思考过程）
                    const hasReasoning = !!(message.reasoning && message.reasoning.trim().length > 0);
                    const hasContent = message.content && message.content.content && message.content.content.trim().length > 0;
                    // 判断是否处于 thinking 阶段：有 reasoning 但还没有 text content 且未完成
                    const isThinking = hasReasoning && !hasContent && !message.content.completed;

                    return (
                        <React.Fragment key={key}>
                            {/* 渲染思考过程（如果存在） */}
                            {hasReasoning && (
                                <ThoughtBlock
                                    content={message.reasoning || ''}
                                    isThinking={isThinking}
                                />
                            )}

                            {/* 渲染 AI 响应内容（只有当有内容时才渲染） */}
                            {hasContent && (
                                <AiResponseBlock
                                    content={message.content.content}
                                    isStreaming={!message.content.completed}
                                    vscode={vscode}
                                />
                            )}
                        </React.Fragment>
                    );

                case 'tool':
                    return renderToolMessage(message, key, shouldReportChange, !!toolPermissionData);

                case 'permission_request':
                    return (
                        <PermissionRequestBlock
                            key={key}
                            permissionData={message.content}
                        />
                    );

                case 'system':
                    if (message.content.type === 'interrupted') {
                        const USER_INTERRUPT_MESSAGE = '[Request interrupted by user]';
                        if (message.content.content === USER_INTERRUPT_MESSAGE) {
                            return <SupplementaryInfo key={key} items={['interrupted']} />;
                        }
                        return null;
                    }
                    else if (message.content.type === 'tool_error') {
                        return (
                            <ToolErrorBlock
                                key={key}
                                toolName={message.content.toolName || ''}
                                title={message.content.title || ''}
                                content={message.content.content || ''}
                            />
                        );
                    }
                    else if (['compact', 'clear', 'session_error'].includes(message.content.type)) {
                        return <SupplementaryInfo key={key} items={[message.content.content]} />
                    }
                    else if (message.content.type === 'file_reference') {
                        return <SupplementaryInfo key={key} items={message.content.content || []} />
                    }
                    else if (message.content.type === 'plan_implement') {
                        return (
                            <PlanImplementPanel
                                key={key}
                                planFilePath={message.content.planFilePath}
                                planContent={message.content.planContent}
                                vscode={vscode}
                            />
                        );
                    }

                default:
                    return null;
            }
        });
    }, [messages, modelName, availableModels, toolPermissionData, processingState]);

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
                        in_progress={todos.find(t => t.status === 'in_progress')?.activeForm || ''}
                        next_progress={todos.find(t => t.status === 'pending')?.content || ''}
                    />
                )}
                {pendingInputs.map(p => (
                    <div key={p.inputId} className="user-input-block pending">
                        <div className="user-input-content pending">{p.content}</div>
                    </div>
                ))}
                {toolPermissionData && (
                    <PermissionDialog
                        permissionData={toolPermissionData}
                        onPermissionSelect={handleBashPermission}
                        onCancel={handleStop}
                        vscode={vscode}
                    />
                )}
                {askQuestionData && (
                    <AskQuestionDialog
                        data={askQuestionData}
                        onSubmit={handleAskQuestionSubmit}
                        onCancel={handleStop}
                    />
                )}
                {planExitData && (
                    <PlanExitDialog
                        data={planExitData}
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
            </div>
            <TodosPanel todos={todos} />
            <FileChangesPanel changes={fileChanges} vscode={vscode} />
            <InputBox
                ref={inputBoxRef}
                vscode={vscode}
                disabled={inputDisabled}
                placeholder={inputPlaceholder}
                isGenerating={processingState === 'processing'}
                showBashPermission={!!toolPermissionData}
                onSend={handleSend}
                onStop={handleStop}
                tokenInfo={tokenInfo}
                modelName={modelName}
                availableModels={availableModels}
                projectInputHistory={projectInputHistory}
                agentMode={agentMode}
                onAgentModeChange={handleAgentModeChange}
            />
        </>
    );
};

export default App;
