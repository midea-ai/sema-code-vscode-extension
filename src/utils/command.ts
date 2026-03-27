// 快捷命令配置类型
export interface ShortcutCommand {
    text: string;
    desc: string;
    send?: boolean;
    argumentHint?: string;
    isCustom?: boolean;  // 标识是否为自定义命令
}

// 内置快捷命令配置
export const BUILTIN_SHORTCUT_COMMANDS: ShortcutCommand[] = [
    {
        text: "init",
        desc: "初始化项目信息"
    },
    {
        text: "clear",
        desc: "清除对话历史和上下文",
        send: true  // 设置为true 点击后直接发送不给输入
    },
    {
        text: "compact",
        desc: "压缩会话历史",
        send: true  // 设置为true 点击后直接发送不给输入
    },
    {
        text: "knowledge",
        desc: "生成项目知识库文档"
    }
];
