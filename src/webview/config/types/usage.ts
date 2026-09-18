/** 使用统计数据结构，与 sema-core UsageStatsManager 导出的 UsageStatsData 同形；页面按时间范围自行求和 */

export interface UsageTokens {
    hit: number;     // 缓存输入
    miss: number;    // 非缓存输入（含 Anthropic 的缓存写入）
    output: number;  // 输出
}

export interface UsageModelStat {
    requests: number;
    hitKnown: boolean;   // 服务商是否提供了缓存信息；false 时 hit 恒为 0，输入不能拆分
    tokens: UsageTokens;
}

export interface UsageToolStat {
    calls: number;
    errors: number;
}

export interface UsageSkillStat {
    calls: number;
    lastAt: number;
}

export interface UsageDayData {
    requests: number;
    tokens: UsageTokens;
    models: Record<string, UsageModelStat>;
    tools: Record<string, UsageToolStat>;
    skills: Record<string, UsageSkillStat>;
    sessions: string[];   // 当天去重后的会话 id，区间会话数取并集
}

export interface UsageStatsData {
    since: string | null;   // 最早记录日期 YYYY-MM-DD；无记录为 null
    updatedAt: number;
    totals: { requests: number; tokens: UsageTokens; sessions: number; days: number };
    days: Record<string, UsageDayData>;   // 近 366 天中有记录的日期
}

export type UsageRange = '7d' | '30d' | '1y';

/** 某时间范围内的汇总（页面由 days 求得） */
export interface UsageRangeSummary {
    dates: string[];                     // 范围内全部日期（含未记录），升序
    requests: number;
    tokens: UsageTokens;
    sessions: number;
    models: Array<{ name: string; requests: number; hitKnown: boolean; tokens: UsageTokens; total: number }>;
    tools: Array<{ name: string; calls: number; errors: number }>;
    skills: Array<{ name: string; calls: number; lastAt: number }>;
}
