import React, { useState, useEffect } from 'react';

interface Session {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    content: any[];
    projectPath: string;
    agentMode?: 'Agent' | 'Plan' | 'Design';
}

interface VscodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

interface AppProps {
    vscode: VscodeApi;
}

const App: React.FC<AppProps> = ({ vscode }) => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    useEffect(() => {
        // 接收来自扩展的消息
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'updateSessions':
                    setSessions(message.sessions || []);
                    if (message.currentSessionId !== undefined) {
                        setCurrentSessionId(message.currentSessionId);
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);

        // 通知扩展组件已准备好
        vscode.postMessage({ type: 'webviewReady' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const loadSession = (sessionId: string) => {
        vscode.postMessage({
            type: 'loadSession',
            sessionId: sessionId
        });
    };

    const deleteSession = (event: React.MouseEvent, sessionId: string) => {
        event.stopPropagation();
        vscode.postMessage({
            type: 'deleteSession',
            sessionId: sessionId
        });
    };

    const formatTime = (timestamp: number): string => {
        const now = new Date();
        const date = new Date(timestamp);

        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const diffTime = Math.abs(now.getTime() - timestamp);
        const diffDays = Math.floor((today.getTime() - targetDay.getTime()) / (24 * 60 * 60 * 1000));

        const timeStr = date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // 1分钟内：刚刚
        if (diffTime < 60 * 1000) {
            return '刚刚';
        }
        // 1小时内：X分钟前
        else if (diffTime < 60 * 60 * 1000) {
            const minutes = Math.floor(diffTime / (60 * 1000));
            return `${minutes}分钟前`;
        }
        // 今天
        else if (diffDays === 0) {
            return timeStr;
        }
        // 昨天
        else if (diffDays === 1) {
            return `昨天 ${timeStr}`;
        }
        // 7天内
        else if (diffDays < 7) {
            return `${diffDays}天前`;
        }
        // 今年内
        else if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        // 跨年
        else {
            return date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    };

    return (
        <div className="container">
            <div className="header">
                <div className="title">历史会话</div>
                <div className="subtitle">点击会话可加载对话记录</div>
            </div>

            <div className="sessions-container">
                {sessions.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">📝</div>
                        <div className="empty-text">暂无历史会话</div>
                    </div>
                ) : (
                    sessions.map(session => {
                        // 判断当前会话的两种情况：临时标记为'current'或者与currentSessionId匹配
                        const isCurrent = session.id === 'current' || session.id === currentSessionId;
                        const clickable = !isCurrent;
                        const itemClass = clickable
                            ? 'session-item'
                            : 'session-item session-current-active';

                        return (
                            <div
                                key={session.id}
                                className={itemClass}
                                onClick={clickable ? () => loadSession(session.id) : undefined}
                            >
                                <div className="session-header">
                                    <div className="session-title-section">
                                        <div className="session-title">{session.title}</div>
                                    </div>
                                    <div className="session-badges">
                                        {session.agentMode === 'Design' && (
                                            <span className="session-mode-design">Design</span>
                                        )}
                                        {isCurrent && (
                                            <span className="session-current">当前</span>
                                        )}
                                        {!isCurrent && (
                                            <button
                                                className="session-delete"
                                                onClick={(e) => deleteSession(e, session.id)}
                                            >
                                                删除
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="session-times">
                                    <div className="session-time">
                                        <span className="time-label">create: </span>
                                        {formatTime(session.createdAt)}
                                    </div>
                                    <div className="session-time">
                                        <span className="time-label">update: </span>
                                        {formatTime(session.updatedAt)}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default App;

