import { t } from '../webview/common/i18n/core';
import { REVIEW_COMMAND } from './review';

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
    },
    {
        text: "goal",
        desc: t('chat.cmd.goal')
    },
    // 代码审查：选中后弹出范围面板（未提交的改动 / 某次提交）。范围数据来自 VS Code 的 git 扩展，JetBrains 端不提供
    ...((globalThis as any).__SEMA_JB__ ? [] : [{
        text: REVIEW_COMMAND,
        desc: t('chat.cmd.review')
    }])
];
