import React, { useState, useEffect, useRef } from 'react';

interface PermissionOptionsProps {
    options: {
        agree: string;
        allow?: string;
        refuse: string;
    };
    onSelect: (action: 'agree' | 'allow' | 'refuse', customInput?: string) => void;
    onCancel?: () => void;
    autoFocus?: boolean;
    showCustomInput?: boolean;
    customInputPlaceholder?: string;
}

const PermissionOptions: React.FC<PermissionOptionsProps> = ({
    options,
    onSelect,
    onCancel,
    autoFocus = true,
    showCustomInput = true,
    customInputPlaceholder = 'Tell Sema what to do instead'
}) => {
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [customInput, setCustomInput] = useState<string>('');
    const [isInputFocused, setIsInputFocused] = useState<boolean>(false);
    const [isComposing, setIsComposing] = useState<boolean>(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // 动态构建按钮列表
    type ButtonAction = 'agree' | 'allow' | 'refuse';
    const buttonList: { key: ButtonAction; label: string }[] = [
        { key: 'agree', label: options.agree },
        ...(options.allow ? [{ key: 'allow' as ButtonAction, label: options.allow }] : []),
        { key: 'refuse', label: options.refuse },
    ];
    const refuseIndex = buttonList.findIndex(b => b.key === 'refuse');

    // 计算总选项数（按钮数 + 可能的输入框）
    const totalOptions = showCustomInput ? buttonList.length + 1 : buttonList.length;
    const customInputIndex = buttonList.length; // 输入框的虚拟index

    // 格式化文本，提取反引号中的内容并加粗
    const formatAllowText = (text: string, showPrefix: boolean) => {
        const prefix = showPrefix ? '❯ ' : '';
        const match = text.match(/`([^`]+)`/);
        if (match) {
            const content = match[1];
            const before = text.substring(0, match.index);
            const after = text.substring(match.index! + match[0].length);

            // 使用 span 包裹整体，包含前缀确保文本作为单一文本流正常换行
            return (
                <span>
                    {prefix}{before}<strong>{content}</strong>{after}
                </span>
            );
        }
        return <span>{prefix}{text}</span>;
    };

    // 处理键盘事件
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // 如果输入框获得焦点，只处理特定按键
            if (isInputFocused) {
                // 输入法组合输入中，不处理 ESC
                if (event.key === 'Escape' && !isComposing) {
                    event.preventDefault();
                    setIsInputFocused(false);
                    setSelectedIndex(refuseIndex);
                    containerRef.current?.focus();
                    return;
                }

                if (event.key === 'Enter' && customInput.trim()) {
                    event.preventDefault();
                    onSelect(customInput.trim() as any);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setIsInputFocused(false);
                    setSelectedIndex(refuseIndex);
                    containerRef.current?.focus();
                }
                return;
            }

            // 处理 ESC 和 Ctrl+C 中断
            if (event.key === 'Escape' || (event.key === 'c' && event.ctrlKey)) {
                event.preventDefault();
                onCancel?.();
                return;
            }

            switch (event.key) {
                case 'ArrowUp':
                    event.preventDefault();
                    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    if (showCustomInput && selectedIndex === refuseIndex) {
                        // 从 refuse 按钮移动到输入框
                        setSelectedIndex(customInputIndex);
                        setIsInputFocused(true);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    } else if (selectedIndex === totalOptions - 1) {
                        setSelectedIndex(0);
                        setIsInputFocused(false);
                    } else {
                        setSelectedIndex((prev) => prev + 1);
                    }
                    break;
                case 'Enter':
                    event.preventDefault();
                    if (selectedIndex === customInputIndex && showCustomInput) {
                        // 选中输入框时，聚焦输入框
                        setIsInputFocused(true);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    } else {
                        handleSelect();
                    }
                    break;
            }
        };

        if (containerRef.current) {
            containerRef.current.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            if (containerRef.current) {
                containerRef.current.removeEventListener('keydown', handleKeyDown);
            }
        };
    }, [selectedIndex, onCancel, isInputFocused, customInput, showCustomInput, totalOptions]);

    // 自动聚焦
    useEffect(() => {
        if (autoFocus && containerRef.current) {
            containerRef.current.focus();
        }
    }, [autoFocus]);

    const handleSelect = () => {
        if (selectedIndex < buttonList.length) {
            onSelect(buttonList[selectedIndex].key);
        }
    };

    const handleClick = (index: number, action: 'agree' | 'allow' | 'refuse') => {
        setSelectedIndex(index);
        setIsInputFocused(false);
        onSelect(action);
    };

    const handleInputSubmit = () => {
        if (customInput.trim()) {
            onSelect(customInput.trim() as any);
        }
    };

    const handleInputFocus = () => {
        setSelectedIndex(customInputIndex);
        setIsInputFocused(true);
    };

    const handleInputBlur = () => {
        setIsInputFocused(false);
    };

    return (
        <div
            className="bash-permission-buttons"
            ref={containerRef}
            tabIndex={0}
            style={{ outline: 'none' }}
        >
            {buttonList.map((btn, index) => (
                <button
                    key={btn.key}
                    className={`bash-permission-btn ${selectedIndex === index ? 'selected' : ''}`}
                    onClick={() => handleClick(index, btn.key)}
                >
                    {btn.key === 'allow'
                        ? formatAllowText(btn.label, selectedIndex === index)
                        : <>{selectedIndex === index && '❯ '}{btn.label}</>
                    }
                </button>
            ))}
            {showCustomInput && (
                <div className="permission-custom-input-wrapper">
                    <input
                        ref={inputRef}
                        type="text"
                        className="permission-custom-input"
                        placeholder={customInputPlaceholder}
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={() => setIsComposing(false)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && customInput.trim() && !isComposing) {
                                e.preventDefault();
                                e.stopPropagation();
                                handleInputSubmit();
                            }
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export default PermissionOptions;
