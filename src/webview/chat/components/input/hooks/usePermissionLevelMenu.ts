import { useState, useEffect, RefObject } from 'react';
import type { PermissionLevel } from '../../../types';

export interface UsePermissionLevelMenuReturn {
    showPermissionLevelMenu: boolean;
    setShowPermissionLevelMenu: (show: boolean) => void;
    handleTogglePermissionLevelMenu: () => void;
    handlePermissionLevelSelect: (level: PermissionLevel) => void;
}

/**
 * 权限档位菜单管理 Hook
 */
export const usePermissionLevelMenu = (
    disabled: boolean,
    onPermissionLevelChange: (level: PermissionLevel) => void,
    menuRef: RefObject<HTMLDivElement>,
    buttonRef: RefObject<HTMLButtonElement>
): UsePermissionLevelMenuReturn => {
    const [showPermissionLevelMenu, setShowPermissionLevelMenu] = useState<boolean>(false);

    // 点击外部关闭权限档位菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showPermissionLevelMenu &&
                menuRef.current &&
                !menuRef.current.contains(event.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(event.target as Node)) {
                setShowPermissionLevelMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showPermissionLevelMenu, menuRef, buttonRef]);

    const handleTogglePermissionLevelMenu = () => {
        if (!disabled) {
            setShowPermissionLevelMenu(!showPermissionLevelMenu);
        }
    };

    const handlePermissionLevelSelect = (level: PermissionLevel) => {
        onPermissionLevelChange(level);
        setShowPermissionLevelMenu(false);
    };

    return {
        showPermissionLevelMenu,
        setShowPermissionLevelMenu,
        handleTogglePermissionLevelMenu,
        handlePermissionLevelSelect
    };
};
