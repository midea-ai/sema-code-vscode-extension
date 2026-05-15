import React, { useState, useEffect, useRef } from 'react';

export type PickOptionQuestion =
    | { type: 'radio'; id: string; label: string; required?: boolean; options: string[] }
    | { type: 'checkbox'; id: string; label: string; required?: boolean; options: string[]; maxSelections?: number }
    | { type: 'select'; id: string; label: string; required?: boolean; options: string[] }
    | { type: 'text'; id: string; label: string; required?: boolean; placeholder?: string; maxLength?: number }
    | { type: 'textarea'; id: string; label: string; required?: boolean; placeholder?: string; maxLength?: number };

const DEFAULT_TEXT_MAX_LENGTH = 100;
const DEFAULT_TEXTAREA_MAX_LENGTH = 500;

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

function buildInitialValues(questions: PickOptionQuestion[]): AskFormValues {
    const v: AskFormValues = {};
    for (const q of questions) {
        v[q.id] = q.type === 'checkbox' ? [] : '';
    }
    return v;
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
    const [values, setValues] = useState<AskFormValues>(() =>
        initialValues ? { ...initialValues } : buildInitialValues(data.questions)
    );
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

    const updateValue = (id: string, val: string | string[]) => {
        setValues(prev => ({ ...prev, [id]: val }));
        if (errors[id]) {
            setErrors(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        }
    };

    const handleSubmit = () => {
        const newErrors: Record<string, string> = {};
        for (const q of data.questions) {
            if (q.required && !isAnswered(q, values[q.id])) {
                newErrors[q.id] = '此项为必填';
            }
        }
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }
        onSubmit(formatAskFormAnswers(data.questions, values), values);
    };

    const handleSkip = () => {
        onSkip(formatAskFormAnswers(data.questions, values), values);
    };

    const renderQuestion = (q: PickOptionQuestion) => {
        const value = values[q.id];
        const err = errors[q.id];
        const disabled = readonly;

        let body: React.ReactNode;
        switch (q.type) {
            case 'radio':
                body = (
                    <div className="ask-form-options ask-form-options-inline">
                        {q.options.map((opt, i) => {
                            const checked = value === opt;
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    className={`ask-form-chip ${checked ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                                    disabled={disabled}
                                    onClick={() => {
                                        if (disabled) return;
                                        updateValue(q.id, opt);
                                    }}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                );
                break;
            case 'checkbox': {
                const arr = (value as string[]) || [];
                const max = q.maxSelections;
                body = (
                    <div className="ask-form-options ask-form-options-inline">
                        {q.options.map((opt, i) => {
                            const checked = arr.includes(opt);
                            const reachedMax = !!max && arr.length >= max && !checked;
                            const itemDisabled = disabled || reachedMax;
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
                        {max ? (
                            <div className="ask-form-hint ask-form-hint-row">
                                最多选择 {max} 项（已选 {arr.length}/{max}）
                            </div>
                        ) : null}
                    </div>
                );
                break;
            }
            case 'select':
                body = (
                    <select
                        className="ask-form-select"
                        value={(value as string) || ''}
                        disabled={disabled}
                        onChange={(e) => updateValue(q.id, e.target.value)}
                    >
                        <option value="">请选择...</option>
                        {q.options.map((opt, i) => (
                            <option key={i} value={opt}>{opt}</option>
                        ))}
                    </select>
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
