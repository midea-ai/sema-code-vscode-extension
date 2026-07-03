import { Transport } from './transport';
import { Controller } from './controller';

/** 与 VSCode 的 acquireVsCodeApi() 返回值同形，供 App 无差别使用。 */
export interface VsCodeApi {
    postMessage(msg: any): void;
    getState(): any;
    setState(s: any): void;
}

/**
 * 组装 JB 侧的 "vscode" shim：
 * - App 的 postMessage → Controller 处理（走 gRPC / 编辑器）
 * - Controller 产出的 UI 消息 → 以 window 'message' 事件回灌给 App（与 VSCode webview 一致）
 */
export function createJbBridge(): VsCodeApi {
    const transport = new Transport();
    const controller = new Controller(transport, (msg) => {
        window.dispatchEvent(new MessageEvent('message', { data: msg }));
    });

    let state: any = undefined;
    return {
        postMessage: (msg) => { void controller.handleWebMessage(msg); },
        getState: () => state,
        setState: (s) => { state = s; },
    };
}
