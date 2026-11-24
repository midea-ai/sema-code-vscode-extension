/**
 * 共享时间格式化（三个 webview 通用）
 * - formatDateTime：绝对时间，带 今天/昨天/明天 前缀
 * - formatRelativeTime：相对时间，刚刚 / X 分钟前 / X 小时前 …
 * 只负责格式化：相对时间会随时间过期，调用方需要定期重渲染（tick）。
 */

import { t } from './i18n/core';

const pad = (n: number) => String(n).padStart(2, '0');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * 格式化时间戳，自动使用 今天/昨天/明天 前缀
 * - 今天 → "今天 14:30"
 * - 昨天 → "昨天 14:30"
 * - 明天 → "明天 14:30"
 * - 同年 → "4 月 15 日 14:30"
 * - 跨年 → "2025 年 4 月 15 日 14:30"
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
        return t('config.time.today', { time });
    }
    if (isSameDay(d, yesterday)) {
        return t('config.time.yesterday', { time });
    }
    if (isSameDay(d, tomorrow)) {
        return t('config.time.tomorrow', { time });
    }

    const month = d.getMonth() + 1;
    const day = d.getDate();

    if (d.getFullYear() !== now.getFullYear()) {
        return t('config.time.yearDate', { year: d.getFullYear(), month, day, time });
    }

    return t('config.time.date', { month, day, time });
};

/**
 * 相对时间：刚刚 → X 分钟前 → X 小时前（当天）→ 昨天 HH:MM → X 天前 → 绝对日期时间
 * 按日历天切档，避免「38 小时前」显示成 1 天前；7 天以后相对值已难换算，直接给日期。
 */
export const formatRelativeTime = (ts: number): string => {
    const now = new Date();
    const d = new Date(ts);
    const diff = Math.max(0, now.getTime() - ts);

    if (diff < MINUTE) {
        return t('config.time.justNow');
    }
    if (diff < HOUR) {
        return t('config.time.minutesAgo', { n: Math.floor(diff / MINUTE) });
    }

    const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
    if (dayDiff <= 0) {
        return t('config.time.hoursAgo', { n: Math.floor(diff / HOUR) });
    }
    if (dayDiff === 1) {
        return t('config.time.yesterday', { time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
    }
    if (dayDiff < 7) {
        return t('config.time.daysAgo', { n: dayDiff });
    }

    return formatDateTime(ts);
};
