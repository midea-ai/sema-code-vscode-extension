import React from 'react';

interface ModelConfigReminderProps {
    message: string;
    onClose: () => void;
    onOpenConfig: () => void;
}

const ModelConfigReminder: React.FC<ModelConfigReminderProps> = ({
    message,
    onClose,
    onOpenConfig
}) => {
    if (!message) return null;

    return (
        <div className="chat-block model-config-reminder">
            <div className="model-config-reminder-content">
                <div className="model-config-reminder-icon">⚠️</div>
                <div className="model-config-reminder-text">{message}</div>
                <div className="model-config-reminder-actions">
                    <button className="model-config-reminder-button primary" onClick={onOpenConfig}>
                        打开配置
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ModelConfigReminder;