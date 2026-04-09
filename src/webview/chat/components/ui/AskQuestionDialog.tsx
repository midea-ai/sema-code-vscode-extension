import React, { useState, useEffect, useRef } from 'react';

interface AskQuestionOption {
    label: string;
    description: string;
}

interface AskQuestion {
    question: string;
    header: string;
    options: AskQuestionOption[];
    multiSelect: boolean;
}

interface AskQuestionRequestData {
    agentId: string;
    questions: AskQuestion[];
    metadata?: {
        source?: string;
    };
}

interface AskQuestionDialogProps {
    data: AskQuestionRequestData;
    onSubmit: (answers: Record<string, string>) => void;
    onCancel?: () => void;
}

// Other 选项的索引标识（使用 -1 表示 Other）
const OTHER_OPTION_INDEX = -1;

const AskQuestionDialog: React.FC<AskQuestionDialogProps> = ({
    data,
    onSubmit,
    onCancel
}) => {
    // 每个问题的选中状态：单选为 number | null，多选为 number[]
    // 注意：OTHER_OPTION_INDEX (-1) 表示选中了 Other 选项
    const [selections, setSelections] = useState<Map<number, number | null | number[]>>(new Map());
    // 每个问题的 Other 输入文本
    const [otherTexts, setOtherTexts] = useState<Map<number, string>>(new Map());
    // 每个问题的 Other 是否处于编辑模式
    const [otherEditMode, setOtherEditMode] = useState<Map<number, boolean>>(new Map());
    // 当前活动的标签索引
    const [activeTabIndex, setActiveTabIndex] = useState<number>(0);
    // 当前聚焦的选项索引（仅当前问题的选项 + Other + 提交/下一步按钮）
    const [focusedOptionIndex, setFocusedOptionIndex] = useState<number>(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const otherInputRef = useRef<HTMLInputElement>(null);

    // 获取当前问题
    const currentQuestion = data.questions[activeTabIndex];
    // 是否是最后一页
    const isLastPage = activeTabIndex === data.questions.length - 1;
    // 是否是多页模式
    const isMultiPage = data.questions.length > 1;

    // 当前问题的可聚焦元素数量（选项 + Other + 提交/下一步按钮 + Skip按钮）
    const getTotalFocusableCount = () => {
        // 原始选项数 + 1 (Other) + 1 (Submit/Next) + 1 (Skip)
        return currentQuestion ? currentQuestion.options.length + 3 : 2;
    };

    // 获取 Other 选项在聚焦列表中的索引
    const getOtherFocusIndex = () => {
        return currentQuestion ? currentQuestion.options.length : 0;
    };

    // 获取提交/下一步按钮的聚焦索引
    const getActionButtonFocusIndex = (): number => {
        return currentQuestion ? currentQuestion.options.length + 1 : 0;
    };

    // 获取 Skip 按钮的聚焦索引
    const getSkipButtonFocusIndex = (): number => {
        return currentQuestion ? currentQuestion.options.length + 2 : 1;
    };

    // 检查当前问题是否选中了 Other
    const isOtherSelected = (questionIndex: number): boolean => {
        const question = data.questions[questionIndex];
        if (!question) return false;
        const selected = selections.get(questionIndex);
        if (question.multiSelect) {
            return ((selected as number[]) || []).includes(OTHER_OPTION_INDEX);
        } else {
            return selected === OTHER_OPTION_INDEX;
        }
    };

    // 检查 Other 是否处于编辑模式
    const isOtherInEditMode = (questionIndex: number): boolean => {
        return otherEditMode.get(questionIndex) || false;
    };

    // 获取 Other 的显示文本
    const getOtherDisplayText = (questionIndex: number): string => {
        return otherTexts.get(questionIndex) || '';
    };

    // 初始化选中状态
    useEffect(() => {
        const initialSelections = new Map<number, number | null | number[]>();
        const initialOtherTexts = new Map<number, string>();
        const initialEditMode = new Map<number, boolean>();
        data.questions.forEach((q, idx) => {
            if (q.multiSelect) {
                initialSelections.set(idx, []);
            } else {
                initialSelections.set(idx, null);
            }
            initialOtherTexts.set(idx, '');
            initialEditMode.set(idx, false);
        });
        setSelections(initialSelections);
        setOtherTexts(initialOtherTexts);
        setOtherEditMode(initialEditMode);
    }, [data.questions]);

    // 自动聚焦
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.focus();
        }
    }, []);

    // 切换标签时重置聚焦索引并退出编辑模式
    useEffect(() => {
        setFocusedOptionIndex(0);
        // 退出所有问题的编辑模式
        setOtherEditMode(prev => {
            const newMode = new Map(prev);
            prev.forEach((_, idx) => {
                newMode.set(idx, false);
            });
            return newMode;
        });
    }, [activeTabIndex]);

    // 当 Other 进入编辑模式时，自动聚焦输入框
    useEffect(() => {
        if (isOtherSelected(activeTabIndex) && isOtherInEditMode(activeTabIndex) && otherInputRef.current) {
            otherInputRef.current.focus();
        }
    }, [otherEditMode, activeTabIndex]);

    // 处理键盘事件
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // 如果焦点在 Other 输入框中
            if (document.activeElement === otherInputRef.current) {
                // 如果正在进行中文输入（IME 组合），不处理按键
                if (event.isComposing) {
                    return;
                }
                if (event.key === 'Escape' || event.key === 'c' && event.ctrlKey) {
                    event.preventDefault();
                    // 退出编辑模式
                    setOtherEditMode(prev => {
                        const newMode = new Map(prev);
                        newMode.set(activeTabIndex, false);
                        return newMode;
                    });
                    containerRef.current?.focus();
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    // 确认输入，退出编辑模式，不自动跳转
                    setOtherEditMode(prev => {
                        const newMode = new Map(prev);
                        newMode.set(activeTabIndex, false);
                        return newMode;
                    });
                    containerRef.current?.focus();
                } else if (event.key === 'Tab') {
                    // 允许 Tab 键继续导航
                    return;
                }
                return;
            }

            const totalFocusable = getTotalFocusableCount();
            const totalTabs = data.questions.length;

            switch (event.key) {
                case 'ArrowLeft':
                    event.preventDefault();
                    // 如果焦点在 Skip 按钮上，按左键跳到 Submit/Continue 按钮
                    if (focusedOptionIndex === getSkipButtonFocusIndex()) {
                        setFocusedOptionIndex(getActionButtonFocusIndex());
                    } else {
                        // 左键切换到上一个标签
                        setActiveTabIndex(prev => (prev > 0 ? prev - 1 : totalTabs - 1));
                    }
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    // 如果焦点在 Submit/Continue 按钮上，按右键跳到 Skip 按钮
                    if (focusedOptionIndex === getActionButtonFocusIndex()) {
                        setFocusedOptionIndex(getSkipButtonFocusIndex());
                    } else {
                        // 右键切换到下一个标签
                        setActiveTabIndex(prev => (prev < totalTabs - 1 ? prev + 1 : 0));
                    }
                    break;
                case 'ArrowUp':
                    // 上键在当前问题选项中向上导航
                    event.preventDefault();
                    setFocusedOptionIndex(prev => (prev > 0 ? prev - 1 : totalFocusable - 1));
                    break;
                case 'ArrowDown':
                    // 下键在当前问题选项中向下导航
                    event.preventDefault();
                    setFocusedOptionIndex(prev => (prev < totalFocusable - 1 ? prev + 1 : 0));
                    break;
                case 'Enter':
                    event.preventDefault();
                    if (focusedOptionIndex === getActionButtonFocusIndex()) {
                        // 在 Submit/Continue 按钮上按回车
                        handleActionButton();
                    } else if (focusedOptionIndex === getSkipButtonFocusIndex()) {
                        // 在 Skip 按钮上按回车
                        handleSkip();
                    } else if (focusedOptionIndex === getOtherFocusIndex()) {
                        // 在 Other 选项上按回车
                        handleOtherClick();
                    } else {
                        // 在普通选项上按回车，勾选/取消勾选
                        handleOptionSelect(activeTabIndex, focusedOptionIndex);
                    }
                    break;
                case ' ':
                    // Space 也可以勾选选项
                    if (focusedOptionIndex < getActionButtonFocusIndex()) {
                        event.preventDefault();
                        if (focusedOptionIndex === getOtherFocusIndex()) {
                            handleOtherClick();
                        } else {
                            handleOptionSelect(activeTabIndex, focusedOptionIndex);
                        }
                    }
                    break;
                case 'Escape':
                    event.preventDefault();
                    onCancel?.();
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
    }, [focusedOptionIndex, activeTabIndex, data.questions, currentQuestion, isLastPage]);

    // 处理 Other 选项点击
    const handleOtherClick = () => {
        const isSelected = isOtherSelected(activeTabIndex);
        const hasText = getOtherDisplayText(activeTabIndex).length > 0;

        if (!isSelected) {
            // 未选中：选中并进入编辑模式
            handleOptionSelect(activeTabIndex, OTHER_OPTION_INDEX);
            setOtherEditMode(prev => {
                const newMode = new Map(prev);
                newMode.set(activeTabIndex, true);
                return newMode;
            });
        } else if (hasText && !isOtherInEditMode(activeTabIndex)) {
            // 已选中且有文本且不在编辑模式：进入编辑模式
            setOtherEditMode(prev => {
                const newMode = new Map(prev);
                newMode.set(activeTabIndex, true);
                return newMode;
            });
        } else if (!hasText) {
            // 已选中但没有文本：进入编辑模式
            setOtherEditMode(prev => {
                const newMode = new Map(prev);
                newMode.set(activeTabIndex, true);
                return newMode;
            });
        } else {
            // 在编辑模式中再次点击：取消选中
            handleOptionSelect(activeTabIndex, OTHER_OPTION_INDEX);
        }
    };

    const handleOptionSelect = (questionIndex: number, optionIndex: number) => {
        const question = data.questions[questionIndex];
        if (!question) return;

        setSelections(prev => {
            const newSelections = new Map(prev);
            if (question.multiSelect) {
                const currentSelected = (prev.get(questionIndex) as number[]) || [];
                if (currentSelected.includes(optionIndex)) {
                    newSelections.set(questionIndex, currentSelected.filter(i => i !== optionIndex));
                    // 如果取消选中 Other，退出编辑模式
                    if (optionIndex === OTHER_OPTION_INDEX) {
                        setOtherEditMode(prevMode => {
                            const newMode = new Map(prevMode);
                            newMode.set(questionIndex, false);
                            return newMode;
                        });
                    }
                } else {
                    newSelections.set(questionIndex, [...currentSelected, optionIndex]);
                }
            } else {
                // 单选：点击已选中的选项则取消选中，否则选中新的
                const currentSelected = prev.get(questionIndex);
                if (currentSelected === optionIndex) {
                    newSelections.set(questionIndex, null);
                    // 如果取消选中 Other，退出编辑模式
                    if (optionIndex === OTHER_OPTION_INDEX) {
                        setOtherEditMode(prevMode => {
                            const newMode = new Map(prevMode);
                            newMode.set(questionIndex, false);
                            return newMode;
                        });
                    }
                } else {
                    newSelections.set(questionIndex, optionIndex);
                }
            }
            return newSelections;
        });
    };

    const handleOtherTextChange = (questionIndex: number, text: string) => {
        setOtherTexts(prev => {
            const newTexts = new Map(prev);
            newTexts.set(questionIndex, text);
            return newTexts;
        });
    };

    // 处理按钮点击（Next 或 Submit）
    const handleActionButton = () => {
        if (isLastPage) {
            handleSubmit();
        } else {
            // 跳转到下一页
            setActiveTabIndex(prev => prev + 1);
        }
    };

    // 处理 Skip 按钮点击，提交空答案
    const handleSkip = () => {
        const emptyAnswers: Record<string, string> = {};
        data.questions.forEach((q) => {
            emptyAnswers[q.question] = '';
        });
        onSubmit(emptyAnswers);
    };

    const handleSubmit = () => {
        const answers: Record<string, string> = {};

        data.questions.forEach((q, idx) => {
            const selected = selections.get(idx);
            const otherText = otherTexts.get(idx) || '';

            if (q.multiSelect) {
                const selectedIndices = (selected as number[]) || [];
                const labels = selectedIndices.map(i => {
                    if (i === OTHER_OPTION_INDEX) {
                        return otherText || 'Other';
                    }
                    return q.options[i]?.label || '';
                });
                answers[q.question] = labels.join(',');
            } else {
                const selectedIndex = selected as number | null;
                if (selectedIndex === OTHER_OPTION_INDEX) {
                    answers[q.question] = otherText || 'Other';
                } else if (selectedIndex !== null) {
                    answers[q.question] = q.options[selectedIndex]?.label || '';
                } else {
                    answers[q.question] = '';
                }
            }
        });

        onSubmit(answers);
    };

    const isOptionSelected = (questionIndex: number, optionIndex: number): boolean => {
        const question = data.questions[questionIndex];
        if (!question) return false;

        const selected = selections.get(questionIndex);
        if (question.multiSelect) {
            return ((selected as number[]) || []).includes(optionIndex);
        } else {
            return selected === optionIndex;
        }
    };

    return (
        <div className="chat-block bash-permission-block ask-question-dialog" ref={containerRef} tabIndex={0}>
            <div className="ask-question-content">
                {/* 标签栏 */}
                {isMultiPage && (
                    <div className="ask-question-tabs">
                        {data.questions.map((question, tabIndex) => (
                            <button
                                key={tabIndex}
                                className={`ask-question-tab ${activeTabIndex === tabIndex ? 'active' : ''}`}
                                onClick={() => setActiveTabIndex(tabIndex)}
                            >
                                {question.header}
                            </button>
                        ))}
                        {/* <div className="ask-question-tab-hint">← → 切换</div> */}
                    </div>
                )}

                {/* 当前问题内容 */}
                {currentQuestion && (
                    <div className="ask-question-item">
                        <div className="ask-question-label">
                            <span className="ask-question-text">{currentQuestion.question}</span>
                        </div>
                        <div className="ask-question-options">
                            {/* 原始选项 */}
                            {currentQuestion.options.map((option, oIndex) => (
                                <label
                                    key={oIndex}
                                    className={`ask-question-option ${isOptionSelected(activeTabIndex, oIndex) ? 'selected' : ''} ${focusedOptionIndex === oIndex ? 'focused' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleOptionSelect(activeTabIndex, oIndex);
                                    }}
                                >
                                    <input
                                        type={currentQuestion.multiSelect ? 'checkbox' : 'radio'}
                                        name={`question-${activeTabIndex}`}
                                        checked={isOptionSelected(activeTabIndex, oIndex)}
                                        readOnly
                                    />
                                    <div className="ask-question-option-content">
                                        <span className="ask-question-option-label">{option.label}</span>
                                        {option.description && (
                                            <span className="ask-question-option-description">{option.description}</span>
                                        )}
                                    </div>
                                </label>
                            ))}

                            {/* Other 选项 */}
                            <label
                                className={`ask-question-option ${isOtherSelected(activeTabIndex) ? 'selected' : ''} ${focusedOptionIndex === getOtherFocusIndex() ? 'focused' : ''}`}
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleOtherClick();
                                }}
                            >
                                <input
                                    type={currentQuestion.multiSelect ? 'checkbox' : 'radio'}
                                    name={`question-${activeTabIndex}`}
                                    checked={isOtherSelected(activeTabIndex)}
                                    readOnly
                                />
                                <div className="ask-question-option-content">
                                    {isOtherSelected(activeTabIndex) ? (
                                        isOtherInEditMode(activeTabIndex) ? (
                                            // 编辑模式：显示输入框
                                            <input
                                                ref={otherInputRef}
                                                type="text"
                                                className="ask-question-other-inline-input"
                                                placeholder="Type something..."
                                                value={otherTexts.get(activeTabIndex) || ''}
                                                onChange={(e) => handleOtherTextChange(activeTabIndex, e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        ) : (
                                            // 已输入内容：显示用户输入的文本
                                            <>
                                                <span className="ask-question-option-label">
                                                    {getOtherDisplayText(activeTabIndex) || 'Other'}
                                                </span>
                                            </>
                                        )
                                    ) : (
                                        // 未选中：显示默认 Other 选项
                                        <span className="ask-question-option-label">Other</span>
                                    )}
                                </div>
                            </label>
                        </div>
                    </div>
                )}

                {/* 操作按钮区域 */}
                <div className="ask-question-buttons">
                    <button
                        className={`ask-question-submit-btn-full ${focusedOptionIndex === getActionButtonFocusIndex() ? 'focused' : ''}`}
                        onClick={handleActionButton}
                    >
                        {isLastPage ? 'Submit Answers' : 'Continue'}
                    </button>
                    <button
                        className={`ask-question-skip-btn ${focusedOptionIndex === getSkipButtonFocusIndex() ? 'focused' : ''}`}
                        onClick={handleSkip}
                    >
                        Skip
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AskQuestionDialog;
