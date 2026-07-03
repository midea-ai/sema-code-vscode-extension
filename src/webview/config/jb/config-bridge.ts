import { Transport } from '../../chat/jb/transport';
import type { VsCodeApi } from '../../chat/jb/bridge';
import { ConfigController } from './config-controller';

/**
 * 组装配置页的 "vscode" shim（JB 版）：
 * - App 的 postMessage({command,...}) → ConfigController 处理（走 gRPC / 编辑器 channel）
 * - Controller 产出的出站消息 → 以 window 'message' 事件回灌给 App（与 VSCode webview 一致）
 * 复用聊天侧的 Transport（同一套 __semaHostQuery/__semaHostToWeb 协议）；此 JCEF 独立 realm，与聊天互不干扰。
 */
export function createConfigJbBridge(): VsCodeApi {
    const transport = new Transport();
    const controller = new ConfigController(transport, (msg) => {
        window.dispatchEvent(new MessageEvent('message', { data: msg }));
    });

    let state: any = undefined;
    return {
        postMessage: (msg) => { void controller.handleWebMessage(msg); },
        getState: () => state,
        setState: (s) => { state = s; },
    };
}
