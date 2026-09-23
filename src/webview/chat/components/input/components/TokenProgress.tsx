import React from 'react';
import Tooltip from '../../ui/Tooltip';
import { TokenInfo } from '../../../types';
import { useT } from '../../../../common/i18n/react';

// interface TokenInfo {
//     useTokens: number;          // 当前会话已使用的token数
//     maxTokens: number;          // 模型最大token限制
//     promptTokens: number;       // 模型最大token限制

// }

interface TokenProgressProps {
    tokenInfo: TokenInfo;
}

const TokenProgress: React.FC<TokenProgressProps> = React.memo(({ tokenInfo }) => {
    const t = useT();
    // console.log('tokenInfo: ', tokenInfo)
    // 计算使用百分比
    const percentage = tokenInfo.maxTokens > 0
        ? Math.min((tokenInfo.useTokens / tokenInfo.maxTokens) * 100, 100)
        : 0;

    // 生成 tooltip 文本
    const formatTokens = (tokens: number) => {
        if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}k`;
        }
        return tokens.toString();
    };

    const tooltip = t('chat.tokens.used', { used: formatTokens(tokenInfo.useTokens), max: formatTokens(tokenInfo.maxTokens) });
    // 占用越高圆环越醒目：>85% 错误色、>60% 警告色；百分比数字只在悬浮时出现
    const level = percentage > 85 ? 'danger' : percentage > 60 ? 'warn' : '';

    return (
        <Tooltip content={tooltip}>
            <div className={`token-progress ${level}`}>
                <svg className="token-circle" viewBox="0 0 36 36">
                    <circle
                        className="token-circle-bg"
                        cx="18"
                        cy="18"
                        r="15.5"
                    />
                    <circle
                        className="token-circle-progress"
                        cx="18"
                        cy="18"
                        r="15.5"
                        strokeDasharray={`${percentage * 0.974}, 100`}
                    />
                </svg>
                <span className="token-percentage">{percentage.toFixed(1)}%</span>
            </div>
        </Tooltip>
    );
}, (prevProps, nextProps) => {
    // 自定义比较函数：只有当 tokenInfo 的值真正变化时才重新渲染
    return prevProps.tokenInfo.useTokens === nextProps.tokenInfo.useTokens &&
        prevProps.tokenInfo.maxTokens === nextProps.tokenInfo.maxTokens &&
        prevProps.tokenInfo.promptTokens === nextProps.tokenInfo.promptTokens;

});

export default TokenProgress;