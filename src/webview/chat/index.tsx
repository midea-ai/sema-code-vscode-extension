import { createRoot } from 'react-dom/client';
import App from './App';
import hljs from 'highlight.js/lib/common';
// 高亮主题与高亮库随主包加载：不再从公网拉取，离线可用，且不阻塞主脚本执行。
// 主题必须在 highlight.css 之前引入，覆盖顺序才与改造前一致（与 jb-index 同一套顺序）。
import 'highlight.js/styles/vs2015.css';
import './style/tokens.css';
import './style/highlight.css';
import './style/blocks.css';
import './style/styles.css';
import './style/input.css';
import './style/tools.css';
import './style/permission.css';
import 'katex/dist/katex.min.css';

// 共享组件按 window.hljs 消费高亮能力，与 JB 入口同一挂载方式
(window as any).hljs = hljs;

// 在整个应用中只获取一次 VSCode API
const vscode = window.acquireVsCodeApi();

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}

