import React from 'react';
import { useLang, useT, normalizeLang, languageLabel, LANGS, LANGUAGES, type Language } from '../../../common/i18n/react';

interface ModelConfigReminderProps {
    message: string;
    onClose: () => void;
    onOpenConfig: () => void;
    onLanguageChange: (lang: Language) => void;
}

const ModelConfigReminder: React.FC<ModelConfigReminderProps> = ({
    message,
    onClose,
    onOpenConfig,
    onLanguageChange
}) => {
    const t = useT();
    const lang = useLang();
    if (!message) return null;

    return (
        <div className="chat-block model-config-reminder">
            <div className="model-config-reminder-content">
                <div className="model-config-reminder-icon">⚠️</div>
                <div className="model-config-reminder-text">{message}</div>
                <div className="model-config-reminder-actions">
                    <button className="model-config-reminder-button primary" onClick={onOpenConfig}>
                        {t('chat.openConfig')}
                    </button>
                </div>
            </div>
            {/* label 见 languageLabel()、选项用各语言自称，保证任一界面语言下都能找到入口 */}
            <div className="model-config-reminder-language">
                <label htmlFor="modelReminderLang">{languageLabel()}</label>
                <select
                    id="modelReminderLang"
                    className="model-config-reminder-language-select"
                    value={lang}
                    onChange={(e) => onLanguageChange(normalizeLang(e.target.value))}
                >
                    {LANGUAGES.map(code => (
                        <option key={code} value={code}>{LANGS[code].label}</option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export default ModelConfigReminder;
