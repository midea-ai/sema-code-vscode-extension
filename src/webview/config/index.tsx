import { createRoot } from 'react-dom/client';
import App from './App';
import './style/styles.css';

// 在整个应用中只获取一次 VSCode API
const vscode = window.acquireVsCodeApi();

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App vscode={vscode} />);
}

