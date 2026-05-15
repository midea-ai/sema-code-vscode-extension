import React from 'react';

const DesignModeHint: React.FC = () => {
    return (
        <div className="welcome-container">
            <div className="welcome-header">
                <span className="welcome-icon">🎨</span>
                <span className="welcome-title">已进入设计模式</span>
            </div>
            <div className="welcome-message">
                <div className="welcome-line">
                    <span className="welcome-intro-text">请描述你想要的页面 / 原型 / 演示 ～</span>
                </div>
            </div>
        </div>
    );
};

export default DesignModeHint;
