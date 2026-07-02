import React, { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { VscodeApi, TokenInfo, InputMention, AgentMode, PermissionLevel, ImageAttachment } from '../../types';
import Tooltip from '../ui/Tooltip';
import ImageThumbnail from '../ImageThumbnail';
import ImagePreviewModal from '../ImagePreviewModal';
import { usePendingImages } from './hooks/usePendingImages';
import {
    PlusIcon,
    ExpandIcon,
    CollapseIcon,
    SendIcon,
    StopIcon,
    ChevronDownIcon
} from '../ui/IconButton';

import { useInputHistory } from './hooks/useInputHistory';
import { useEditorHistory, EditorSnapshot } from './hooks/useEditorHistory';
import { useFileSelection } from './hooks/useFileSelection';
import { SelectedFile, FileItem } from '../../types';
import { useModelMenu } from './hooks/useModelMenu';
import { useShortcutPanel } from './hooks/useShortcutPanel';
import { useAgentModeMenu } from './hooks/useAgentModeMenu';
import { usePermissionLevelMenu } from './hooks/usePermissionLevelMenu';

import TokenProgress from './components/TokenProgress';
import FilePicker from './components/FilePicker';
import ModelMenu from './components/ModelMenu';
import ShortcutPanel from './components/ShortcutPanel';
import AgentModeMenu from './components/AgentModeMenu';
import PermissionLevelMenu from './components/PermissionLevelMenu';

import { setCustomCommands, setSkills, setAgents, getFilteredShortcutCommands } from './utils/commandUtils';
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
    getSelectionOffsets,
    setCaretOffset,
    insertNodeAtOffset
} from './utils/editorDom';
import { ShortcutCommand } from '../../../../utils/command';

// ─── 组件 ───────────────────────────────────────────────────────────────────

export interface InputBoxHandle {
    focus: () => void;
    setText: (text: string, attachments?: ImageAttachment[]) => void;
}

interface InputBoxProps {
    vscode: VscodeApi;
    disabled: boolean;
    placeholder: string;
    isGenerating: boolean;
    showBashPermission: boolean;
    onSend: (text: string, files: SelectedFile[], attachments: ImageAttachment[]) => void;
    onStop: () => void;
    tokenInfo: TokenInfo;
    modelName: string;
    availableModels: string[];
    agentMode: AgentMode;
    onAgentModeChange: (mode: AgentMode) => void;
    permissionLevel: PermissionLevel;
    onPermissionLevelChange: (level: PermissionLevel) => void;
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
    permissionLevel,
    onPermissionLevelChange
}, ref) => {
    const [inputValue, setInputValue] = useState<string>('');
    const [mentions, setMentions] = useState<InputMention[]>([]);
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [selectedCommandIndex, setSelectedCommandIndex] = useState<number>(0);
    const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
    const [shortcutCommands, setShortcutCommands] = useState<ShortcutCommand[]>(() => getFilteredShortcutCommands(''));
    const [filePickerQuery, setFilePickerQuery] = useState<string>('');
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);

    const pendingImages = usePendingImages();

    const inputBoxRef = useRef<HTMLDivElement>(null);
    const filePickerRef = useRef<HTMLDivElement>(null);
    const addFileButtonRef = useRef<HTMLButtonElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const modelButtonRef = useRef<HTMLButtonElement>(null);
    const shortcutPanelRef = useRef<HTMLDivElement>(null);
    const agentModeMenuRef = useRef<HTMLDivElement>(null);
    const agentModeButtonRef = useRef<HTMLButtonElement>(null);
    const permissionLevelMenuRef = useRef<HTMLDivElement>(null);
    const permissionLevelButtonRef = useRef<HTMLButtonElement>(null);
    const composingRef = useRef<boolean>(false);
    const atPositionRef = useRef<number>(-1);

    const inputHistory = useInputHistory();
    const editorHistory = useEditorHistory();
    const fileSelection = useFileSelection(vscode, filePickerRef, addFileButtonRef, inputBoxRef);
    const modelMenu = useModelMenu(vscode, disabled, modelName, modelMenuRef, modelButtonRef);
    const shortcutPanel = useShortcutPanel(disabled, shortcutPanelRef, inputBoxRef);
    const agentModeMenu = useAgentModeMenu(disabled, agentMode, onAgentModeChange, agentModeMenuRef, agentModeButtonRef);
    const permissionLevelMenu = usePermissionLevelMenu(disabled, onPermissionLevelChange, permissionLevelMenuRef, permissionLevelButtonRef);

    useImperativeHandle(ref, () => ({
        focus: () => { inputBoxRef.current?.focus(); },
        // 以纯文本回填输入框（如 Fork 后回填原输入），复用 completeShortcut/restoreFromHistory 的写入模式
        setText: (text: string, attachments?: ImageAttachment[]) => {
            const el = inputBoxRef.current;
            if (!el) return;
            renderEditorContent(el, text, []);
            setInputValue(text);
            setMentions([]);
            fileSelection.setSelectedFiles([]);
            // Fork 回填时一并恢复图片附件
            pendingImages.setFromAttachments(attachments || []);
            setCaretOffset(el, text.length);
            el.focus();
            editorHistory.reset({ text, mentions: [], caret: text.length });
        }
    }));

    // 启动时主动向扩展请求项目级输入历史
    useEffect(() => {
        // 撤销栈基线：空编辑器
        editorHistory.reset({ text: '', mentions: [], caret: 0 });
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
            vscode.postMessage({ type: 'requestAgents' });
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
            } else if (event.data.type === 'agentsLoaded' && Array.isArray(event.data.agents)) {
                setAgents(event.data.agents);
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

    // 从 DOM 重新读取文本/mentions，并触发 @ 触发区与 / 命令检测。
    // 返回算出的快照，供调用方决定是否落入撤销栈（本函数自身不 commit）。
    const syncFromDom = (caretOverride?: number | null): EditorSnapshot | null => {
        const el = inputBoxRef.current;
        if (!el) return null;
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

        return { text, mentions: ms, caret: cursorPos };
    };

    // 把一帧快照落入撤销栈；仅在真正由用户输入/操作驱动的路径调用
    const commitHistory = (snap: EditorSnapshot | null, kind: 'type' | 'op') => {
        if (snap) editorHistory.commit(snap, kind);
    };

    // 撤销/重做：整帧重建 DOM + 回填 React 状态，保证两者一致
    const applySnapshot = (snap: EditorSnapshot) => {
        const el = inputBoxRef.current; if (!el) return;
        renderEditorContent(el, snap.text, snap.mentions);
        setInputValue(snap.text);
        setMentions(snap.mentions);
        setCaretOffset(el, snap.caret);
        el.focus();
        // 刷新 @/命令面板等派生状态；此路径不再 commit，不污染撤销栈
        syncFromDom(snap.caret);
    };

    const handleEditorInput: React.FormEventHandler<HTMLDivElement> = () => {
        if (composingRef.current) return;
        commitHistory(syncFromDom(), 'type');
    };

    const handleCompositionEnd = () => {
        composingRef.current = false;
        // 输入法合成结束后再扫描 mention，避免拼音中间态误清
        commitHistory(syncFromDom(), 'type');
    };

    const handleCompositionStart = () => {
        composingRef.current = true;
    };

    const getClipboardPlainText = (clipboardData: DataTransfer): string => {
        const plainText = clipboardData.getData('text/plain');
        if (plainText) return plainText;

        const html = clipboardData.getData('text/html');
        if (html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return doc.body?.textContent || '';
        }

        return '';
    };

    const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = async (e) => {
        // 先记下选区区间：粘贴要用「新内容替换选中内容」，而 preventDefault 接管后浏览器
        // 不会自己删选区；且后续分支里有 await（读系统剪贴板 / 后端搜索），await 之后 DOM
        // 选区已丢失，所以必须在任何异步操作前把区间存下来。
        const selRange = (() => {
            const el = inputBoxRef.current;
            const r = el ? getSelectionOffsets(el) : null;
            return r ?? { start: inputValue.length, end: inputValue.length };
        })();

        // 剪贴板里的图片 blob（截图、或复制的图片文件都会有）
        const imageFiles: File[] = [];
        for (const item of Array.from(e.clipboardData.items)) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) imageFiles.push(f);
            }
        }

        const pastedText = getClipboardPlainText(e.clipboardData);
        // 剪贴板里是"复制的文件"（Finder / Explorer / VSCode 文件树）—— webview 沙箱拿不到 File.path，
        // 交给扩展端读系统剪贴板：拿到路径就插 @mention（含图片文件，core 自带解析）；
        // 拿不到路径 = 无文件路径的图片数据（如未保存的截图），退化为图片附件。
        // 注：Linux 不做文件路径检测（系统无自带剪贴板 CLI），但图片会经 imageFiles 兜底正常粘成图片块。
        if (!pastedText && e.clipboardData.files && e.clipboardData.files.length > 0) {
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
                // 必须 > 扩展端 readClipboardFiles 的 exec 超时（1500ms），否则
                // Windows PowerShell 冷启动慢时 webview 会先超时拿到 []，
                // 把"复制的图片文件"误判成截图塞进 base64 附件
                setTimeout(() => {
                    window.removeEventListener('message', onResult);
                    resolve([]);
                }, 2500);
            });
            if (paths.length > 0) {
                insertMentionsBatchAtCaret(paths.map(p => ({ path: p })), selRange);
            } else if (imageFiles.length > 0) {
                // 无文件路径的图片数据（如未保存的截图）→ 作为图片附件
                pendingImages.addFiles(imageFiles);
            }
            return;
        }

        if (!pastedText) return;
        e.preventDefault();

        const el = inputBoxRef.current;
        if (!el) return;

        // 短文本或 ≤3 行：纯文本插入（替换选区）
        if (pastedText.trim().length < 10 || pastedText.split('\n').length <= 3) {
            insertPlainTextAtCaretAt(inputValue, selRange.start, selRange.end, pastedText);
            return;
        }

        // 触发后端搜索
        const currentText = inputValue;

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
            insertMentionAtCaret(currentText, selRange.start, selRange.end, {
                path: foundFile.path,
                startLine: foundFile.startLine,
                endLine: foundFile.endLine
            });
        } else {
            insertPlainTextAtCaretAt(currentText, selRange.start, selRange.end, pastedText);
        }
    };

    // 用纯文本替换 [start, end) 区间（选区）后插入；无选区时 start === end 退化为单点插入
    const insertPlainTextAtCaretAt = (currentText: string, start: number, end: number, textToInsert: string) => {
        const el = inputBoxRef.current; if (!el) return;
        const newText = currentText.substring(0, start) + textToInsert + currentText.substring(end);
        const delta = textToInsert.length - (end - start);
        const newMentions: InputMention[] = mentions
            // 删除与选区相交的 mention（被替换掉的部分），其余在 end 之后的按 delta 平移
            .filter(m => !(m.start + m.length > start && m.start < end))
            .map(m => m.start >= end ? { ...m, start: m.start + delta } : m);
        renderEditorContent(el, newText, newMentions);
        setInputValue(newText);
        setMentions(newMentions);
        const newCaret = start + textToInsert.length;
        setCaretOffset(el, newCaret);
        el.focus();
        // 粘贴是「合成事件」，不会触发 onInput → 必须手动跑一遍 syncFromDom，
        // 否则 @ 后粘贴的查询词无法被检测到、FilePicker 仍停留在空 query 状态
        commitHistory(syncFromDom(newCaret), 'op');
    };

    // 纯函数：基于 (text, [start,end), mentions) 计算「替换选区后插入一个 mention」的新状态，便于循环累计。
    // 无选区时 start === end，退化为单点插入。
    const computeMentionInsertion = (
        currentText: string,
        start: number,
        end: number,
        curMentions: InputMention[],
        m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }
    ): { text: string; mentions: InputMention[]; caret: number } => {
        const before = currentText.substring(0, start);
        const after = currentText.substring(end);
        const needSpaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
        // \n 不再视为"已经有分隔"——否则删空后残留 <br> 时会渲染成 <span/><br>，光标视觉上挤到高亮末尾
        const needSpaceAfter = !after.startsWith(' ');
        const mentionText = '@' + m.path + (m.startLine !== undefined ? `:${m.startLine}-${m.endLine ?? m.startLine}` : '');
        const prefix = needSpaceBefore ? ' ' : '';
        const suffix = needSpaceAfter ? ' ' : '';
        const insertion = prefix + mentionText + suffix;
        const newText = before + insertion + after;
        const mentionStart = start + prefix.length;

        const delta = insertion.length - (end - start);
        const shifted: InputMention[] = curMentions
            // 删除与选区相交的 mention，其余在 end 之后的按 delta 平移
            .filter(om => !(om.start + om.length > start && om.start < end))
            .map(om => om.start >= end ? { ...om, start: om.start + delta } : om);
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

    // 用一个 mention 替换 [start,end) 区间（粘贴匹配 / 文件选择共用）
    const insertMentionAtCaret = (
        currentText: string,
        start: number,
        end: number,
        m: { path: string; isDirectory?: boolean; startLine?: number; endLine?: number }
    ) => {
        const el = inputBoxRef.current; if (!el) return;
        const r = computeMentionInsertion(currentText, start, end, mentions, m);
        renderEditorContent(el, r.text, r.mentions);
        setInputValue(r.text);
        setMentions(r.mentions);
        setCaretOffset(el, r.caret);
        el.focus();
        commitHistory({ text: r.text, mentions: r.mentions, caret: r.caret }, 'op');
    };

    // 依次插入多个 mention（多文件粘贴/拖拽）；首个替换选区，其余顺着光标续插。
    // selRange 由调用方在 await 前捕获；未传时回退到读取当前 DOM 选区。
    const insertMentionsBatchAtCaret = (
        items: Array<{ path: string; isDirectory?: boolean; startLine?: number; endLine?: number }>,
        selRange?: { start: number; end: number }
    ) => {
        const el = inputBoxRef.current; if (!el || items.length === 0) return;
        let text = inputValue;
        const range = selRange ?? getSelectionOffsets(el) ?? { start: text.length, end: text.length };
        let curMentions = mentions;
        let caret = range.end;
        items.forEach((m, i) => {
            // 首个 mention 替换整段选区，之后每个都在上一个落点续插（此时无选区）
            const start = i === 0 ? range.start : caret;
            const end = i === 0 ? range.end : caret;
            const r = computeMentionInsertion(text, start, end, curMentions, m);
            text = r.text; caret = r.caret; curMentions = r.mentions;
        });
        renderEditorContent(el, text, curMentions);
        setInputValue(text);
        setMentions(curMentions);
        setCaretOffset(el, caret);
        el.focus();
        commitHistory({ text, mentions: curMentions, caret }, 'op');
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
        commitHistory({ text: newText, mentions: newMentions, caret: atPos + mentionText.length + 1 }, 'op');

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
            commitHistory({ text: newText, mentions, caret: newText.length }, 'op');
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
        commitHistory({ text: newValue, mentions: [], caret: newValue.length }, 'op');
    };

    const sendShortcut = (text: string) => {
        if (disabled) return;
        const fullText = `/${text}`;
        const item = inputHistory.addToHistory(fullText, [], []);
        inputHistory.resetNavigation();
        if (item) vscode.postMessage({ type: 'saveInputHistory', item: { ...item, ts: Date.now() } });
        onSend(fullText, [], []);
        clearEditor();
        fileSelection.setSelectedFiles([]);
        shortcutPanel.setShowShortcutPanel(false);
    };

    const clearEditor = () => {
        const el = inputBoxRef.current;
        if (el) el.innerHTML = '';
        setInputValue('');
        setMentions([]);
        // 发送/清空后重设基线：撤销不会把已发送内容拉回来
        editorHistory.reset({ text: '', mentions: [], caret: 0 });
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
        const attachments = pendingImages.toAttachments();
        // 纯图片无文字也允许发送（core 接受 text 为空）
        if ((!trimmed && attachments.length === 0) || disabled) return;

        const files = filesFromMentions(mentions);
        // 图片不进输入历史（base64 太大）
        const item = inputHistory.addToHistory(text, files, mentions);
        inputHistory.resetNavigation();
        if (item) vscode.postMessage({ type: 'saveInputHistory', item: { ...item, ts: Date.now() } });

        onSend(trimmed, files, attachments);
        clearEditor();
        fileSelection.setSelectedFiles([]);
        pendingImages.clear();
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
        commitHistory({ text: item.text, mentions: item.mentions, caret: item.text.length }, 'op');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // 撤销 / 重做：走自建栈，整帧重建，避免原生 contentEditable undo 破坏 mention 状态。
        // 三端键位：Undo = Cmd/Ctrl+Z；Redo = Cmd+Shift+Z(mac) 或 Ctrl+Y(win/linux)。
        // stopPropagation 同 Ctrl+W：阻止事件外泄触发 VSCode 宿主自带的撤销。
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            if (composingRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            const snap = editorHistory.undo();
            if (snap) applySnapshot(snap);
            return;
        }
        if (
            ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
            (e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y'))
        ) {
            if (composingRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            const snap = editorHistory.redo();
            if (snap) applySnapshot(snap);
            return;
        }

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
                    commitHistory(syncFromDom(0), 'op');
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
                        // 仅 send 标记的内置命令（clear/compact）回车直发；
                        // 自定义命令/技能/子代理回车与 Tab 一致：填入输入框，便于继续输入参数。
                        if (sel) {
                            if (sel.send) sendShortcut(sel.text);
                            else completeShortcut(sel.text);
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
            commitHistory({ text: newText, mentions: newMentions, caret: start }, 'op');
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
            commitHistory({ text: newText, mentions: newMentions, caret: deleteFrom }, 'op');
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
                commitHistory(syncFromDom(caret + 1), 'op');
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

    const canSend = (inputValue.trim().length > 0 || pendingImages.images.length > 0) && !disabled;

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
                    {pendingImages.images.length > 0 && (
                        <div className="image-thumb-strip">
                            {pendingImages.images.map(img => (
                                <ImageThumbnail
                                    key={img.id}
                                    src={img.previewUrl}
                                    mediaType={img.media_type}
                                    name={img.name}
                                    width={img.width}
                                    height={img.height}
                                    deletable
                                    onOpen={setPreviewSrc}
                                    onDelete={() => pendingImages.remove(img.id)}
                                />
                            ))}
                        </div>
                    )}
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

                    <span className="bottom-separator separator-autoedit">|</span>
                    <div className="permission-level-container">
                        <Tooltip content={disabled || permissionLevelMenu.showPermissionLevelMenu ? '' : '切换权限档位'}>
                            <button
                                ref={permissionLevelButtonRef}
                                className={`permission-level-btn level-${permissionLevel.toLowerCase()}`}
                                onClick={permissionLevelMenu.handleTogglePermissionLevelMenu}
                                disabled={disabled}
                            >
                                <span>{permissionLevel}</span>
                                <ChevronDownIcon />
                            </button>
                        </Tooltip>
                        <PermissionLevelMenu
                            show={permissionLevelMenu.showPermissionLevelMenu}
                            currentLevel={permissionLevel}
                            onLevelSelect={permissionLevelMenu.handlePermissionLevelSelect}
                            menuRef={permissionLevelMenuRef}
                        />
                    </div>
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

            {previewSrc && (
                <ImagePreviewModal src={previewSrc} onClose={() => setPreviewSrc(null)} />
            )}
        </div>
    );
});

export default InputBox;
