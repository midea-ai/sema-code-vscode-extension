// Welcome.tsx
import React from 'react';

// 由 webpack DefinePlugin 在构建时注入（取自 sema-core/package.json）
declare const __SEMA_CORE_VERSION__: string;

const Welcome: React.FC = () => (
    <div className="welcome-container">
        <h1 className="welcome-title">Sema Code</h1>
        <a
            href="https://github.com/midea-ai/sema-code-core"
            className="welcome-version-badge"
            title="sema-code-core"
        >
            <span>sema-core</span>
            <span>v{__SEMA_CORE_VERSION__}</span>
        </a>
        <p className="welcome-subtitle">AI 驱动的智能编程助手</p>
    </div>
);

export default Welcome;
