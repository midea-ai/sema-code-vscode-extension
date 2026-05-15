import React, { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { VscodeApi, TokenInfo, InputMention, AgentMode } from '../../types';
import Tooltip from '../ui/Tooltip';
import {
    PlusIcon,
    ExpandIcon,
    CollapseIcon,
    SendIcon,
    StopIcon,
    ChevronDownIcon
} from '../ui/IconButton';

import { useInputHistory } from './hooks/useInputHistory';
import { useFileSelection } from './hooks/useFileSelection';
import { SelectedFile, FileItem } from '../../types';
import { useModelMenu } from './hooks/useModelMenu';
import { useShortcutPanel } from './hooks/useShortcutPanel';
import { useAgentModeMenu } from './hooks/useAgentModeMenu';

import TokenProgress from './components/TokenProgress';
import FilePicker from './components/FilePicker';
import ModelMenu from './components/ModelMenu';
import ShortcutPanel from './components/ShortcutPanel';
import AgentModeMenu from './components/AgentModeMenu';

import { setCustomCommands, setSkills, getFilteredShortcutCommands } from './utils/commandUtils';
import { isAtBoundary } from './utils/boundary';
import {
    MENTION_CLASS,
    getMentionsFromDom,
    scanAndUnwrapStaleMentions,
    renderEditorContent
} from './utils/mentionDom';
import {
    getEditorText,
    getCaretOffset,
    setCaretOffset,
    insertNodeAtOffset
} from './utils/editorDom';
import { ShortcutCommand } from '../../../../utils/command';

// ─── 组件 ───────────────────────────────────────────────────────────────────

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
    agentMode: AgentMode;
    onAgentModeChange: (mode: AgentMode) => void;
    autoEdit: boolean;
    skipFileEditPermission: boolean;
    onAutoEditChange: (enable: boolean) => void;
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
    agentMode,
    onAgentModeChange,
    autoEdit,
    skipFileEditPermission,
    onAutoEditChange
}, ref) => {
    const [inputValue, setInputValue] = useState<string>('');
    const [mentions, setMentions] = useState<InputMention[]>([]);
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [selectedCommandIndex, setSelectedCommandIndex] = useState<number>(0);
    const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
    const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommand[]>(() => getFilteredShortcutCommands(''));
    const [filePickerQuery, setFilePickerQuery] = useState<string>('');

    const inputBoxRef = useRef<HTMLDivElement>(null);
    const filePickerRef = useRef<HTMLDivElement>(null);
    const addFileButtonRef = useRef<HTMLButtonElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const modelButtonRef = useRef<HTMLButtonElement>(null);
    const shortcutPanelRef = useRef<HTMLDivElement>(null);
    const agentModeMenuRef = useRef<HTMLDivElement>(null);
    const agentModeButtonRef = useRef<HTMLButtonElement>(null);
    const composingRef = useRef<boolean>(false);
    const atPositionRef = useRef<number>(-1);

    const inputHistory = useInputHistory();
    const fileSelection = useFileSelection(vscode, filePickerRef, addFileButtonRef, inputBoxRef);
    const modelMenu = useModelMenu(vscode, disabled, modelName, modelMenuRef, modelButtonRef);
    const shortcutPanel = useShortcutPanel(disabled, shortcutPanelRef, inputBoxRef);
    const agentModeMenu = useAgentModeMenu(disabled, agentMode, onAgentModeChange, agentModeMenuRef, agentModeButtonRef);

    useImperativeHandle(ref, () => ({
        focus: () => { inputBoxRef.current?.focus(); }
    }));

    // 启动时主动向扩展请求项目级输入历史
    useEffect(() => {
        vscode.postMessage({ type: 'requestInputHistory' });
        const handler = (event: MessageEvent) => {
            if (event.data?.type === 'inputHistoryLoaded' && Array.isArray(event.data.items)) {
                inputHistory.initializeHistory(event.data.items);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        if (shortcutPanel.showShortcutPanel) {
            vscode.postMessage({ type: 'requestCommands' });
            vscode.postMessage({ type: 'requestSkills' });
        }
    }, [shortcutPanel.showShortcutPanel]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === 'customCommandsLoaded' && Array.isArray(event.data.commands)) {
                setCustomCommands(event.data.commands);
                setShortcutCommands(getFilteredShortcutCommands(''));
            } else if (event.data.type === 'skillsLoaded' && Array.isArray(event.data.skills)) {
                setSkills(event.data.skills);
                setShortcutCommands(getFilteredShortcutCommands(''));
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        if (!fileSelection.showFilePicker) return;
        const q = filePickerQuery.trim();
        if (!q) {
            fileSelection.requestWorkspaceFiles();
            return;
        }
        const timer = setTimeout(() => {
            fileSelection.searchWorkspaceFiles(q);
        }, 200);
        return () => clearTimeout(timer);
    }, [filePickerQuery, fileSelection.showFilePicker]);

    // 从 DOM 重新读取文本/mentions，并触发 @ 触发区与 / 命令检测
    const syncFromDom = (caretOverride?: number | null) => {
        const el = inputBoxRef.current;
        if (!el) return;
        let caret = caretOverride !== undefined ? caretOverride : getCaretOffset(el);
        const mutated = scanAndUnwrapStaleMentions(el);
        if (mutated && caret !== null) setCaretOffset(el, caret);
        const text = getEditorText(el);
        const ms = getMentionsFromDom(el);
        setInputValue(text);
        setMentions(ms);
        const cursorPos = caret ?? text.length;

        // @ 触发：从光标向前找最近的 @，遇到边界字符则中断
        let atPos = -1;
        for (let i = cursorPos - 1; i >= 0; i--) {
            const ch = text[i];
            if (isAtBoundary(ch)) break;
            if (ch === '@') {
                // 排除已在 mention 内部的 @
                const inMention = ms.some(m => i >= m.start && i < m.start + m.length);
                if (inMention) break;
                const charBeforeAt = i === 0 ? '' : text[i - 1];
                if (isAtBoundary(charBeforeAt)) atPos = i;
                break;
            }
        }

        if (atPos >= 0 && !disabled) {
            let endPos = atPos + 1;
            while (endPos < text.length && !isAtBoundary(text[endPos])) endPos++;
            const query = text.substring(atPos + 1, endPos);
            atPositionRef.current = atPos;
            setFilePickerQuery(query);
            if (!fileSelection.showFilePicker) fileSelection.setShowFilePicker(true);
            setSelectedFileIndex(0);
        } else if (fileSelection.showFilePicker) {
            fileSelection.setShowFilePicker(false);
            setSelectedFileIndex(0);
            atPositionRef.current = -1;
            setFilePickerQuery('');
        }

        const hasSpaceInCommand = text.startsWith('/') && text.includes(' ');
        if (text.startsWith('/') && !hasSpaceInCommand) {
            if (!shortcutPanel.showShortcutPanel && !disabled) {
                shortcutPanel.setShowShortcutPanel(true);
                fileSelection.setShowFilePicker(false);
            }
            setSelectedCommandIndex(0);
        } else {
            if (shortcutPanel.showShortcutPanel) {
                shortcutPanel.setShowShortcutPanel(false);
                setSelectedCommandIndex(0);
            }
        }

        if (inputHistory.historyIndex !== -1) inputHistory.exitNavigation();
    };

    const handleEditorInput: React.FormEventHandler<HTMLDivElement> = () => {
        if (composingRef.current) return;
        syncFromDom();
    };

    const handleCompositionEnd = () => {
        composingRef.current = false;
        // 输入法合成结束后再扫描 mention，避免拼音中间态误清
        syncFromDom();
    };

    const handleCompositionStart = () => {
        composingRef.current = true;
    };

    const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = async (e) => {
        // 剪贴板里是"复制的文件"（Finder / Explorer / VSCode 文件树）—— webview 沙箱拿不到路径，
        // 必须交给扩展端读系统剪贴板，回传后插入 @mention
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            e.preventDefault();
            vscode.postMessage({ type: 'requestClipboardFiles' });
            const paths = await new Promise<string[]>((resolve) => {
                const onResult = (event: MessageEvent) => {
                    if (event.data?.type === 'clipboardFilesResult') {
                        window.removeEventListener('message', onResult);
                        resolve(Array.isArray(event.data.paths) ? event.data.paths : []);
                    }
                };
                window.addEventListener('message', onResult);
                setTimeout(() => {
                    window.removeEventListener('message', onResult);
                    resolve([]);
                }, 1500);
            });
            if (paths.length > 0) {
                insertMentionsBatchAtCaret(paths.map(p => ({ path: p })));
            }
            return;
        }

        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        if (!pastedText) return;

        const el = inputBoxRef.current;
        if (!el) return;

        // 短文本或 ≤3 行：纯文本插入
        if (pastedText.trim().length < 10 || pastedText.split('\n').length <= 3) {
            insertPlainTextAtCaret(pastedText);
            return;
        }

        // 触发后端搜索
        const currentText = inputValue;
        const currentCaret = getCaretOffset(el) ?? currentText.length;

        vscode.postMessage({ type: 'searchContentInFiles', content: pastedText.trim() });

        const foundFile = await new Promise<{ path: string; startLine: number; endLine: number } | null>((resolve) => {
            const onResult = (event: MessageEvent) => {
                if (event.data?.type === 'contentSearchResult') {
                    window.removeEventListener('message', onResult);
                    resolve(event.data.result || null);
                }
            };
            window.addEventListener('message', onResult);
            setTimeout(() => {
                window.removeEventListener('message', onResult);
                resolve(null);
            }, 800);
        });

        if (foundFile) {
            insertMentionAtCaret(currentText, currentCaret, {
                path: foundFile.path,
                startLine: foundFile.startLine,
                endLine: foundFile.endLine
            });
        } else {
            insertPlainTextAtCaretAt(currentText, currentCaret, pastedText);
        }
    };

    // 在当前光标处插纯文本
    const insertPlainTextAtCaret = (textToInsert: string) => {
        const el = inputBoxRef.current; if (!el) return;
        const caret = getCaretOffset(el) ?? inputValue.length;
        insertPlainTextAtCaretAt(inputValue, caret, textToInsert);
    };

    const insertPlainTextAtCaretAt = (currentText: string, caret: number, textToInsert: string) => {
        const el = inputBoxRef.current; if (!el) return;
        const newText = currentText.substring(0, caret) + textToInsert + currentText.substring(caret);
        const delta = textToInsert.length;
        const newMentions: InputMention[] = mentions
            .filter(m => !(m.start < caret && m.start + m.length > caret))
            .map(m => m.start >= caret ? { ...m, start: m.start + delta } : m);
        renderEditorContent(el, newText, newMentions);
        setInputValue(newText);
        setMentions(newMentions);
        const newCaret = caret + textToInsert.length;
        setCaretOffset(el, newCaret);
        el.focus();
        // 粘贴是「合成事件」，不会触发 onInput → 必须手动跑一遍 syncFromDom，
        // 否则 @ 后粘贴的查询词无法被检测到、FilePicker 仍停留在空 query 状态
        syncFromDom(newCaret);
    };

    // 纯函数：基于 (text, caret, mentions) 计算插入一个 mention 后的新状态，便于循环累计
    const computeMentionInsertion = (
        currentText: string,
        caret: number,
        curMentions: InputMention[],
        m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }
    ): { text: string; mentions: InputMention[]; caret: number } => {
        const before = currentText.substring(0, caret);
        const after = currentText.substring(caret);
        const needSpaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
        // \n 不再视为"已经有分隔"——否则删空后残留 <br> 时会渲染成 <span/><br>，光标视觉上挤到高亮末尾
        const needSpaceAfter = !after.startsWith(' ');
        const mentionText = '@' + m.path + (m.startLine !== undefined ? `:${m.startLine}-${m.endLine ?? m.startLine}` : '');
        const prefix = needSpaceBefore ? ' ' : '';
        const suffix = needSpaceAfter ? ' ' : '';
        const insertion = prefix + mentionText + suffix;
        const newText = before + insertion + after;
        const mentionStart = caret + prefix.length;

        const delta = insertion.length;
        const shifted: InputMention[] = curMentions
            .filter(om => !(om.start < caret && om.start + om.length > caret))
            .map(om => om.start >= caret ? { ...om, start: om.start + delta } : om);
        const newMentions: InputMention[] = [
            ...shifted,
            {
                start: mentionStart,
                length: mentionText.length,
                path: m.path,
                isDirectory: m.isDirectory,
                startLine: m.startLine,
                endLine: m.endLine
            }
        ].sort((a, b) => a.start - b.start);

        return {
            text: newText,
            mentions: newMentions,
            // 同 handleFileSelect：跨过 mention 后的 1 个字符，确保落在高亮外
            caret: mentionStart + mentionText.length + 1
        };
    };

    // 在当前光标处插入一个 mention（粘贴匹配 / 文件选择共用）
    const insertMentionAtCaret = (
        currentText: string,
        caret: number,
        m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }
    ) => {
        const el = inputBoxRef.current; if (!el) return;
        const r = computeMentionInsertion(currentText, caret, mentions, m);
        renderEditorContent(el, r.text, r.mentions);
        setInputValue(r.text);
        setMentions(r.mentions);
        setCaretOffset(el, r.caret);
        el.focus();
    };

    // 在当前光标处依次插入多个 mention（多文件粘贴）
    const insertMentionsBatchAtCaret = (
        items: Array<{ path: string; isDirectory?: boolean; startLine?: number; endLine?: number }>
    ) => {
        const el = inputBoxRef.current; if (!el || items.length === 0) return;
        let text = inputValue;
        let caret = getCaretOffset(el) ?? text.length;
        let curMentions = mentions;
        for (const m of items) {
            const r = computeMentionInsertion(text, caret, curMentions, m);
            text = r.text; caret = r.caret; curMentions = r.mentions;
        }
        renderEditorContent(el, text, curMentions);
        setInputValue(text);
        setMentions(curMentions);
        setCaretOffset(el, caret);
        el.focus();
    };

    const handleFileSelect = (fileItem: FileItem) => {
        const atPos = atPositionRef.current;
        const el = inputBoxRef.current;
        if (atPos < 0 || !el || inputValue[atPos] !== '@') return;

        // 用 @ 起点 + 过滤词末尾构造一段「待替换区间」
        let queryEnd = atPos + 1;
        while (queryEnd < inputValue.length && !isAtBoundary(inputValue[queryEnd])) queryEnd++;
        const before = inputValue.substring(0, atPos);
        const after = inputValue.substring(queryEnd);
        const needSpaceAfter = after.length === 0 || (!after.startsWith(' ') && !after.startsWith('\n'));
        const mentionText = '@' + fileItem.path;
        const suffix = needSpaceAfter ? ' ' : '';
        const insertion = mentionText + suffix;
        const newText = before + insertion + after;

        const replacedLen = queryEnd - atPos;
        const delta = insertion.length - replacedLen;
        const shifted: InputMention[] = mentions
            .filter(m => !(m.start + m.length > atPos && m.start < queryEnd))
            .map(m => m.start >= queryEnd ? { ...m, start: m.start + delta } : m);
        const newMentions: InputMention[] = [
            ...shifted,
            {
                start: atPos,
                length: mentionText.length,
                path: fileItem.path,
                isDirectory: fileItem.isDirectory
            }
        ].sort((a, b) => a.start - b.start);

        renderEditorContent(el, newText, newMentions);
        setInputValue(newText);
        setMentions(newMentions);
        // 光标统一落到 mention 后再过一格：要么我们补的空格之后，要么 after 已有空白之后，
        // 避免 setCaretOffset 把光标递归放进 mention span 末尾
        setCaretOffset(el, atPos + mentionText.length + 1);
        el.focus();

        fileSelection.setShowFilePicker(false);
        setSelectedFileIndex(0);
        atPositionRef.current = -1;
        setFilePickerQuery('');
    };

    const handleAddFileClick = () => {
        if (disabled) return;
        const el = inputBoxRef.current; if (!el) return;
        let newText = inputValue;
        let atOffset: number;
        if (newText === '' || newText.endsWith(' ') || newText.endsWith('\n')) {
            newText = newText + '@';
            atOffset = newText.length - 1;
        } else if (newText.endsWith('@')) {
            atOffset = newText.length - 1;
        } else {
            newText = newText + ' @';
            atOffset = newText.length - 1;
        }
        if (newText !== inputValue) {
            renderEditorContent(el, newText, mentions);
            setInputValue(newText);
        }
        setCaretOffset(el, newText.length);
        el.focus();
        atPositionRef.current = atOffset;
        setFilePickerQuery('');
        fileSelection.setShowFilePicker(true);
        setSelectedFileIndex(0);
    };

    const completeShortcut = (text: string) => {
        const el = inputBoxRef.current; if (!el) return;
        const newValue = `/${text} `;
        renderEditorContent(el, newValue, []);
        setInputValue(newValue);
        setMentions([]);
        shortcutPanel.setShowShortcutPanel(false);
        setCaretOffset(el, newValue.length);
        el.focus();
    };

    const sendShortcut = (text: string) => {
        if (disabled) return;
        const fullText = `/${text}`;
        const item = inputHistory.addToHistory(fullText, [], []);
        inputHistory.resetNavigation();
        if (item) vscode.postMessage({ type: 'saveInputHistory', item: { ...item, ts: Date.now() } });
        onSend(fullText, []);
        clearEditor();
        fileSelection.setSelectedFiles([]);
        shortcutPanel.setShowShortcutPanel(false);
    };

    const clearEditor = () => {
        const el = inputBoxRef.current;
        if (el) el.innerHTML = '';
        setInputValue('');
        setMentions([]);
    };

    const handleToggleExpand = () => {
        setIsExpanded(prev => !prev);
    };

    // mentions 是「@文件」在编辑器里的真实状态：发送时从它派生文件列表，
    // 避免历史的 selectedFiles 残留导致重复拼接（删掉 mention 后旧文件还在 selectedFiles）
    const filesFromMentions = (ms: InputMention[]): SelectedFile[] =>
        ms.map(m => ({
            path: m.path,
            name: m.path.split('/').pop() || m.path,
            isDirectory: !!m.isDirectory,
            startLine: m.startLine,
            endLine: m.endLine
        }));

    const handleSend = () => {
        const text = inputValue;
        const trimmed = text.trim();
        if (!trimmed || disabled) return;

        const files = filesFromMentions(mentions);
        const item = inputHistory.addToHistory(text, files, mentions);
        inputHistory.resetNavigation();
        if (item) vscode.postMessage({ type: 'saveInputHistory', item: { ...item, ts: Date.now() } });

        onSend(trimmed, files);
        clearEditor();
        fileSelection.setSelectedFiles([]);
    };

    const handleStop = () => onStop();

    const handleButtonClick = () => {
        if (canSend && isGenerating) handleSend();
        else if (isGenerating) handleStop();
        else handleSend();
    };

    // 光标在 mention span 边界（最末/最前）时，按方向键跳到 span 之外的兄弟位置；
    // 否则会出现："输入框以 mention 结尾时光标卡在高亮里、下一个键入的字符（含空格）被
    // 吸进 span 内部触发 unwrap" 的连锁问题。
    const escapeMentionAtBoundary = (direction: 'left' | 'right'): boolean => {
        const root = inputBoxRef.current;
        if (!root) return false;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        const offset = range.startOffset;

        let span: HTMLElement | null = null;
        let cur: Node | null = node;
        while (cur && cur !== root) {
            if (
                cur.nodeType === Node.ELEMENT_NODE &&
                (cur as HTMLElement).classList.contains(MENTION_CLASS)
            ) {
                span = cur as HTMLElement;
                break;
            }
            cur = cur.parentNode;
        }
        if (!span) return false;

        const textLen = (span.textContent || '').length;
        const atEnd =
            (node === span && offset === span.childNodes.length) ||
            (node.parentNode === span && node.nodeType === Node.TEXT_NODE && offset === textLen);
        const atStart =
            (node === span && offset === 0) ||
            (node.parentNode === span && node.nodeType === Node.TEXT_NODE && offset === 0);

        if (direction === 'right' && !atEnd) return false;
        if (direction === 'left' && !atStart) return false;

        const parent = span.parentNode as HTMLElement | null;
        if (!parent) return false;

        // 关键：要把光标放进 span 外侧 textnode 的"内部偏移"（≥1 或 length-1），不能停在 parent.idx±1。
        // Chromium 会把"紧贴 span 的兄弟边界"视觉化在 span 内末尾的同一像素：
        //   1) 用户按右键看见"光标不动"
        //   2) 后续输入被吸回 span 内 → textContent 变化 → 触发 mention 解包
        // 若兄弟不是可用 textnode（mention 是首/末元素 or 两个 mention 紧邻 or 空 textnode），先补一个空格当落点。
        let needSync = false;
        let target: Node | null = direction === 'right' ? span.nextSibling : span.previousSibling;
        const usable =
            target &&
            target.nodeType === Node.TEXT_NODE &&
            (target as Text).data.length > 0;
        if (!usable) {
            const placeholder = document.createTextNode(' ');
            parent.insertBefore(placeholder, direction === 'right' ? target : span);
            target = placeholder;
            needSync = true;
        }
        const tLen = (target as Text).data.length;
        const newOffset = direction === 'right' ? Math.min(1, tLen) : Math.max(0, tLen - 1);
        const newRange = document.createRange();
        newRange.setStart(target!, newOffset);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        if (needSync) syncFromDom();
        return true;
    };

    const restoreFromHistory = (direction: 'up' | 'down') => {
        const el = inputBoxRef.current; if (!el) return;
        const item = inputHistory.navigateHistory(direction, inputValue, fileSelection.selectedFiles, mentions);
        renderEditorContent(el, item.text, item.mentions);
        setInputValue(item.text);
        setMentions(item.mentions);
        fileSelection.setSelectedFiles(item.files);
        setCaretOffset(el, item.text.length);
        el.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Ctrl+A 全选 + Backspace/Delete：手动清空，绕开浏览器留空 mention span 外壳的 bug
        // (Chromium 删除全选 selection 时不会移除外层 span，光标残留在空 span 内，
        //  下一个字符被吸进 span → 文字显示带 mention 高亮且无法靠 input 事件兜底)
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const root = inputBoxRef.current;
            const sel = window.getSelection();
            if (root && sel && !sel.isCollapsed && sel.rangeCount > 0) {
                const fullText = root.textContent || '';
                if (fullText && sel.getRangeAt(0).toString().length === fullText.length) {
                    e.preventDefault();
                    root.innerHTML = '';
                    root.focus();
                    syncFromDom(0);
                    return;
                }
            }
        }

        // 文件选择器优先
        if (fileSelection.showFilePicker) {
            const files = filteredAvailableFiles;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (files.length > 0) setSelectedFileIndex(prev => prev < files.length - 1 ? prev + 1 : 0);
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (files.length > 0) setSelectedFileIndex(prev => prev > 0 ? prev - 1 : files.length - 1);
                return;
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (files.length > 0) {
                    const safeIndex = Math.min(selectedFileIndex, files.length - 1);
                    const target = files[safeIndex];
                    if (target) handleFileSelect(target);
                }
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                fileSelection.setShowFilePicker(false);
                setSelectedFileIndex(0);
                atPositionRef.current = -1;
                setFilePickerQuery('');
                return;
            }
        }

        // 快捷面板
        if (shortcutPanel.showShortcutPanel) {
            const searchQuery = inputValue.startsWith('/') ? inputValue.slice(1).split(' ')[0] : '';
            try {
                const filteredCommands = getFilteredShortcutCommands(searchQuery);
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        setSelectedCommandIndex(prev => prev < filteredCommands.length - 1 ? prev + 1 : 0);
                    }
                    return;
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        setSelectedCommandIndex(prev => prev > 0 ? prev - 1 : filteredCommands.length - 1);
                    }
                    return;
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        const safeIndex = Math.min(selectedCommandIndex, filteredCommands.length - 1);
                        const sel = filteredCommands[safeIndex];
                        if (sel) completeShortcut(sel.text);
                    }
                    return;
                } else if (e.key === 'Enter' && !e.shiftKey) {
                    if (composingRef.current) return;
                    e.preventDefault();
                    if (filteredCommands.length > 0) {
                        const safeIndex = Math.min(selectedCommandIndex, filteredCommands.length - 1);
                        const sel = filteredCommands[safeIndex];
                        if (sel) sendShortcut(sel.text);
                    }
                    return;
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    shortcutPanel.setShowShortcutPanel(false);
                    return;
                }
            } catch (error) {
                console.error('Error in keyboard navigation:', error);
                shortcutPanel.setShowShortcutPanel(false);
            }
        }

        if ((e.key === 'c' && e.ctrlKey && (isGenerating || showBashPermission)) ||
            (e.key === 'Escape' && (isGenerating || showBashPermission))) {
            e.preventDefault();
            handleStop();
            return;
        }

        // Ctrl+W：删除前一个词（终端 kill-word-backward 行为，按中文习惯切词）
        // VSCode 在 webview 外层也绑了 Ctrl+W（关闭编辑器），需 stopPropagation 阻止事件外泄
        if ((e.key === 'w' || e.key === 'W') && e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            const el = inputBoxRef.current; if (!el) return;
            const caret = getCaretOffset(el) ?? 0;
            if (caret === 0) return;

            // 中日韩字符判定：CJK 统一表意+扩展A、平假名/片假名、韩文、CJK 兼容
            const isCJK = (ch: string): boolean => {
                if (!ch) return false;
                const code = ch.charCodeAt(0);
                return (code >= 0x3400 && code <= 0x9FFF) ||
                    (code >= 0x3040 && code <= 0x30FF) ||
                    (code >= 0xAC00 && code <= 0xD7AF) ||
                    (code >= 0xF900 && code <= 0xFAFF);
            };

            let start = caret;
            // 1) 跳过尾部空白
            while (start > 0 && /\s/.test(inputValue[start - 1])) start--;
            if (start > 0) {
                const prev = inputValue[start - 1];
                if (isAtBoundary(prev)) {
                    // 2a) 单个标点也算一个词
                    start--;
                } else if (isCJK(prev)) {
                    // 2b) 连续 CJK 没有可靠分词，按最大字符数封顶（避免长句一锅端）
                    const MAX_CJK = 8;
                    let count = 0;
                    while (start > 0 && isCJK(inputValue[start - 1]) && count < MAX_CJK) {
                        start--;
                        count++;
                    }
                } else {
                    // 2c) 连续非 CJK 非边界字符（拉丁/数字/路径符号等），遇 CJK 也停下
                    while (
                        start > 0 &&
                        !isCJK(inputValue[start - 1]) &&
                        !isAtBoundary(inputValue[start - 1])
                    ) start--;
                }
            }

            if (start === caret) return;
            const newText = inputValue.substring(0, start) + inputValue.substring(caret);
            const delta = caret - start;
            const newMentions: InputMention[] = mentions
                .filter(m => !(m.start + m.length > start && m.start < caret))
                .map(m => m.start >= caret ? { ...m, start: m.start - delta } : m);
            renderEditorContent(el, newText, newMentions);
            setInputValue(newText);
            setMentions(newMentions);
            el.focus();
            setCaretOffset(el, start);
            // webview 偶发抢焦点：下一帧再夺回一次
            requestAnimationFrame(() => {
                if (document.activeElement !== el) {
                    el.focus();
                    setCaretOffset(el, start);
                }
            });
            return;
        }

        // Ctrl+U：删除从光标到当前行行首的内容（终端 kill-to-beginning 行为）
        // 已在行首时吃掉上一行末尾的 \n，光标落到上一行末尾，便于连按多次跨行删除
        if ((e.key === 'u' || e.key === 'U') && e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const el = inputBoxRef.current; if (!el) return;
            const caret = getCaretOffset(el) ?? 0;
            if (caret === 0) return;
            const lineStart = inputValue.lastIndexOf('\n', caret - 1) + 1;
            const deleteFrom = lineStart === caret ? caret - 1 : lineStart;
            const newText = inputValue.substring(0, deleteFrom) + inputValue.substring(caret);
            const delta = caret - deleteFrom;
            const newMentions: InputMention[] = mentions
                .filter(m => !(m.start + m.length > deleteFrom && m.start < caret))
                .map(m => m.start >= caret ? { ...m, start: m.start - delta } : m);
            renderEditorContent(el, newText, newMentions);
            setInputValue(newText);
            setMentions(newMentions);
            setCaretOffset(el, deleteFrom);
            el.focus();
            return;
        }

        if (e.key === 'Enter') {
            if (composingRef.current) return;
            e.preventDefault();
            if (e.shiftKey) {
                // 软换行：在光标处插入一个 \n 文本节点
                const el = inputBoxRef.current; if (!el) return;
                const caret = getCaretOffset(el) ?? inputValue.length;
                insertNodeAtOffset(el, caret, document.createTextNode('\n'));
                // 末尾的纯 \n 浏览器可能不渲染，补一个零宽空格保证布局
                if (caret === inputValue.length) {
                    insertNodeAtOffset(el, caret + 1, document.createElement('br'));
                }
                setCaretOffset(el, caret + 1);
                syncFromDom(caret + 1);
                return;
            }
            if (canSend && isGenerating) handleSend();
            else if (isGenerating) handleStop();
            else handleSend();
            return;
        }

        if (e.key === 'ArrowUp') {
            const el = inputBoxRef.current; if (!el) return;
            const caret = getCaretOffset(el) ?? 0;
            const textBeforeCursor = inputValue.substring(0, caret);
            const isOnFirstLine = !textBeforeCursor.includes('\n');
            if (isOnFirstLine && inputHistory.inputHistory.length > 0) {
                e.preventDefault();
                restoreFromHistory('up');
            }
        } else if (e.key === 'ArrowDown') {
            const el = inputBoxRef.current; if (!el) return;
            const caret = getCaretOffset(el) ?? 0;
            const textAfterCursor = inputValue.substring(caret);
            const isOnLastLine = !textAfterCursor.includes('\n');
            if (isOnLastLine && inputHistory.historyIndex !== -1) {
                e.preventDefault();
                restoreFromHistory('down');
            }
        } else if (e.key === 'ArrowRight') {
            if (escapeMentionAtBoundary('right')) e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            if (escapeMentionAtBoundary('left')) e.preventDefault();
        }
    };

    const canSend = inputValue.trim().length > 0 && !disabled;

    const filteredAvailableFiles = useMemo(() => {
        const q = filePickerQuery.trim();
        // 有搜索词：按后端相关度顺序展示，不再按"是否打开"重排
        if (q) return fileSelection.availableFiles;
        // 无搜索词：项目内已打开 → 项目内未打开 → 项目外，组内隐藏文件靠后、按路径字母序
        const isOutside = (p: string) =>
            p.startsWith('/') || p.startsWith('~') || /^[a-zA-Z]:[\\/]/.test(p);
        const insideOpen: FileItem[] = [];
        const insideClosed: FileItem[] = [];
        const outside: FileItem[] = [];
        for (const f of fileSelection.availableFiles) {
            if (isOutside(f.path)) outside.push(f);
            else if (f.isOpen) insideOpen.push(f);
            else insideClosed.push(f);
        }
        const sortGroup = (arr: FileItem[]) => {
            arr.sort((a, b) => {
                const an = a.path.split('/').pop() || a.path;
                const bn = b.path.split('/').pop() || b.path;
                const ad = an.startsWith('.') ? 1 : 0;
                const bd = bn.startsWith('.') ? 1 : 0;
                if (ad !== bd) return ad - bd;
                return a.path.localeCompare(b.path);
            });
            return arr;
        };
        return [...sortGroup(insideOpen), ...sortGroup(insideClosed), ...sortGroup(outside)];
    }, [filePickerQuery, fileSelection.availableFiles]);

    return (
        <div className="input-box-container">
            <div className="input-box-wrapper">
                <div className="input-header">
                    <Tooltip content={disabled || fileSelection.showFilePicker ? '' : '添加文件'}>
                        <button
                            ref={addFileButtonRef}
                            className="add-file-btn"
                            onClick={handleAddFileClick}
                            disabled={disabled}
                        >
                            <PlusIcon />
                        </button>
                    </Tooltip>
                    <TokenProgress tokenInfo={tokenInfo} />
                </div>

                <FilePicker
                    show={fileSelection.showFilePicker}
                    availableFiles={filteredAvailableFiles}
                    selectedIndex={selectedFileIndex}
                    onFileSelect={handleFileSelect}
                    filePickerRef={filePickerRef}
                    showDividers={!filePickerQuery.trim()}
                />

                <ShortcutPanel
                    show={shortcutPanel.showShortcutPanel}
                    commands={shortcutCommands}
                    searchQuery={
                        inputValue.startsWith('/')
                            ? inputValue.slice(1).split(' ')[0]
                            : ''
                    }
                    selectedIndex={selectedCommandIndex}
                    onExecuteShortcut={(text: string) => completeShortcut(text)}
                    shortcutPanelRef={shortcutPanelRef}
                />

                <div className="input-textarea-container">
                    <div
                        ref={inputBoxRef}
                        className={`input-textarea input-editable ${isExpanded ? 'expanded' : ''}`}
                        contentEditable={!disabled}
                        suppressContentEditableWarning
                        data-placeholder={placeholder}
                        onInput={handleEditorInput}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                        spellCheck={false}
                    />
                </div>

                <div className="bottom-left-container">
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
                        <AgentModeMenu
                            show={agentModeMenu.showAgentModeMenu}
                            currentMode={agentMode}
                            onModeSelect={agentModeMenu.handleAgentModeSelect}
                            agentModeMenuRef={agentModeMenuRef}
                        />
                    </div>

                    <span className="bottom-separator separator-model">|</span>

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

                    {!skipFileEditPermission && (
                        <>
                            <span className="bottom-separator separator-autoedit">|</span>
                            <Tooltip content={disabled ? '' : (autoEdit ? '点击关闭自动编辑' : '点击开启自动编辑')}>
                                <button
                                    className={`auto-edit-btn ${autoEdit ? 'active' : ''}`}
                                    onClick={() => onAutoEditChange(!autoEdit)}
                                    disabled={disabled}
                                >
                                    <span>AutoEdit</span>
                                </button>
                            </Tooltip>
                        </>
                    )}
                </div>

                <div className="input-actions">
                    <Tooltip content={disabled ? '' : (isExpanded ? '缩小' : '扩大')}>
                        <button
                            className="expand-btn"
                            onClick={handleToggleExpand}
                            disabled={disabled}
                        >
                            {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
                        </button>
                    </Tooltip>

                    <Tooltip content={(canSend || isGenerating) ?
                        (canSend ? '发送 Enter' : '中断 Ctrl+C') : ''}>
                        <button
                            className={`send-btn ${canSend || isGenerating ? 'active' : ''}`}
                            onClick={handleButtonClick}
                            disabled={!canSend && !isGenerating}
                        >
                            {isGenerating && !canSend ? <StopIcon /> : <SendIcon />}
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
});

export default InputBox;
