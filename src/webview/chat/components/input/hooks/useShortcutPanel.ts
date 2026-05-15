import { useState, useEffect, RefObject } from 'react';

export interface UseShortcutPanelReturn {
    showShortcutPanel: boolean;
    setShowShortcutPanel: (show: boolean) => void;
    handleToggleShortcutPanel: () => void;
}

/**
 * 快捷面板管理 Hook
 */
export const useShortcutPanel = (
    disabled: boolean,
    shortcutPanelRef: RefObject<HTMLDivElement>,
    inputBoxRef: RefObject<HTMLElement>
): UseShortcutPanelReturn => {
    const [showShortcutPanel, setShowShortcutPanel] = useState<boolean>(false);

    // 点击外部关闭快捷面板（输入框内点击不视为外部，避免用户继续输入时被关闭）
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const isOutsidePanel = shortcutPanelRef.current && !shortcutPanelRef.current.contains(target);
            const isOutsideInput = inputBoxRef.current && !inputBoxRef.current.contains(target);

            if (isOutsidePanel && isOutsideInput) {
                setShowShortcutPanel(false);
            }
        };

        if (showShortcutPanel) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showShortcutPanel, shortcutPanelRef, inputBoxRef]);

    const handleToggleShortcutPanel = () => {
        if (disabled) return;
        setShowShortcutPanel(!showShortcutPanel);
    };

    return {
        showShortcutPanel,
        setShowShortcutPanel,
        handleToggleShortcutPanel
    };
};
