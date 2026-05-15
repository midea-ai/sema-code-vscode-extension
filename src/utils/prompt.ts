/**
 * 将用户输入的命令转换为对应的 prompt
 */
export function transformCommandToPrompt(text: string): string {
    const trimmedText = text.trim();

    if (trimmedText.startsWith('/')) {
        // 提取命令部分（第一个空格之前的部分，如果没有空格则是整个文本）
        const spaceIndex = trimmedText.indexOf(' ');
        const command = spaceIndex > 0 ? trimmedText.substring(0, spaceIndex) : trimmedText;

        // 优先检查内置命令
        if (COMMAND_PROMPT_MAP[command]) {
            // 如果有额外参数，将其附加到 prompt 后面
            const extraParams = spaceIndex > 0 ? trimmedText.substring(spaceIndex) : '';
            return COMMAND_PROMPT_MAP[command] + extraParams;
        }
    }
    return text;
}


// 命令到 prompt 的映射关系
export const COMMAND_PROMPT_MAP: Record<string, string> = {};


