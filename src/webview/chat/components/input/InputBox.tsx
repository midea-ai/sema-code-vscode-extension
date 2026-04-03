import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { VscodeApi, TokenInfo } from '../../types';
import Tooltip from '../ui/Tooltip';
import {
    PlusIcon,
    ExpandIcon,
    CollapseIcon,
    SendIcon,
    StopIcon,
    ChevronDownIcon
} from '../ui/IconButton';

// 导入自定义 hooks
import { useInputHistory } from './hooks/useInputHistory';
import { useCommandHighlight } from './hooks/useCommandHighlight';
import { useFileSelection } from './hooks/useFileSelection';
import { SelectedFile } from '../../types';
import { useModelMenu } from './hooks/useModelMenu';
import { useShortcutPanel } from './hooks/useShortcutPanel';
import { useAgentModeMenu } from './hooks/useAgentModeMenu';

// 导入组件
import TokenProgress from './components/TokenProgress';
import SelectedFilesList from './components/SelectedFilesList';
import FilePicker from './components/FilePicker';
import ModelMenu from './components/ModelMenu';
import ShortcutPanel from './components/ShortcutPanel';
import AgentModeMenu from './components/AgentModeMenu';

// 导入工具函数
import { isExactCommandMatch, setCustomCommands, getFilteredShortcutCommands } from './utils/commandUtils';
import { ShortcutCommand } from '../../../../utils/command';

// 暴露给父组件的方法接口
export interface InputBoxHandle {
    focus: () => void;
}

interface InputBoxProps {
    vscode: VscodeApi;
    disabled: boolean;
    placeholder: string;
    isGenerating: boolean;
    showBashPermission: boolean;
    onSend: (text: string, files: SelectedFile[]) => void;
    onStop: () => void;
    tokenInfo: TokenInfo;
    modelName: string;
    availableModels: string[];
    projectInputHistory?: string[];
    agentMode: 'Agent' | 'Plan';
    onAgentModeChange: (mode: 'Agent' | 'Plan') => void;
}

const InputBox = forwardRef<InputBoxHandle, InputBoxProps>(({
    vscode,
    disabled,
    placeholder,
    isGenerating,
    showBashPermission,
    onSend,
    onStop,
    tokenInfo,
    modelName,
    availableModels,
    projectInputHistory = [],
    agentMode,
    onAgentModeChange
}, ref) => {
    const [inputValue, setInputValue] = useState<string>('');
    const [isComposing, setIsComposing] = useState<boolean>(false);
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [selectedCommandIndex, setSelectedCommandIndex] = useState<number>(0);
    const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommand[]>(() => getFilteredShortcutCommands(''));

    // Refs
    const inputBoxRef = useRef<HTMLTextAreaElement>(null);
    const filePickerRef = useRef<HTMLDivElement>(null);
    const addFileButtonRef = useRef<HTMLButtonElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const modelButtonRef = useRef<HTMLButtonElement>(null);
    const shortcutPanelRef = useRef<HTMLDivElement>(null);
    const shortcutButtonRef = useRef<HTMLButtonElement>(null);
    const agentModeMenuRef = useRef<HTMLDivElement>(null);
    const agentModeButtonRef = useRef<HTMLButtonElement>(null);

    // 使用自定义 hooks
    const inputHistory = useInputHistory();
    const commandHighlight = useCommandHighlight(inputValue, inputBoxRef);
    const fileSelection = useFileSelection(vscode, disabled, filePickerRef, addFileButtonRef);
    const modelMenu = useModelMenu(vscode, disabled, modelName, modelMenuRef, modelButtonRef);
    const shortcutPanel = useShortcutPanel(disabled, shortcutPanelRef, shortcutButtonRef);
    const agentModeMenu = useAgentModeMenu(disabled, agentMode, onAgentModeChange, agentModeMenuRef, agentModeButtonRef);

    const DEFAULT_MAX_HEIGHT = 200; // 默认最大高度
    const FULL_MAX_HEIGHT = 500; // 全屏最大高度

    // 暴露 focus 方法给父组件
    useImperativeHandle(ref, () => ({
        focus: () => {
            inputBoxRef.current?.focus();
        }
    }));

    // 监听 projectInputHistory 变化，初始化历史数据
    useEffect(() => {
        if (projectInputHistory && projectInputHistory.length > 0) {
            // console.log('Initializing input history with project data:', projectInputHistory);
            inputHistory.initializeHistory(projectInputHistory);
        }
    }, [projectInputHistory]);

    // 快捷面板打开时请求最新命令列表
    useEffect(() => {
        if (shortcutPanel.showShortcutPanel) {
            vscode.postMessage({ type: 'requestCommands' });
        }
    }, [shortcutPanel.showShortcutPanel]);

    // 监听自定义命令加载完成事件
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === 'customCommandsLoaded' && Array.isArray(event.data.commands)) {
                setCustomCommands(event.data.commands);
                setShortcutCommands(getFilteredShortcutCommands(''));
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const pastedText = e.clipboardData.getData('text');

        // 如果粘贴的内容为空或太短，不进行处理
        if (!pastedText || pastedText.trim().length < 10) {
            return;
        }

        // 检查行数是否超过3行
        const lineCount = pastedText.split('\n').length;
        if (lineCount <= 3) {
            return;
        }

        // 先阻止默认粘贴行为，稍后根据搜索结果决定是否恢复
        e.preventDefault();

        // 保存当前输入框状态
        const currentValue = inputValue;
        const currentCursorPos = e.currentTarget.selectionStart;

        // 发送内容搜索请求到后端
        vscode.postMessage({
            type: 'searchContentInFiles',
            content: pastedText.trim()
        });

        // 创建一个 Promise 来处理搜索结果，设置较短的超时时间
        const searchPromise = new Promise<boolean>((resolve) => {
            const handleSearchResult = (event: MessageEvent) => {
                const message = event.data;
                if (message.type === 'contentSearchResult') {
                    window.removeEventListener('message', handleSearchResult);

                    if (message.result) {
                        // 找到匹配的文件
                        const fileName = message.result.path.split('/').pop() || message.result.path;
                        const fileReference = `${fileName}:${message.result.startLine}-${message.result.endLine}`;

                        // 检查是否已经添加了相同的文件
                        const alreadyExists = fileSelection.selectedFiles.some(f =>
                            f.path === message.result.path &&
                            f.startLine === message.result.startLine &&
                            f.endLine === message.result.endLine
                        );

                        if (!alreadyExists) {
                            // 添加文件到选中列表
                            const newFile = {
                                path: message.result.path,
                                startLine: message.result.startLine,
                                endLine: message.result.endLine,
                                name: fileName,
                                isDirectory: false
                            };

                            fileSelection.setSelectedFiles([...fileSelection.selectedFiles, newFile]);
                        }

                        resolve(true); // 找到文件，不需要粘贴文本
                    } else {
                        resolve(false); // 未找到文件，需要粘贴文本
                    }
                }
            };

            // 添加事件监听器
            window.addEventListener('message', handleSearchResult);

            // 设置较短的超时时间以提高响应速度
            setTimeout(() => {
                window.removeEventListener('message', handleSearchResult);
                resolve(false); // 超时，默认粘贴文本
            }, 800); // 减少到800ms
        });

        // 等待搜索结果
        const foundFile = await searchPromise;

        // 如果没有找到文件，执行正常的粘贴操作
        if (!foundFile) {
            const newValue = currentValue.substring(0, currentCursorPos) +
                pastedText +
                currentValue.substring(currentCursorPos);
            setInputValue(newValue);

            // 设置光标位置
            setTimeout(() => {
                if (inputBoxRef.current) {
                    const newCursorPos = currentCursorPos + pastedText.length;
                    inputBoxRef.current.selectionStart = newCursorPos;
                    inputBoxRef.current.selectionEnd = newCursorPos;
                    inputBoxRef.current.focus();
                }
            }, 0);
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const oldValue = inputValue;
        const lengthDiff = newValue.length - oldValue.length;

        setInputValue(newValue);

        const cursorPosition = e.target.selectionStart;
        const textBeforeCursor = newValue.substring(0, cursorPosition);

        // 检测是否刚输入了 @ (只在单字符输入时触发，避免粘贴时误触发)
        if (lengthDiff === 1) {  // 只在单字符输入时检测
            // 找到刚输入的字符位置
            const insertPosition = cursorPosition - 1;
            const justTypedChar = newValue.charAt(insertPosition);

            if (justTypedChar === '@') {
                // 如果刚输入了 @，且 @ 前面是空格或在开头，则打开文件选择器
                const isAtStart = insertPosition === 0;
                const hasSpaceBefore = insertPosition > 0 && /\s/.test(newValue.charAt(insertPosition - 1));

                if (isAtStart || hasSpaceBefore) {
                    if (!fileSelection.showFilePicker && !disabled) {
                        vscode.postMessage({
                            type: 'requestWorkspaceFiles'
                        });
                        fileSelection.setShowFilePicker(true);

                        // 设置搜索查询为 @ 后面的内容（通常为空，因为刚输入@）
                        const searchQuery = textBeforeCursor.substring(insertPosition + 1);
                        fileSelection.setFileSearchQuery(searchQuery);
                    }
                }
            }
        }

        // 当输入框的值以 '/' 开头且没有空格时显示快捷面板
        const trimmedValue = newValue.trim();
        // 注意：使用原始值检查空格，因为 trim() 会去掉末尾空格
        const hasSpaceInCommand = newValue.startsWith('/') && newValue.includes(' ');

        if (trimmedValue.startsWith('/') && trimmedValue.length > 0 && !hasSpaceInCommand) {
            // 只在输入命令本身时显示面板，一旦有空格（开始输入参数）就不显示
            if (!shortcutPanel.showShortcutPanel && !disabled) {
                shortcutPanel.setShowShortcutPanel(true);
                fileSelection.setShowFilePicker(false);
            }
            // 输入改变时，重置选中索引为 0
            setSelectedCommandIndex(0);
        } else {
            // 输入框值不是以 '/' 开头，或已经包含空格（开始输入参数），关闭快捷面板
            if (shortcutPanel.showShortcutPanel) {
                shortcutPanel.setShowShortcutPanel(false);
                setSelectedCommandIndex(0);
            }
        }

        // 如果用户手动修改输入,退出历史导航模式
        if (inputHistory.historyIndex !== -1) {
            inputHistory.exitNavigation();
        }

        // 检查是否完全匹配某个命令，如果是则自动添加空格
        if (isExactCommandMatch(newValue) && !newValue.endsWith(' ')) {
            const valueWithSpace = newValue + ' ';
            setInputValue(valueWithSpace);

            // 延迟设置光标位置到末尾并确保聚焦
            setTimeout(() => {
                if (inputBoxRef.current) {
                    inputBoxRef.current.focus();
                    inputBoxRef.current.selectionStart = valueWithSpace.length;
                    inputBoxRef.current.selectionEnd = valueWithSpace.length;
                }
            }, 0);
            return; // 提前返回，避免重复处理
        }

        // 自动调整高度
        if (inputBoxRef.current) {
            if (isExpanded) {
                // 扩展状态：固定使用最大高度
                inputBoxRef.current.style.height = FULL_MAX_HEIGHT + 'px';
            } else {
                // 默认状态：自适应高度，但不超过最大值
                inputBoxRef.current.style.height = 'auto';
                inputBoxRef.current.style.height = Math.min(inputBoxRef.current.scrollHeight, DEFAULT_MAX_HEIGHT) + 'px';
            }
        }
    };

    const handleToggleExpand = () => {
        const newExpandedState = !isExpanded;
        setIsExpanded(newExpandedState);

        // 调整输入框高度
        if (inputBoxRef.current) {
            if (newExpandedState) {
                // 切换到扩展状态：固定使用最大高度
                inputBoxRef.current.style.height = FULL_MAX_HEIGHT + 'px';
            } else {
                // 切换到默认状态：自适应高度
                inputBoxRef.current.style.height = 'auto';
                inputBoxRef.current.style.height = Math.min(inputBoxRef.current.scrollHeight, DEFAULT_MAX_HEIGHT) + 'px';
            }
        }
    };

    const handleSend = () => {
        const text = inputValue.trim();
        if (!text || disabled) {
            return;
        }

        // 添加到历史记录
        inputHistory.addToHistory(text, fileSelection.selectedFiles);

        // 重置历史导航状态
        inputHistory.resetNavigation();

        onSend(text, fileSelection.selectedFiles);

        setInputValue('');
        fileSelection.setSelectedFiles([]);

        // 重置输入框高度
        if (inputBoxRef.current) {
            if (isExpanded) {
                // 扩展状态：保持固定高度
                inputBoxRef.current.style.height = FULL_MAX_HEIGHT + 'px';
            } else {
                // 默认状态：重置为最小高度
                inputBoxRef.current.style.height = 'auto';
            }
        }
    };

    const handleStop = () => {
        onStop();
    };

    const handleButtonClick = () => {
        if (canSend && isGenerating) {
            handleSend();
        } else if (isGenerating) {
            handleStop();
        } else {
            handleSend();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // 如果快捷面板显示，优先处理键盘导航
        if (shortcutPanel.showShortcutPanel) {
            const trimmedValue = inputValue.trim();
            const searchQuery = trimmedValue.startsWith('/')
                ? trimmedValue.slice(1).split(' ')[0]
                : '';

            try {
                const filteredCommands = getFilteredShortcutCommands(searchQuery);

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        setSelectedCommandIndex(prev =>
                            prev < filteredCommands.length - 1 ? prev + 1 : 0
                        );
                    }
                    return;
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        setSelectedCommandIndex(prev =>
                            prev > 0 ? prev - 1 : filteredCommands.length - 1
                        );
                    }
                    return;
                } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        // 确保索引在有效范围内
                        const safeIndex = Math.min(selectedCommandIndex, filteredCommands.length - 1);
                        const selectedCommand = filteredCommands[safeIndex];
                        if (selectedCommand) {
                            shortcutPanel.handleExecuteShortcut(
                                selectedCommand.text,
                                selectedCommand.send ?? false,
                                setInputValue,
                                onSend,
                                fileSelection.selectedFiles,
                                isExpanded,
                                inputBoxRef
                            );
                        }
                    }
                    return;
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    shortcutPanel.setShowShortcutPanel(false);
                    return;
                }
            } catch (error) {
                console.error('Error in keyboard navigation:', error);
                // 发生错误时关闭面板
                shortcutPanel.setShowShortcutPanel(false);
            }
        }

        // Ctrl+C 或 ESC 中断对话
        if ((e.key === 'c' && e.ctrlKey && (isGenerating || showBashPermission)) ||
            (e.key === 'Escape' && (isGenerating || showBashPermission))) {
            e.preventDefault();
            handleStop();
            return;
        }

        // 处理删除键（Backspace 和 Delete）
        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const textarea = e.currentTarget;
            const cursorPosition = textarea.selectionStart;

            // 检查是否应该删除整个命令
            const shouldDeleteCommand = commandHighlight.commandStartPos >= 0 && commandHighlight.commandEndPos > 0 && (
                // 光标在命令区域内
                (cursorPosition >= commandHighlight.commandStartPos && cursorPosition <= commandHighlight.commandEndPos) ||
                // 或者光标在命令后面的第一个空格位置且按的是 Backspace
                (e.key === 'Backspace' && cursorPosition === commandHighlight.commandEndPos + 1 &&
                    inputValue.charAt(commandHighlight.commandEndPos) === ' ')
            );

            if (shouldDeleteCommand) {
                // 删除整个命令
                e.preventDefault();

                const textAfterCommand = inputValue.substring(commandHighlight.commandEndPos);
                setInputValue(textAfterCommand);

                // 将光标移到开头
                setTimeout(() => {
                    if (inputBoxRef.current) {
                        inputBoxRef.current.selectionStart = 0;
                        inputBoxRef.current.selectionEnd = 0;
                    }
                }, 0);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            // 如果输入法正在组合中（如中文输入法选择候选词），不发送消息
            if (isComposing) {
                return;
            }

            e.preventDefault();
            if (canSend && isGenerating) {
                handleSend();
            } else if (isGenerating) {
                handleStop();
            } else {
                handleSend();
            }
        } else if (e.key === 'ArrowUp') {
            // 只在光标在第一行时响应
            const textarea = e.currentTarget;
            const cursorPosition = textarea.selectionStart;
            const textBeforeCursor = inputValue.substring(0, cursorPosition);
            const isOnFirstLine = !textBeforeCursor.includes('\n');

            if (isOnFirstLine && inputHistory.inputHistory.length > 0) {
                e.preventDefault();

                const historyItem = inputHistory.navigateHistory('up', inputValue, fileSelection.selectedFiles);
                setInputValue(historyItem.text);
                fileSelection.setSelectedFiles(historyItem.files);

                // 将光标移到末尾
                setTimeout(() => {
                    if (inputBoxRef.current) {
                        inputBoxRef.current.selectionStart = inputBoxRef.current.value.length;
                        inputBoxRef.current.selectionEnd = inputBoxRef.current.value.length;
                    }
                }, 0);
            }
        } else if (e.key === 'ArrowDown') {
            // 只在光标在最后一行时响应
            const textarea = e.currentTarget;
            const cursorPosition = textarea.selectionStart;
            const textAfterCursor = inputValue.substring(cursorPosition);
            const isOnLastLine = !textAfterCursor.includes('\n');

            if (isOnLastLine && inputHistory.historyIndex !== -1) {
                e.preventDefault();

                const historyItem = inputHistory.navigateHistory('down', inputValue, fileSelection.selectedFiles);
                setInputValue(historyItem.text);
                fileSelection.setSelectedFiles(historyItem.files);

                // 将光标移到末尾
                setTimeout(() => {
                    if (inputBoxRef.current) {
                        inputBoxRef.current.selectionStart = inputBoxRef.current.value.length;
                        inputBoxRef.current.selectionEnd = inputBoxRef.current.value.length;
                    }
                }, 0);
            }
        }
    };

    const canSend = inputValue.trim().length > 0 && !disabled;

    return (
        <div className="input-box-container">
            <div className="input-box-wrapper">
                {/* 左上角加号和文件列表 */}
                <div className="input-header">
                    <Tooltip content={disabled || fileSelection.showFilePicker ? '' : '添加文件'}>
                        <button
                            ref={addFileButtonRef}
                            className="add-file-btn"
                            onClick={fileSelection.handleAddFileClick}
                            disabled={disabled}
                        >
                            <PlusIcon />
                        </button>
                    </Tooltip>

                    {/* 已选择的文件 */}
                    <SelectedFilesList
                        selectedFiles={fileSelection.selectedFiles}
                        onRemoveFile={fileSelection.handleRemoveFile}
                        onFileClick={(filePath, startLine) => fileSelection.handleFileClick(filePath, startLine)}
                    />

                    {/* Token使用进度圆环 */}
                    <TokenProgress tokenInfo={tokenInfo} />
                </div>

                {/* 文件选择器弹窗 */}
                <FilePicker
                    show={fileSelection.showFilePicker}
                    fileSearchQuery={fileSelection.fileSearchQuery}
                    availableFiles={fileSelection.availableFiles}
                    isSearching={fileSelection.isSearching}
                    onSearchChange={fileSelection.setFileSearchQuery}
                    onFileSelect={(fileItem) => fileSelection.handleFileSelect(fileItem, inputValue, setInputValue, inputBoxRef)}
                    filePickerRef={filePickerRef}
                />

                {/* 快捷面板 */}
                <ShortcutPanel
                    show={shortcutPanel.showShortcutPanel}
                    commands={shortcutCommands}
                    searchQuery={
                        inputValue.trim().startsWith('/')
                            ? inputValue.trim().slice(1).split(' ')[0]  // 去掉 '/'，只取命令部分（空格前）
                            : ''
                    }
                    selectedIndex={selectedCommandIndex}
                    onExecuteShortcut={(text: string, send: boolean) => shortcutPanel.handleExecuteShortcut(
                        text, send, setInputValue, onSend, fileSelection.selectedFiles, isExpanded, inputBoxRef
                    )}
                    shortcutPanelRef={shortcutPanelRef}
                />

                {/* 输入框 */}
                <div className="input-textarea-container">
                    <textarea
                        ref={inputBoxRef}
                        className={`input-textarea ${isExpanded ? 'expanded' : ''}`}
                        placeholder={placeholder}
                        disabled={disabled}
                        value={inputValue}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={() => setIsComposing(false)}
                    />
                    {commandHighlight.highlightedCommand && (
                        <div className="command-highlight-overlay">
                            {inputValue.split('').map((char, index) => {
                                if (index >= commandHighlight.commandStartPos && index < commandHighlight.commandEndPos) {
                                    return (
                                        <span key={index} className="highlighted-char">
                                            {char}
                                        </span>
                                    );
                                } else {
                                    return (
                                        <span key={index} className="normal-char">
                                            {char}
                                        </span>
                                    );
                                }
                            })}
                        </div>
                    )}
                </div>

                {/* 左下角 Agent 模式选择和模型信息 */}
                <div className="bottom-left-container">
                    {/* Agent 模式选择 */}
                    <div className="agent-mode-container">
                        <Tooltip content={disabled || agentModeMenu.showAgentModeMenu ? '' : '切换 Agent 模式'}>
                            <button
                                ref={agentModeButtonRef}
                                className={`agent-mode-btn mode-${agentMode.toLowerCase()}`}
                                onClick={agentModeMenu.handleToggleAgentModeMenu}
                                disabled={disabled}
                            >
                                <span>{agentMode}</span>
                                <ChevronDownIcon />
                            </button>
                        </Tooltip>

                        {/* Agent 模式菜单弹窗 */}
                        <AgentModeMenu
                            show={agentModeMenu.showAgentModeMenu}
                            currentMode={agentMode}
                            onModeSelect={agentModeMenu.handleAgentModeSelect}
                            agentModeMenuRef={agentModeMenuRef}
                        />
                    </div>

                    {/* 分隔符 */}
                    <span className="bottom-separator">|</span>

                    {/* 模型信息 */}
                    <div className="model-info-container">
                        <Tooltip content={disabled || modelMenu.showModelMenu ? '' : (modelMenu.isModelLoading ? '正在加载模型...' : (modelName || '未设置模型'))}>
                            <button
                                ref={modelButtonRef}
                                className="model-info-btn"
                                onClick={modelMenu.handleToggleModelMenu}
                                disabled={disabled || modelMenu.isModelLoading}
                            >
                                <span className="model-name-text">
                                    {modelMenu.isModelLoading ? '加载中...' : (modelMenu.currentModel || '未设置')}
                                </span>
                                <ChevronDownIcon />
                            </button>
                        </Tooltip>

                        {/* 模型菜单弹窗 */}
                        <ModelMenu
                            show={modelMenu.showModelMenu}
                            availableModels={availableModels}
                            currentModel={modelMenu.currentModel}
                            isModelLoading={modelMenu.isModelLoading}
                            onModelSwitch={modelMenu.handleModelSwitch}
                            onOpenConfig={modelMenu.handleOpenConfig}
                            modelMenuRef={modelMenuRef}
                        />
                    </div>
                </div>

                {/* 右下角按钮组 */}
                <div className="input-actions">
                    {/* 缩放按钮 */}
                    <Tooltip content={disabled ? '' : (isExpanded ? '缩小' : '扩大')}>
                        <button
                            className="expand-btn"
                            onClick={handleToggleExpand}
                            disabled={disabled}
                        >
                            {isExpanded ? (
                                <CollapseIcon />
                            ) : (
                                <ExpandIcon />
                            )}
                        </button>
                    </Tooltip>

                    {/* 发送/停止按钮 */}
                    <Tooltip content={(canSend || isGenerating) ?
                        (canSend ? '发送 Enter' : '中断 Ctrl+C') : ''}>
                        <button
                            className={`send-btn ${canSend || isGenerating ? 'active' : ''}`}
                            onClick={handleButtonClick}
                            disabled={!canSend && !isGenerating}
                        >
                            {isGenerating && !canSend ? (
                                // 停止图标 - 空心正方形
                                <StopIcon />
                            ) : (
                                // 向上箭头图标
                                <SendIcon />
                            )}
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
});

export default InputBox;

