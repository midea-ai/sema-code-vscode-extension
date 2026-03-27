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
export const COMMAND_PROMPT_MAP: Record<string, string> = {
    '/knowledge': '帮我扫描整个代码项目，构建非常完善的wiki项目文档，需要是多个文档，分门别类的存放，按照目录来索引，对整个仓库做深度解析，越详细越好。',
    '/init': `Please analyze this codebase and create a AGENTS.md file, which will be given to future instances of Sema Code to operate in this repository.

What to add:
1. Commands that will be commonly used, such as how to build, lint, and run tests. Include the necessary commands to develop in this codebase, such as how to run a single test.
2. High-level code architecture and structure so that future instances can be productive more quickly. Focus on the "big picture" architecture that requires reading multiple files to understand.

Usage notes:
- If there's already a AGENTS.md, suggest improvements to it.
- When you make the initial AGENTS.md, do not repeat yourself and do not include obvious instructions like "Provide helpful error messages to users", "Write unit tests for all new utilities", "Never include sensitive information (API keys, tokens) in code or commits".
- Avoid listing every component or file structure that can be easily discovered.
- Don't include generic development practices.
- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md) or Claude Code rules (in CLAUDE.md or .claude/CLAUDE.md), make sure to include the important parts.
- If there is a README.md, make sure to include the important parts.
- Do not make up information such as "Common Development Tasks", "Tips for Development", "Support and Documentation" unless this is expressly included in other files that you read.
- Be sure to prefix the file with the following text:

\`\`\`
# AGENTS.md

This file provides guidance to Sema Code when working with code in this repository.
\`\`\`
`
};


