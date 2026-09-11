import { t } from '../webview/common/i18n/core';

// 快捷命令配置类型
export interface ShortcutCommand {
    text: string;
    desc: string;
    send?: boolean;
    argumentHint?: string;
    isCustom?: boolean;  // 标识是否为自定义命令
    category?: 'command' | 'skill' | 'agent';  // 分类：命令 / 技能 / 子代理
}

// 内置快捷命令配置（desc 随当前界面语言取值，故做成函数而非顶层常量）
export const getBuiltinShortcutCommands = (): ShortcutCommand[] => [
    {
        text: "clear",
        desc: t('chat.cmd.clear'),
        send: true  // 设置为true 点击后直接发送不给输入
    },
    {
        text: "compact",
        desc: t('chat.cmd.compact'),
        send: true  // 设置为true 点击后直接发送不给输入
    },
    {
        text: "quickchat",
        desc: t('chat.cmd.quickchat')
    }
];
