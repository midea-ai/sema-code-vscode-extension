import React from 'react';
import { useT } from '../../../common/i18n/react';

const DesignModeHint: React.FC = () => {
    const t = useT();
    return (
        <div className="welcome-container">
            <div className="welcome-header">
                <span className="welcome-title">Sema Code</span>
                <span className="welcome-mode-tag">Design</span>
            </div>
            <p className="welcome-subtitle">{t('chat.design.hint')}</p>
        </div>
    );
};

export default DesignModeHint;
