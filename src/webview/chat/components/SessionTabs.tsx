import React from 'react';
import { SessionMeta } from '../types';

interface SessionTabsProps {
    sessions: SessionMeta[];
    activeId: string | null;
    onSwitch: (id: string) => void;
    onClose: (id: string) => void;
}

/**
 * 会话 tab 栏：切换 / 关闭会话。
 * 仅在多会话时显示；单会话无需 tab。
 * 新建会话入口统一放在 VSCode 视图标题栏的 $(add) 图标。
 */
const SessionTabs: React.FC<SessionTabsProps> = ({ sessions, activeId, onSwitch, onClose }) => {
    if (sessions.length <= 1) {
        return null;
    }
    return (
        <div className="session-tabs">
            <div className="session-tabs-list">
                {sessions.map(s => (
                    <div
                        key={s.id}
                        className={`session-tab${s.id === activeId ? ' active' : ''}${s.isClaw ? ' claw' : ''}`}
                        onClick={() => onSwitch(s.id)}
                        title={s.title || '新会话'}
                    >
                        {(s.processing || s.waiting) && (
                            <span className={`session-tab-dot${s.waiting ? ' waiting' : ''}`} />
                        )}
                        <span className="session-tab-title">{s.title || '新会话'}</span>
                        {s.id === activeId && (
                            <span
                                className="session-tab-close"
                                title="关闭会话"
                                onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
                            >×</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SessionTabs;
