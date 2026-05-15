import { useState } from 'react';
import { SelectedFile, InputMention, InputHistoryItem } from '../../../types';

const MAX_HISTORY = 50;

export interface HistoryItem {
    text: string;
    files: SelectedFile[];
    mentions: InputMention[];
}

export interface UseInputHistoryReturn {
    inputHistory: HistoryItem[];
    historyIndex: number;
    tempInput: HistoryItem;
    addToHistory: (text: string, files: SelectedFile[], mentions: InputMention[]) => HistoryItem | null;
    navigateHistory: (direction: 'up' | 'down', currentInput: string, currentFiles: SelectedFile[], currentMentions: InputMention[]) => HistoryItem;
    resetNavigation: () => void;
    exitNavigation: () => void;
    initializeHistory: (items: InputHistoryItem[]) => void;
}

const emptyItem = (): HistoryItem => ({ text: '', files: [], mentions: [] });

export const useInputHistory = (): UseInputHistoryReturn => {
    const [inputHistory, setInputHistory] = useState<HistoryItem[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const [tempInput, setTempInput] = useState<HistoryItem>(emptyItem());

    const addToHistory = (text: string, files: SelectedFile[], mentions: InputMention[]): HistoryItem | null => {
        if (!text) return null;
        const lastItem = inputHistory[inputHistory.length - 1];
        const sameMentions = lastItem && JSON.stringify(lastItem.mentions) === JSON.stringify(mentions);
        const isDuplicate = lastItem && lastItem.text === text && sameMentions;
        if (isDuplicate) return null;

        const item: HistoryItem = { text, files: [...files], mentions: [...mentions] };
        const newHistory = [...inputHistory, item];
        if (newHistory.length > MAX_HISTORY) newHistory.shift();
        setInputHistory(newHistory);
        return item;
    };

    const navigateHistory = (
        direction: 'up' | 'down',
        currentInput: string,
        currentFiles: SelectedFile[],
        currentMentions: InputMention[]
    ): HistoryItem => {
        if (direction === 'up' && inputHistory.length > 0) {
            if (historyIndex === -1) {
                setTempInput({ text: currentInput, files: [...currentFiles], mentions: [...currentMentions] });
                setHistoryIndex(inputHistory.length - 1);
                return inputHistory[inputHistory.length - 1];
            } else if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                return inputHistory[newIndex];
            }
        } else if (direction === 'down' && historyIndex !== -1) {
            if (historyIndex < inputHistory.length - 1) {
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                return inputHistory[newIndex];
            } else {
                setHistoryIndex(-1);
                return tempInput;
            }
        }
        return { text: currentInput, files: currentFiles, mentions: currentMentions };
    };

    const resetNavigation = () => {
        setHistoryIndex(-1);
        setTempInput(emptyItem());
    };

    const exitNavigation = () => {
        setHistoryIndex(-1);
        setTempInput(emptyItem());
    };

    const initializeHistory = (items: InputHistoryItem[]) => {
        const normalized: HistoryItem[] = items
            .filter(it => it && typeof it.text === 'string')
            .map(it => ({
                text: it.text,
                files: Array.isArray(it.files) ? it.files : [],
                mentions: Array.isArray(it.mentions) ? it.mentions : []
            }));
        const limited = normalized.slice(-MAX_HISTORY);
        setInputHistory(limited);
        setHistoryIndex(-1);
        setTempInput(emptyItem());
    };

    return {
        inputHistory,
        historyIndex,
        tempInput,
        addToHistory,
        navigateHistory,
        resetNavigation,
        exitNavigation,
        initializeHistory
    };
};
