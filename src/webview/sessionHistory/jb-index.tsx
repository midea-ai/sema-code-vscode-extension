import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { createHistoryJbBridge } from './jb/history-bridge';

// JB 入口：与 sessionHistory/index.tsx 等价，只是 vscode 由 JB 桥提供（背后走 Kotlin 本地存储）。
// React UI（App）与 index.tsx 完全一致，一行不改。
(window as any).__SEMA_JB__ = true;
const vscode = createHistoryJbBridge();
(window as any).acquireVsCodeApi = () => vscode;

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}
