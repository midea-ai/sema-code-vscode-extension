import { Transport } from '../../chat/jb/transport';
import type { VsCodeApi } from '../../chat/jb/bridge';
import { HistoryController } from './history-controller';

/**
 * 组装历史面板的 "vscode" shim（JB 版）：
 * - App 的 postMessage({type,...}) → HistoryController 处理（走编辑器 channel 到 Kotlin 本地存储）
 * - Controller 产出/宿主回推的消息 → 以 window 'message' 事件回灌给 App（与 VSCode webview 一致）
 * 复用聊天侧的 Transport（同一套 __semaHostQuery/__semaHostToWeb 协议）；此 JCEF 独立 realm。
 */
export function createHistoryJbBridge(): VsCodeApi {
    const transport = new Transport();
    const controller = new HistoryController(transport, (msg) => {
        window.dispatchEvent(new MessageEvent('message', { data: msg }));
    });

    let state: any = undefined;
    return {
        postMessage: (msg) => { void controller.handleWebMessage(msg); },
        getState: () => state,
        setState: (s) => { state = s; },
    };
}
