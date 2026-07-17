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
    const [orderedIds, setOrderedIds] = React.useState<string[]>(() => sessions.map(s => s.id));
    const [draggingId, setDraggingId] = React.useState<string | null>(null);
    const [dragOver, setDragOver] = React.useState<{ id: string; position: 'before' | 'after' } | null>(null);
    const draggingIdRef = React.useRef<string | null>(null);
    const didDragRef = React.useRef(false);
    const suppressClickUntilRef = React.useRef(0);

    React.useEffect(() => {
        setOrderedIds(prev => {
            const sessionIds = sessions.map(s => s.id);
            const sessionIdSet = new Set(sessionIds);
            const next = prev.filter(id => sessionIdSet.has(id));

            for (const id of sessionIds) {
                if (!next.includes(id)) {
                    next.push(id);
                }
            }

            if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
                return prev;
            }
            return next;
        });
    }, [sessions]);

    const orderedSessions = React.useMemo(() => {
        const sessionById = new Map(sessions.map(s => [s.id, s]));
        const ordered = orderedIds
            .map(id => sessionById.get(id))
            .filter((session): session is SessionMeta => Boolean(session));
        const orderedIdSet = new Set(orderedIds);
        const missing = sessions.filter(s => !orderedIdSet.has(s.id));
        return [...ordered, ...missing];
    }, [orderedIds, sessions]);

    if (sessions.length <= 1) {
        return null;
    }

    const getDropPosition = (event: React.DragEvent<HTMLElement>): 'before' | 'after' => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    };

    const resetDragState = () => {
        draggingIdRef.current = null;
        didDragRef.current = false;
        setDraggingId(null);
        setDragOver(null);
    };

    const suppressDragClick = () => {
        suppressClickUntilRef.current = Date.now() + 150;
    };

    const handleDragStart = (event: React.DragEvent<HTMLDivElement>, id: string) => {
        draggingIdRef.current = id;
        didDragRef.current = false;
        setDraggingId(id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
        const sourceId = draggingIdRef.current || event.dataTransfer.getData('text/plain');
        if (!sourceId || sourceId === targetId) {
            return;
        }

        didDragRef.current = true;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragOver({ id: targetId, position: getDropPosition(event) });
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
        const sourceId = draggingIdRef.current || event.dataTransfer.getData('text/plain');
        if (!sourceId || sourceId === targetId) {
            resetDragState();
            return;
        }

        event.preventDefault();
        suppressDragClick();
        const position = getDropPosition(event);

        setOrderedIds(prev => {
            const withoutSource = prev.filter(id => id !== sourceId);
            const targetIndex = withoutSource.indexOf(targetId);
            if (targetIndex < 0) {
                return prev;
            }

            const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
            const next = [...withoutSource];
            next.splice(insertIndex, 0, sourceId);
            return next;
        });
        resetDragState();
    };

    const handleDragEnd = () => {
        if (didDragRef.current) {
            suppressDragClick();
        }
        resetDragState();
    };

    const handleTabClick = (id: string) => {
        if (Date.now() < suppressClickUntilRef.current) {
            return;
        }
        onSwitch(id);
    };

    return (
        <div className="session-tabs">
            <div className="session-tabs-list">
                {orderedSessions.map(s => (
                    <div
                        key={s.id}
                        className={`session-tab${s.id === activeId ? ' active' : ''}${s.isClaw ? ' claw' : ''}${s.id === draggingId ? ' dragging' : ''}${dragOver?.id === s.id ? ` drag-over-${dragOver.position}` : ''}`}
                        draggable
                        onClick={() => handleTabClick(s.id)}
                        onDragStart={(e) => handleDragStart(e, s.id)}
                        onDragOver={(e) => handleDragOver(e, s.id)}
                        onDrop={(e) => handleDrop(e, s.id)}
                        onDragEnd={handleDragEnd}
                        onDragLeave={() => setDragOver(prev => prev?.id === s.id ? null : prev)}
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
