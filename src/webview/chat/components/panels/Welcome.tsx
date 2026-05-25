// Welcome.tsx
import React from 'react';

const Welcome: React.FC = () => (
    <div className="welcome-container">
        <h1 className="welcome-title">Sema Code</h1>
        <a
            href="https://github.com/midea-ai/sema-code-core"
            className="welcome-version-badge"
            title="sema-code-core"
        >
            <img
                src="https://img.shields.io/npm/v/sema-core?label=sema-core&style=flat-square"
                alt="sema-core version"
            />
        </a>
        <p className="welcome-subtitle">AI 驱动的智能编程助手</p>
    </div>
);

export default Welcome;
