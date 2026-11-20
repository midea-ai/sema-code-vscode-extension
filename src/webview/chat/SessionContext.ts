import { createContext } from 'react';

/**
 * 当前 ChatSession 所属的 sessionId。
 * 供深层子组件（流式消息块）按会话隔离地订阅 StreamingStore。
 */
export const SessionContext = createContext<string>('');

/**
 * 当前 ChatSession 是否为激活（可见）的会话 tab。
 * 弹窗类组件 portal 到 body、不受会话容器 display:none 约束，
 * 需订阅此值在会话切走（新建/切换 tab）时自行关闭。
 */
export const SessionActiveContext = createContext<boolean>(true);

/**
 * 子代理详情弹窗的外部信号：
 * forceClose —— 有权限/表单/计划弹窗时，详情弹窗需要收起（弹窗层次）；
 * openTaskId —— 配置页请求直接打开某个子代理详情；
 * onClose —— 详情弹窗关闭时通知外部清掉 openTaskId。
 * 走 Context 而不是逐条消息传 prop：弹窗开合不再让整个消息列表重建。
 */
export interface AgentDialogSignal {
    forceClose: boolean;
    openTaskId: string | null;
    onClose: () => void;
}

export const AgentDialogContext = createContext<AgentDialogSignal>({
    forceClose: false,
    openTaskId: null,
    onClose: () => {},
});
