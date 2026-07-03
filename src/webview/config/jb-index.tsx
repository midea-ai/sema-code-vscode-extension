import { createRoot } from 'react-dom/client';
import App from './App';
import './style/styles.css';
import { createConfigJbBridge } from './jb/config-bridge';

// JB 入口：与 config/index.tsx 等价，只是 vscode 由 JB 桥提供（背后走 gRPC → sema-grpc → sema-core，
// 本地系统配置走 Kotlin systemConfig channel）。React UI（App）与 index.tsx 完全一致，一行不改。
(window as any).__SEMA_JB__ = true;
const vscode = createConfigJbBridge();
(window as any).acquireVsCodeApi = () => vscode;

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}
