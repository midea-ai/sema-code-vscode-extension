/**
 * 共享时间格式化工具
 * 用于 CronTaskConfig / BackgroundTaskConfig 等
 */

const pad = (n: number) => String(n).padStart(2, '0');

const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

/**
 * 格式化时间戳，自动使用 今日/昨日/明日 前缀
 * - 今日 → "今日 14:30"
 * - 昨日 → "昨日 14:30"
 * - 明日 → "明日 14:30"
 * - 同年 → "04-15 14:30"
 * - 跨年 → "2025-04-15 14:30"
 */
export const formatDateTime = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    if (isSameDay(d, now)) {
        return `今日 ${time}`;
    }
    if (isSameDay(d, yesterday)) {
        return `昨日 ${time}`;
    }
    if (isSameDay(d, tomorrow)) {
        return `明日 ${time}`;
    }

    const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (d.getFullYear() !== now.getFullYear()) {
        return `${d.getFullYear()}-${date} ${time}`;
    }

    return `${date} ${time}`;
};
