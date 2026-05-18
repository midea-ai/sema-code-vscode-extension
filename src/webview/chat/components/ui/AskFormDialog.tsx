import React, { useState, useEffect, useRef } from 'react';

export type PickOptionQuestion =
    | { type: 'radio'; id: string; label: string; required?: boolean; options: string[] }
    | { type: 'checkbox'; id: string; label: string; required?: boolean; options: string[]; maxSelections?: number }
    | { type: 'select'; id: string; label: string; required?: boolean; options: string[] }
    | { type: 'text'; id: string; label: string; required?: boolean; placeholder?: string; maxLength?: number }
    | { type: 'textarea'; id: string; label: string; required?: boolean; placeholder?: string; maxLength?: number };

const DEFAULT_TEXT_MAX_LENGTH = 100;
const DEFAULT_TEXTAREA_MAX_LENGTH = 500;

/** Other 选项相关常量 —— 纯前端概念，后端无感知 */
const OTHER_LABEL = 'Other';
const OTHER_SELECT_SENTINEL = '__ask_form_other__';
const OTHER_INPUT_MAX_LENGTH = 200;

export interface PickOptionRequestData {
    agentId: string;
    questions: PickOptionQuestion[];
    estimatedTime?: string;
    intro?: string;
}

export type AskFormStatus = 'submitted' | 'skipped';

export type AskFormValues = Record<string, string | string[]>;

interface AskFormDialogProps {
    data: PickOptionRequestData;
    onSubmit: (answers: string, values: AskFormValues) => void;
    onSkip: (answers: string, values: AskFormValues) => void;
    onCancel?: () => void;
    readonly?: boolean;
    initialValues?: AskFormValues;
    status?: AskFormStatus;
}

const MULTI_SEPARATOR = '; ';

type ChoiceQuestion = Extract<PickOptionQuestion, { type: 'radio' | 'checkbox' | 'select' }>;

function isChoiceQuestion(q: PickOptionQuestion): q is ChoiceQuestion {
    return q.type === 'radio' || q.type === 'checkbox' || q.type === 'select';
}

function buildInitialValues(questions: PickOptionQuestion[]): AskFormValues {
    const v: AskFormValues = {};
    for (const q of questions) {
        v[q.id] = q.type === 'checkbox' ? [] : '';
    }
    return v;
}

interface AskFormState {
    /** 仅保存「真实选项」：radio/select 为选项字符串，checkbox 为选项数组（不含 Other 文本） */
    values: AskFormValues;
    /** 每题是否选中了 Other */
    otherActive: Record<string, boolean>;
    /** 每题 Other 输入框文本 */
    otherText: Record<string, string>;
}

/**
 * 把外部传入的 values 拆成「真实选项」与「Other 状态」。
 * 凡是不在 q.options 中的值，都识别为 Other 答案（用于回显已回答的表单）。
 */
function buildInitialState(questions: PickOptionQuestion[], initialValues?: AskFormValues): AskFormState {
    const values: AskFormValues = {};
    const otherActive: Record<string, boolean> = {};
    const otherText: Record<string, string> = {};

    for (const q of questions) {
        const raw = initialValues ? initialValues[q.id] : undefined;

        if (q.type === 'checkbox') {
            const arr = Array.isArray(raw) ? raw : [];
            const real = arr.filter(x => q.options.includes(x));
            const others = arr.filter(x => !q.options.includes(x));
            values[q.id] = real;
            if (others.length > 0) {
                otherActive[q.id] = true;
                otherText[q.id] = others.join(MULTI_SEPARATOR);
            }
        } else if (q.type === 'radio' || q.type === 'select') {
            const s = typeof raw === 'string' ? raw : '';
            if (s && !q.options.includes(s)) {
                values[q.id] = '';
                otherActive[q.id] = true;
                otherText[q.id] = s;
            } else {
                values[q.id] = s;
            }
        } else {
            values[q.id] = typeof raw === 'string' ? raw : '';
        }
    }

    return { values, otherActive, otherText };
}

function isAnswered(q: PickOptionQuestion, value: string | string[] | undefined): boolean {
    if (q.type === 'checkbox') {
        return Array.isArray(value) && value.length > 0;
    }
    return typeof value === 'string' && value.trim().length > 0;
}

function formatValue(q: PickOptionQuestion, value: string | string[] | undefined): string {
    if (!isAnswered(q, value)) return '(skipped)';
    if (q.type === 'checkbox') {
        return (value as string[]).join(MULTI_SEPARATOR);
    }
    return (value as string).trim();
}

export function formatAskFormAnswers(questions: PickOptionQuestion[], values: AskFormValues): string {
    return questions.map(q => `- ${q.label}: ${formatValue(q, values[q.id])}`).join('\n');
}

const AskFormDialog: React.FC<AskFormDialogProps> = ({
    data,
    onSubmit,
    onSkip,
    onCancel,
    readonly = false,
    initialValues,
    status,
}) => {
    const [{ values: initValues, otherActive: initActive, otherText: initText }] = useState<AskFormState>(() =>
        buildInitialState(data.questions, initialValues)
    );
    const [values, setValues] = useState<AskFormValues>(initValues);
    const [otherActive, setOtherActive] = useState<Record<string, boolean>>(initActive);
    const [otherText, setOtherText] = useState<Record<string, string>>(initText);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!readonly && containerRef.current) {
            containerRef.current.focus();
        }
    }, [readonly]);

    useEffect(() => {
        if (readonly) return;
        const node = containerRef.current;
        if (!node) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel?.();
            }
        };
        node.addEventListener('keydown', onKey);
        return () => node.removeEventListener('keydown', onKey);
    }, [readonly, onCancel]);

    const clearError = (id: string) => {
        setErrors(prev => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    const updateValue = (id: string, val: string | string[]) => {
        setValues(prev => ({ ...prev, [id]: val }));
        clearError(id);
    };

    const setOtherActiveFor = (id: string, active: boolean) => {
        setOtherActive(prev => ({ ...prev, [id]: active }));
        clearError(id);
    };

    const setOtherTextFor = (id: string, text: string) => {
        setOtherText(prev => ({ ...prev, [id]: text }));
        clearError(id);
    };

    /** 把「真实选项 + Other 文本」合并成最终答案 —— 提交、校验、格式化都基于它 */
    const computeFinalValues = (): AskFormValues => {
        const result: AskFormValues = {};
        for (const q of data.questions) {
            const ot = (otherText[q.id] || '').trim();
            if (q.type === 'checkbox') {
                const real = (values[q.id] as string[]) || [];
                result[q.id] = otherActive[q.id] && ot ? [...real, ot] : [...real];
            } else if (q.type === 'radio' || q.type === 'select') {
                result[q.id] = otherActive[q.id] ? ot : ((values[q.id] as string) || '');
            } else {
                result[q.id] = values[q.id];
            }
        }
        return result;
    };

    const handleSubmit = () => {
        const finalValues = computeFinalValues();
        const newErrors: Record<string, string> = {};
        for (const q of data.questions) {
            if (q.required && !isAnswered(q, finalValues[q.id])) {
                newErrors[q.id] = isChoiceQuestion(q) && otherActive[q.id]
                    ? '请填写 Other 内容'
                    : '此项为必填';
            }
        }
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }
        onSubmit(formatAskFormAnswers(data.questions, finalValues), finalValues);
    };

    const handleSkip = () => {
        const finalValues = computeFinalValues();
        onSkip(formatAskFormAnswers(data.questions, finalValues), finalValues);
    };

    const renderOtherInput = (q: PickOptionQuestion) => (
        <div className="ask-form-other-input">
            <input
                type="text"
                className="ask-form-text"
                value={otherText[q.id] || ''}
                placeholder="请输入其他内容..."
                disabled={readonly}
                maxLength={OTHER_INPUT_MAX_LENGTH}
                onChange={(e) => setOtherTextFor(q.id, e.target.value.slice(0, OTHER_INPUT_MAX_LENGTH))}
            />
        </div>
    );

    const renderQuestion = (q: PickOptionQuestion) => {
        const value = values[q.id];
        const err = errors[q.id];
        const disabled = readonly;
        const otherSelected = !!otherActive[q.id];

        let body: React.ReactNode;
        switch (q.type) {
            case 'radio':
                body = (
                    <>
                        <div className="ask-form-options ask-form-options-inline">
                            {q.options.map((opt, i) => {
                                const checked = !otherSelected && value === opt;
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        className={`ask-form-chip ${checked ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                                        disabled={disabled}
                                        onClick={() => {
                                            if (disabled) return;
                                            setOtherActiveFor(q.id, false);
                                            updateValue(q.id, checked ? '' : opt);
                                        }}
                                    >
                                        {opt}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                className={`ask-form-chip ${otherSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                                disabled={disabled}
                                onClick={() => {
                                    if (disabled) return;
                                    setOtherActiveFor(q.id, true);
                                    setValues(prev => ({ ...prev, [q.id]: '' }));
                                }}
                            >
                                {OTHER_LABEL}
                            </button>
                        </div>
                        {otherSelected ? renderOtherInput(q) : null}
                    </>
                );
                break;
            case 'checkbox': {
                const arr = (value as string[]) || [];
                const max = q.maxSelections;
                const count = arr.length + (otherSelected ? 1 : 0);
                const reachedMax = !!max && count >= max;
                const otherItemDisabled = disabled || (reachedMax && !otherSelected);
                body = (
                    <>
                        <div className="ask-form-options ask-form-options-inline">
                            {q.options.map((opt, i) => {
                                const checked = arr.includes(opt);
                                const itemDisabled = disabled || (reachedMax && !checked);
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        className={`ask-form-chip ${checked ? 'selected' : ''} ${itemDisabled ? 'disabled' : ''}`}
                                        disabled={itemDisabled}
                                        onClick={() => {
                                            if (itemDisabled) return;
                                            const next = checked ? arr.filter(x => x !== opt) : [...arr, opt];
                                            updateValue(q.id, next);
                                        }}
                                    >
                                        {opt}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                className={`ask-form-chip ${otherSelected ? 'selected' : ''} ${otherItemDisabled ? 'disabled' : ''}`}
                                disabled={otherItemDisabled}
                                onClick={() => {
                                    if (otherItemDisabled) return;
                                    setOtherActiveFor(q.id, !otherSelected);
                                }}
                            >
                                {OTHER_LABEL}
                            </button>
                            {max ? (
                                <div className="ask-form-hint ask-form-hint-row">
                                    最多选择 {max} 项（已选 {count}/{max}）
                                </div>
                            ) : null}
                        </div>
                        {otherSelected ? renderOtherInput(q) : null}
                    </>
                );
                break;
            }
            case 'select':
                body = (
                    <>
                        <select
                            className="ask-form-select"
                            value={otherSelected ? OTHER_SELECT_SENTINEL : ((value as string) || '')}
                            disabled={disabled}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (v === OTHER_SELECT_SENTINEL) {
                                    setOtherActiveFor(q.id, true);
                                    setValues(prev => ({ ...prev, [q.id]: '' }));
                                } else {
                                    setOtherActiveFor(q.id, false);
                                    updateValue(q.id, v);
                                }
                            }}
                        >
                            <option value="">请选择...</option>
                            {q.options.map((opt, i) => (
                                <option key={i} value={opt}>{opt}</option>
                            ))}
                            <option value={OTHER_SELECT_SENTINEL}>{OTHER_LABEL}...</option>
                        </select>
                        {otherSelected ? renderOtherInput(q) : null}
                    </>
                );
                break;
            case 'text': {
                const max = q.maxLength ?? DEFAULT_TEXT_MAX_LENGTH;
                const text = (value as string) || '';
                body = (
                    <div className="ask-form-text-wrapper">
                        <input
                            type="text"
                            className="ask-form-text"
                            value={text}
                            placeholder={q.placeholder}
                            disabled={disabled}
                            maxLength={max}
                            onChange={(e) => updateValue(q.id, e.target.value.slice(0, max))}
                        />
                        <div className="ask-form-counter">{text.length}/{max}</div>
                    </div>
                );
                break;
            }
            case 'textarea': {
                const max = q.maxLength ?? DEFAULT_TEXTAREA_MAX_LENGTH;
                const text = (value as string) || '';
                body = (
                    <div className="ask-form-text-wrapper">
                        <textarea
                            className="ask-form-textarea"
                            value={text}
                            placeholder={q.placeholder}
                            disabled={disabled}
                            rows={3}
                            maxLength={max}
                            onChange={(e) => updateValue(q.id, e.target.value.slice(0, max))}
                        />
                        <div className="ask-form-counter">{text.length}/{max}</div>
                    </div>
                );
                break;
            }
            default:
                body = null;
        }

        return (
            <div key={q.id} className={`ask-form-item ${err ? 'has-error' : ''}`}>
                <div className="ask-form-label">
                    <span className="ask-form-question-text">{q.label}</span>
                    {q.required ? <span className="ask-form-required">*</span> : null}
                </div>
                {body}
                {err ? <div className="ask-form-error">{err}</div> : null}
            </div>
        );
    };

    const answered = !!status;
    const mainTitle = data.estimatedTime ? `快速确认（${data.estimatedTime}）` : '快速确认';

    return (
        <div
            className={`chat-block bash-permission-block ask-form-dialog ${readonly ? 'readonly' : ''}`}
            ref={containerRef}
            tabIndex={readonly ? -1 : 0}
        >
            <div className="ask-form-header">
                <div className="ask-form-header-titles">
                    <div className="ask-form-header-title">{mainTitle}</div>
                    {data.intro ? <div className="ask-form-header-intro">{data.intro}</div> : null}
                </div>
                <div className={`ask-form-status-badge ${answered ? 'answered' : 'pending'}`}>
                    {answered ? 'Answered' : 'Pending'}
                </div>
            </div>
            <div className="ask-form-content">
                {data.questions.map(renderQuestion)}
                {!readonly ? (
                    <div className="ask-form-buttons">
                        <button
                            type="button"
                            className="ask-form-submit-btn"
                            onClick={handleSubmit}
                        >
                            Submit Answers
                        </button>
                        <button
                            type="button"
                            className="ask-form-skip-btn"
                            onClick={handleSkip}
                        >
                            Continue
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default AskFormDialog;
