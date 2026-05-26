import React from 'react';

const DesignModeHint: React.FC = () => {
    return (
        <div className="welcome-container">
            <div className="welcome-header">
                <span className="welcome-title">Sema Code</span>
                <span className="welcome-mode-tag">Design</span>
            </div>
            <p className="welcome-subtitle">请描述你想要的页面 / 原型 / 演示 ～</p>
        </div>
    );
};

export default DesignModeHint;
