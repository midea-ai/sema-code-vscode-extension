import React from 'react';
import { GoalState } from '../../types';
import { useT, I18nKey } from '../../../common/i18n/react';

export type GoalBarAction = 'pause' | 'resume' | 'clear';

interface GoalBarProps {
    goal: GoalState;
    onAction: (action: GoalBarAction) => void;
    /** 打开编辑弹窗（点击文字区 / 编辑按钮） */
    onEdit: () => void;
}

const ICON_PROPS = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const TargetIcon: React.FC<{ size?: number }> = ({ size = 13 }) => (
    <svg {...ICON_PROPS} width={size} height={size}>
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
);

const PauseIcon: React.FC = () => (
    <svg {...ICON_PROPS} width={14} height={14}>
        <circle cx="12" cy="12" r="10" /><line x1="10" y1="15" x2="10" y2="9" /><line x1="14" y1="15" x2="14" y2="9" />
    </svg>
);

const PlayIcon: React.FC = () => (
    <svg {...ICON_PROPS} width={14} height={14}>
        <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
    </svg>
);

const EditIcon: React.FC = () => (
    <svg {...ICON_PROPS}>
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
    </svg>
);

const TrashIcon: React.FC = () => (
    <svg {...ICON_PROPS}>
        <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
);

/**
 * 长期目标状态条：挂在输入框上方的面板栏（与待办 / 文件改动面板同层），单行：
 * 图标 + 状态文字 + 目标文字（窄时截断）+ 操作按钮。点击文字区打开编辑弹窗。
 * 操作不走输入队列，直接调会话级接口立即生效；暂停只让循环到本轮结束不再续，不打断当前轮（要立刻停用输入框的停止键）。
 * 目标完成后由上层不再渲染（无操作、无新信息）。
 */
const GoalBar: React.FC<GoalBarProps> = ({ goal, onAction, onEdit }) => {
    const t = useT();
    const resumable = goal.status === 'paused' || goal.status === 'blocked';
    return (
        <div className="goal-bar">
            <button type="button" className="goal-bar-main" onClick={onEdit} title={t('goal.edit')}>
                <span className="goal-bar-icon"><TargetIcon /></span>
                <span className="goal-bar-status">{t(`goal.status.${goal.status}` as I18nKey)}</span>
                <span className="goal-bar-text">{goal.text}</span>
            </button>
            <div className="goal-bar-actions">
                {goal.status === 'running' && (
                    <button type="button" className="goal-bar-btn" title={t('goal.pause')} onClick={() => onAction('pause')}><PauseIcon /></button>
                )}
                {resumable && (
                    <button type="button" className="goal-bar-btn" title={t('goal.resume')} onClick={() => onAction('resume')}><PlayIcon /></button>
                )}
                <button type="button" className="goal-bar-btn" title={t('goal.edit')} onClick={onEdit}><EditIcon /></button>
                <button type="button" className="goal-bar-btn" title={t('goal.clear')} onClick={() => onAction('clear')}><TrashIcon /></button>
            </div>
        </div>
    );
};

export default GoalBar;
