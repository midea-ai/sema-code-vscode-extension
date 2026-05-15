import React, { useState, useRef } from 'react';

interface UserInputBlockProps {
    content: string;
}

const UserInputBlock: React.FC<UserInputBlockProps> = React.memo(({ content }) => {
    
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editValue, setEditValue] = useState<string>(content);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleClick = () => {
        setIsEditing(true);
        // 延迟聚焦以确保textarea已渲染
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                // 将光标移到末尾
                textareaRef.current.selectionStart = textareaRef.current.value.length;
                textareaRef.current.selectionEnd = textareaRef.current.value.length;
            }
        }, 0);
    };

    const handleBlur = () => {
        setIsEditing(false);
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setEditValue(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape' || e.key === 'c' && e.ctrlKey) {
            // ESC键退出编辑
            setEditValue(content); // 恢复原始内容
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <div className="user-input-block editing">
                <textarea
                    ref={textareaRef}
                    className="user-input-textarea"
                    value={editValue}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    readOnly={false}
                />
            </div>
        );
    }

    return (
        <div className="user-input-block clickable" onClick={handleClick}>
            <div className="user-input-content">{content}</div>
        </div>
    );
});

UserInputBlock.displayName = 'UserInputBlock';

export default UserInputBlock;