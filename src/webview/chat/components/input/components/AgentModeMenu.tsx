import React from 'react';
import { CheckIcon } from '../../ui/IconButton';
import type { AgentMode } from '../../../types';

interface AgentModeMenuProps {
    show: boolean;
    currentMode: AgentMode;
    onModeSelect: (mode: AgentMode) => void;
    agentModeMenuRef: React.RefObject<HTMLDivElement>;
}

const AGENT_MODES: AgentMode[] = ['Agent', 'Plan', 'Design'];

const AgentModeMenu: React.FC<AgentModeMenuProps> = ({
    show,
    currentMode,
    onModeSelect,
    agentModeMenuRef
}) => {
    if (!show) return null;

    return (
        <div ref={agentModeMenuRef} className="agent-mode-menu-popup">
            {AGENT_MODES.map(mode => (
                <div
                    key={mode}
                    className={`agent-mode-menu-item ${currentMode === mode ? 'agent-mode-current' : ''}`}
                    onClick={() => onModeSelect(mode)}
                >
                    <span className="agent-mode-menu-text">{mode}</span>
                    {mode === 'Design' && <span className="agent-mode-beta-tag">beta</span>}
                    {currentMode === mode && <CheckIcon />}
                </div>
            ))}
        </div>
    );
};

export default AgentModeMenu;
