import React from 'react';
import { TargetIcon } from '../components/panels/GoalBar';
import { useT } from '../../common/i18n/react';

interface GoalAchievedBlockProps {
    /** 模型经 complete_goal 自报的达成说明，可能为空 */
    summary: string;
}

/** 长期目标达成块：落在宣告达成那一轮的末尾，图标 + 「目标已达成」+ summary 正文直接可见 */
const GoalAchievedBlock: React.FC<GoalAchievedBlockProps> = ({ summary }) => {
    const t = useT();
    return (
        <div className="chat-block chat-block--borderless goal-achieved-block">
            <div className="goal-achieved-head">
                <TargetIcon size={13} />
                <span>{t('goal.achieved')}</span>
            </div>
            {summary && <div className="goal-achieved-summary">{summary}</div>}
        </div>
    );
};

export default GoalAchievedBlock;
