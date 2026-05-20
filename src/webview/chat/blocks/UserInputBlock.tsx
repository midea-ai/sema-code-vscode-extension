import React, { useEffect, useRef, useState } from 'react';

interface UserInputBlockProps {
    content: string;
}

const UserInputBlock: React.FC<UserInputBlockProps> = React.memo(({ content }) => {
    
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editValue, setEditValue] = useState<string>(content);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 点击编辑区域外部时退出编辑
    useEffect(() => {
        if (!isEditing) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const block = blockRef.current;
            if (block && !block.contains(event.target as Node)) {
                setIsEditing(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [isEditing]);

    const handleClick = () => {
        // 记录选中区域位置，以便在编辑模式下恢复光标
        const selection = window.getSelection();
        let nextSelection: [number, number] | null = null;
        if (selection && selection.rangeCount > 0 && contentRef.current) {
            const range = selection.getRangeAt(0);
            if (contentRef.current.contains(range.commonAncestorContainer)) {
                const beforeRange = range.cloneRange();
                beforeRange.selectNodeContents(contentRef.current);
                beforeRange.setEnd(range.startContainer, range.startOffset);
                const start = beforeRange.toString().length;
                nextSelection = [start, start + range.toString().length];
            }
        }

        setIsEditing(true);
        // 延迟聚焦以确保textarea已渲染
        setTimeout(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
                return;
            }

            textarea.focus();
            textarea.selectionStart = nextSelection ? nextSelection[0] : textarea.value.length;
            textarea.selectionEnd = nextSelection ? nextSelection[1] : textarea.value.length;
        }, 0);
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setEditValue(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
            // ESC键退出编辑
            setEditValue(content); // 恢复原始内容
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <div ref={blockRef} className="user-input-block editing">
                <textarea
                    ref={textareaRef}
                    className="user-input-textarea"
                    value={editValue}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                />
            </div>
        );
    }

    return (
        <div ref={blockRef} className="user-input-block clickable" onClick={handleClick}>
            <div ref={contentRef} className="user-input-content">{content}</div>
        </div>
    );
});

UserInputBlock.displayName = 'UserInputBlock';

export default UserInputBlock;