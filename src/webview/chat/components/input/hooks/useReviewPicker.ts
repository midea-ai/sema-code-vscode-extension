import React, { useState, useEffect, useMemo, useRef, RefObject } from 'react';
import { VscodeApi } from '../../../types';
import { REVIEW_COMMAND, ReviewInfo, ReviewCommit } from '../../../../../utils/review';
import { useT } from '../../../../common/i18n/react';
import { getCaretOffset } from '../utils/editorDom';
import type { ReviewPickerItem, ReviewPickerProps } from '../components/ReviewPicker';

export interface UseReviewPickerReturn {
    /** 直接展开给 <ReviewPicker /> */
    panelProps: ReviewPickerProps;
    /** 斜杠面板选中「审查」时调用：打开范围面板（调用方先清空输入框，命令本身不进输入框） */
    open: () => void;
    /** 输入框文本被用户改动后调用：范围步骤视为改去输入别的内容，关闭面板；提交步骤是过滤词变化，回到首项 */
    onTextChange: () => void;
    /** 面板打开时处理 ↑↓ / 回车 / Tab / Esc；返回 true 表示按键已被面板接管 */
    handleKeyDown: (e: React.KeyboardEvent, composing: boolean) => boolean;
}

/**
 * /review 范围面板 Hook：第一步选「未提交的改动 / 某次提交」，第二步选具体提交，选定后经 send 直接发送
 * `/review uncommitted` 或 `/review commit <sha>`，由宿主解析并发起审查。
 * 面板打开期间输入框里不放命令：要么选定后直接发送，要么中途关掉、输入框不留痕迹。
 * 数据由宿主经 VS Code 的 git 扩展提供；JetBrains 端没有这条通路，面板不会打开。
 */
export const useReviewPicker = (
    vscode: VscodeApi,
    disabled: boolean,
    inputValue: string,
    inputBoxRef: RefObject<HTMLElement>,
    /** 发送一条斜杠命令（不含 /） */
    send: (text: string) => void,
    /** 清空输入框（从提交列表退回范围时清掉过滤词） */
    clearInput: () => void,
    /** 从范围一步返回斜杠命令面板 */
    backToCommands: () => void
): UseReviewPickerReturn => {
    const t = useT();
    // scope = 选范围，commit = 选具体提交；null = 未打开
    const [step, setStep] = useState<'scope' | 'commit' | null>(null);
    const [index, setIndex] = useState<number>(0);
    const [info, setInfo] = useState<ReviewInfo | null>(null);
    const [commits, setCommits] = useState<ReviewCommit[] | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'reviewInfoLoaded' && message.info) {
                setInfo(message.info);
            } else if (message.type === 'reviewCommitsLoaded' && Array.isArray(message.commits)) {
                setCommits(message.commits);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // 每次打开都向宿主重取范围信息（改动随时在变）；提交列表在进入提交步骤时才取
    const open = () => {
        if (disabled || (window as any).__SEMA_JB__) return;
        setStep('scope');
        setIndex(0);
        setInfo(null);
        setCommits(null);
        vscode.postMessage({ type: 'requestReviewInfo' });
    };

    // 点击面板与输入框以外的地方关闭；输入被禁用时一并关闭
    useEffect(() => {
        if (!step) return;
        if (disabled) { setStep(null); return; }
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const outsidePanel = panelRef.current && !panelRef.current.contains(target);
            const outsideInput = inputBoxRef.current && !inputBoxRef.current.contains(target);
            if (outsidePanel && outsideInput) setStep(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [step, disabled]);

    const onTextChange = () => {
        if (step === 'scope') setStep(null);
        else if (step === 'commit') setIndex(0);
    };

    // 提交步骤的过滤词：面板打开期间输入框里敲的文字
    const query = inputValue.trim().toLowerCase();

    const items: ReviewPickerItem[] = useMemo(() => {
        if (step === 'scope') {
            const reasonText = info?.reason ? t(`chat.review.${info.reason}`) : '';
            // 两个选项固定写英文，不随界面语言变（同技能名的做法）；右侧只在不可选时给出原因
            // 信息还没回来时不置灰：直接回车也能发起，范围为空由宿主提示
            return [
                { key: 'uncommitted', tag: '[未提交]', label: 'Review uncommitted changes', desc: reasonText || (info?.files === 0 ? t('chat.review.noChanges') : ''), disabled: !!reasonText || info?.files === 0 },
                { key: 'commit', tag: '[已提交]', label: 'Review a commit', desc: reasonText, disabled: !!reasonText },
            ];
        }
        if (step === 'commit') {
            return (commits ?? [])
                .filter(c => !query || c.subject.toLowerCase().includes(query) || c.hash.toLowerCase().startsWith(query))
                // 只显示提交标题（没有标题时退回短 sha）
                .map(c => ({ key: c.hash, label: c.subject || c.hash.slice(0, 7), desc: '' }));
        }
        return [];
    }, [step, info, commits, query, t]);

    const selectedIndex = Math.max(0, Math.min(index, items.length - 1));

    const select = (i: number) => {
        const item = items[i];
        if (!item || item.disabled) return;
        if (step === 'commit') {
            setStep(null);
            send(`${REVIEW_COMMAND} commit ${item.key}`);
            return;
        }
        if (item.key === 'uncommitted') {
            setStep(null);
            send(`${REVIEW_COMMAND} uncommitted`);
            return;
        }
        // 「某次提交…」：进入提交列表，在输入框里打字可过滤；本次打开期间已取过就不再重取
        setStep('commit');
        setIndex(0);
        if (commits === null) vscode.postMessage({ type: 'requestReviewCommits' });
        inputBoxRef.current?.focus();
    };

    // 返回上一步：提交列表 → 范围（清掉过滤词，停在「某次提交…」）；范围 → 斜杠命令面板
    const back = () => {
        if (step === 'commit') {
            clearInput();
            setStep('scope');
            setIndex(1);
        } else {
            setStep(null);
            backToCommands();
        }
    };

    // ↑↓ 移动，回车 / Tab / → 选定，Esc / ← 返回上一步（← 仅在输入框为空时，有过滤词时照常移动光标）
    const handleKeyDown = (e: React.KeyboardEvent, composing: boolean): boolean => {
        if (!step) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const count = items.length;
            if (count > 0) setIndex((selectedIndex + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
            return true;
        }
        // → 等同 Tab：仅在光标已在末尾、不带修饰键、非输入法选字时，否则照常移动光标 / 扩选
        const rightAsTab = e.key === 'ArrowRight' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !composing
            && (inputValue === '' || (!!inputBoxRef.current && getCaretOffset(inputBoxRef.current) === inputValue.length));
        if (e.key === 'Tab' || rightAsTab || (e.key === 'Enter' && !e.shiftKey)) {
            if (e.key === 'Enter' && composing) return true;
            e.preventDefault();
            select(selectedIndex);
            return true;
        }
        if (e.key === 'Escape' || (e.key === 'ArrowLeft' && inputValue === '')) {
            e.preventDefault();
            back();
            return true;
        }
        return false;
    };

    return {
        panelProps: {
            show: !!step,
            title: t(step === 'commit' ? 'chat.review.commitsTitle' : 'chat.review.pickerTitle'),
            items,
            emptyText: commits === null ? t('common.loading') : t('chat.review.noCommits'),
            selectedIndex,
            onSelect: select,
            panelRef,
        },
        open,
        onTextChange,
        handleKeyDown,
    };
};
