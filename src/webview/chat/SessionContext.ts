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
