// @ 文件选择的"分词字符"：空白 + 常见中英文标点
export const AT_BOUNDARY_REGEX = /[\s。，、；：！？""''「」『』（）《》〈〉【】,;!?]/;

export const isAtBoundary = (ch: string | undefined) => !ch || AT_BOUNDARY_REGEX.test(ch);
