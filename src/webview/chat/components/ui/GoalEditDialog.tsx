import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { GoalState } from '../../types';
import { TargetIcon } from '../panels/GoalBar';
import { useT } from '../../../common/i18n/react';

interface GoalEditDialogProps {
    goal: GoalState;
    onSave: (text: string) => void;
    onCancel: () => void;
}

/** 「x 分钟前更新 / x 小时 y 分钟前更新」：只算时分不算天 */
function useUpdatedAgo(ts: number): string {
    const t = useT();
    const [, tick] = useState(0);
    useEffect(() => {
        const id = window.setInterval(() => tick(n => n + 1), 60_000);
        return () => window.clearInterval(id);
    }, []);
    const d = Math.max(0, Date.now() - ts);
    if (d < 60_000) return t('goal.updatedJustNow');
    const m = Math.floor(d / 60_000);
    if (m < 60) return t('goal.updatedMinutesAgo', { m });
    return t('goal.updatedHoursAgo', { h: Math.floor(m / 60), m: m % 60 });
}

/**
 * 目标编辑弹窗（居中模态浮层，与 Fork 弹窗同款 portal）：
 * 编辑目标全文，与当前不同且非空时可保存；保存调 updateGoal 立即生效，下一轮按新目标推进。
 * 外部目标文字变化（/goal 覆盖 / 清除）时同步编辑区。
 */
const GoalEditDialog: React.FC<GoalEditDialogProps> = ({ goal, onSave, onCancel }) => {
    const t = useT();
    const [text, setText] = useState<string>(goal.text);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const updatedAgo = useUpdatedAgo(goal.updatedAt);

    useEffect(() => { setText(goal.text); }, [goal.text]);
    useEffect(() => {
        const el = textareaRef.current;
        if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, []);

    const trimmed = text.trim();
    const dirty = trimmed !== '' && trimmed !== goal.text;

    const save = useCallback(() => {
        if (dirty) onSave(trimmed);
    }, [dirty, trimmed, onSave]);

    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onCancel();
    }, [onCancel]);

    // ESC 关闭；Ctrl/Cmd+Enter 保存（textarea 内普通回车是换行）
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
        }
    };

    return ReactDOM.createPortal(
        <div className="goal-dialog-overlay" onClick={handleBackdropClick} onKeyDown={handleKeyDown}>
            <div className="goal-dialog-modal">
                <div className="goal-dialog-header">
                    <span className="goal-dialog-icon"><TargetIcon size={14} /></span>
                    <span className="goal-dialog-title">{t('goal.editTitle')}</span>
                    <button type="button" className="task-modal-close" onClick={onCancel} title={t('common.close')}>✕</button>
                </div>
                <div className="goal-dialog-body">
                    <textarea
                        ref={textareaRef}
                        className="goal-dialog-textarea"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        spellCheck={false}
                    />
                </div>
                <div className="goal-dialog-footer">
                    <span className="goal-dialog-updated">{updatedAgo}</span>
                    <div className="goal-dialog-buttons">
                        <button type="button" className="ask-form-skip-btn" onClick={onCancel}>{t('common.cancel')}</button>
                        <button type="button" className="ask-form-submit-btn goal-dialog-save" disabled={!dirty} onClick={save}>{t('goal.update')}</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default GoalEditDialog;
