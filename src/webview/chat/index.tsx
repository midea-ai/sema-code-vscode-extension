import { createRoot } from 'react-dom/client';
import App from './App';
import './style/tokens.css';
import './style/highlight.css';
import './style/blocks.css';
import './style/styles.css';
import './style/input.css';
import './style/tools.css';
import './style/permission.css';

// 在整个应用中只获取一次 VSCode API
const vscode = window.acquireVsCodeApi();

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}

