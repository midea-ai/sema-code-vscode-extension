import { createContext } from 'react';

/**
 * 当前 ChatSession 所属的 sessionId。
 * 供深层子组件（流式消息块）按会话隔离地订阅 StreamingStore。
 */
export const SessionContext = createContext<string>('');
