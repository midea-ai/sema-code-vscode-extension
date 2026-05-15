/**
 * 统一管理 UI 符号字符
 */

/**
 * 获取平台对应的圆点字符（Windows用●，其他平台用⏺）
 */
export const getResponseDot = (): string => {
    return navigator.platform.toLowerCase().includes('win') ? '●' : '⏺';
};

/**
 * 续行符号（⎿）
 */
export const CONTINUATION_SYMBOL = '⎿';
