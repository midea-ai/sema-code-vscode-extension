import { useState, useEffect, RefObject } from 'react';
import type { AgentMode } from '../../../types';

export interface UseAgentModeMenuReturn {
    showAgentModeMenu: boolean;
    setShowAgentModeMenu: (show: boolean) => void;
    handleToggleAgentModeMenu: () => void;
    handleAgentModeSelect: (mode: AgentMode) => void;
}

/**
 * Agent 模式菜单管理 Hook
 */
export const useAgentModeMenu = (
    disabled: boolean,
    agentMode: AgentMode,
    onAgentModeChange: (mode: AgentMode) => void,
    agentModeMenuRef: RefObject<HTMLDivElement>,
    agentModeButtonRef: RefObject<HTMLButtonElement>
): UseAgentModeMenuReturn => {
    const [showAgentModeMenu, setShowAgentModeMenu] = useState<boolean>(false);

    // 点击外部关闭 agent mode 菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showAgentModeMenu &&
                agentModeMenuRef.current &&
                !agentModeMenuRef.current.contains(event.target as Node) &&
                agentModeButtonRef.current &&
                !agentModeButtonRef.current.contains(event.target as Node)) {
                setShowAgentModeMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showAgentModeMenu, agentModeMenuRef, agentModeButtonRef]);

    const handleToggleAgentModeMenu = () => {
        if (!disabled) {
            setShowAgentModeMenu(!showAgentModeMenu);
        }
    };

    const handleAgentModeSelect = (mode: AgentMode) => {
        onAgentModeChange(mode);
        setShowAgentModeMenu(false);
    };

    return {
        showAgentModeMenu,
        setShowAgentModeMenu,
        handleToggleAgentModeMenu,
        handleAgentModeSelect
    };
};
