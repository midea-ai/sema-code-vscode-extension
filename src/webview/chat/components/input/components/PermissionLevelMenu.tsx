import React from 'react';
import { CheckIcon } from '../../ui/IconButton';
import type { PermissionLevel } from '../../../types';

interface PermissionLevelMenuProps {
    show: boolean;
    currentLevel: PermissionLevel;
    onLevelSelect: (level: PermissionLevel) => void;
    menuRef: React.RefObject<HTMLDivElement>;
}

const PERMISSION_LEVELS: PermissionLevel[] = ['Ask', 'AutoEdit', 'AutoRun'];

/** 各档位在菜单中的说明文案 */
const PERMISSION_LEVEL_DESC: Record<PermissionLevel, string> = {
    Ask: 'Ask before every action',
    AutoEdit: 'Auto-approve edits',
    AutoRun: 'Auto-approve all, ask if risky'
};

const PermissionLevelMenu: React.FC<PermissionLevelMenuProps> = ({
    show,
    currentLevel,
    onLevelSelect,
    menuRef
}) => {
    if (!show) return null;

    return (
        <div ref={menuRef} className="permission-level-menu-popup">
            {PERMISSION_LEVELS.map(level => (
                <div
                    key={level}
                    className={`permission-level-menu-item ${currentLevel === level ? 'permission-level-current' : ''}`}
                    onClick={() => onLevelSelect(level)}
                >
                    <div className="permission-level-menu-texts">
                        <span className="permission-level-menu-name">{level}</span>
                        <span className="permission-level-menu-desc">{PERMISSION_LEVEL_DESC[level]}</span>
                    </div>
                    {currentLevel === level && <CheckIcon />}
                </div>
            ))}
        </div>
    );
};

export default PermissionLevelMenu;
