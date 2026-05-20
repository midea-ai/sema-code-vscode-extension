/**
 * 统一管理 UI 符号字符
 */
import React from 'react';

/**
 * 判断是否为 Linux 平台
 */
const isLinux = (): boolean => {
    return navigator.platform.toLowerCase().includes('linux');
};

/**
 * 获取平台对应的圆点字符
 * Windows / Linux 用 ●（U+25CF，非 emoji 字符，CSS color 生效）；
 * macOS 用 ⏺（系统默认按文本字形渲染，视觉更协调）。
 * Linux 若用 ⏺ 会被 Noto Color Emoji 渲染为彩色 emoji，导致 color 失效、出现橙红色填充。
 */
export const getResponseDot = (): string => {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('mac')) return '⏺';
    return '●';
};

/**
 * 续行符号（⎿）
 */
export const CONTINUATION_SYMBOL = '⎿';

/**
 * 选中指示符（箭头）
 * macOS 直接用 ❯（U+276F）字符；
 * Linux 下 ❯ 由符号字体 fallback 渲染，基线偏低、字形偏小，
 * 用 inline-block + transform 放大并抬升，使其与正文视觉对齐。
 */
export const getSelectionPointer = (): React.ReactNode => {
    if (isLinux()) {
        return React.createElement(
            'span',
            {
                style: {
                    fontSize: '0.8em',
                    verticalAlign: 'middle',
                    marginRight: '0.3em',
                },
            },
            '❯'
        );
    }
    return '❯ ';
};

/**
 * Todo 状态图标
 * Linux 下 ●○◐ 渲染较小，使用更大的字符替代
 */
export const getTodoStatusIcon = (status: 'pending' | 'in_progress' | 'completed'): string => {
    if (isLinux()) {
        switch (status) {
            case 'completed':
                return '⏺';
            case 'in_progress':
                return '◉';
            case 'pending':
            default:
                return '◯';
        }
    }
    switch (status) {
        case 'completed':
            return '●';
        case 'in_progress':
            return '◐';
        case 'pending':
        default:
            return '○';
    }
};
