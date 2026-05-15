import React, { useState, useEffect } from 'react';
import { ToggleIcon, CheckIcon } from '../ui/IconButton';

interface TodoItem {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed';
    progressText: string;
}

interface TodosPanelProps {
    todos: TodoItem[];
    onScrollToBottom?: () => void;
}

const TodosPanel: React.FC<TodosPanelProps> = ({ todos, onScrollToBottom }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (isExpanded && onScrollToBottom) {
            const timer = setTimeout(onScrollToBottom, 50);
            return () => clearTimeout(timer);
        }
    }, [todos.length]);
    
    if (todos.length === 0) {
        return null;
    }
    
    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };
    
    const completedCount = todos.filter(t => t.status === 'completed').length;
    const totalCount = todos.length;
    
    return (
        <div className="todos-panel">
            <div className="todos-panel-header" onClick={handleToggle}>
                <ToggleIcon isExpanded={isExpanded} />
                <span className="todos-panel-title">Todos {completedCount}/{totalCount}</span>
            </div>
            {isExpanded && (
                <div className="todos-panel-content">
                    {todos.map((todo, index) => {
                        // 正在进行的项目显示 progressText，其他状态显示 title
                        const displayText = todo.status === 'in_progress' && todo.progressText
                            ? todo.progressText
                            : todo.title;

                        // 根据状态设置不同的图标和样式
                        let statusIcon = '○'; // pending
                        let statusClass = 'pending';

                        if (todo.status === 'completed') {
                            statusIcon = '●';
                            statusClass = 'completed';
                        } else if (todo.status === 'in_progress') {
                            statusIcon = '◐';
                            statusClass = 'in-progress';
                        }

                        return (
                            <div key={todo.id} className={`todo-panel-item ${statusClass}`}>
                                <span className={`todo-panel-circle ${statusClass}`}>
                                    {todo.status === 'completed' ? <CheckIcon /> : statusIcon}
                                </span>
                                <span className="todo-panel-text">{displayText}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TodosPanel;

