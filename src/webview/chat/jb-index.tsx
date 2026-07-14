import { createRoot } from 'react-dom/client';
import App from './App';
import hljs from 'highlight.js/lib/common';
// hljs 主题在共享样式之前引入：VSCode 端由外壳 <link> CDN 的 vs2015.min.css（11.9.0），
// JB(JCEF) 无 CDN，打进 bundle 等价替代；highlight.css 的覆盖需压过它，顺序不能颠倒。
import 'highlight.js/styles/vs2015.css';
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
// 挂 jb class：供样式对 JCEF 做作用域隔离的差异化（如常驻滚动条槽），VSCode 无此 class 不受影响。
document.documentElement.classList.add('jb');
// 代码高亮：VSCode 端 window.hljs 由外壳从 CDN 注入，JB 走 npm 依赖挂到同一位置，
// App/UpdateCodeDiff/QuickChatDialog 等共享代码按 window.hljs 消费，无需感知差异。
(window as any).hljs = hljs;
const vscode = createJbBridge();
(window as any).acquireVsCodeApi = () => vscode;

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}
