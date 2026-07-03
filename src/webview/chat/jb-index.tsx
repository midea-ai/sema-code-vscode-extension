import { createRoot } from 'react-dom/client';
import App from './App';
import './style/tokens.css';
import './style/highlight.css';
import './style/blocks.css';
import './style/styles.css';
import './style/input.css';
import './style/tools.css';
import './style/permission.css';
import 'katex/dist/katex.min.css';
import { createJbBridge } from './jb/bridge';

// JB 入口：与 index.tsx 等价，只是 vscode 由 JB 桥提供（背后走 gRPC → sema-grpc → sema-core）。
// React UI（App）与 index.tsx 完全一致，一行不改。
// 标记 JB 运行环境，供共享组件对 JCEF 的差异做兜底（如 IME 合成下划线清理）。
(window as any).__SEMA_JB__ = true;
const vscode = createJbBridge();
(window as any).acquireVsCodeApi = () => vscode;

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}
