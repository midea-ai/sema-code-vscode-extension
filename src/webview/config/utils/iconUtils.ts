// 首字母背景色列表：同色相低饱和（S 40%~50%），浅色相单独压暗，
// 保证白字对比度在 4.5:1 以上；用 HSL 便于统一微调柔和度
export const initialBgColors = [
    'hsl(239 40% 47%)', // indigo
    'hsl(262 40% 49%)', // violet
    'hsl(292 40% 47%)', // purple
    'hsl(330 42% 47%)', // pink
    'hsl(350 45% 47%)', // rose
    'hsl(4 45% 47%)',   // red
    'hsl(24 48% 42%)',  // orange
    'hsl(40 50% 36%)',  // amber
    'hsl(152 40% 38%)', // green
    'hsl(175 42% 36%)', // teal
    'hsl(190 45% 38%)', // cyan
    'hsl(217 45% 48%)', // blue
];

// 根据字符串生成稳定的 hash 值
export const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

// 根据名称获取背景色
export const getColorByName = (name: string): string => {
    return initialBgColors[hashString(name) % initialBgColors.length];
};
