import React from 'react';
import { useLang, useT, normalizeLang, languageLabel, LANGS, LANGUAGES, type Language } from '../../../common/i18n/react';
import { GlobeIcon, SlidersIcon } from './IconButton';

interface ModelConfigReminderProps {
    /** 是否显示；文案由组件按当前语言从 i18n 取，不再由外部传入 */
    visible: boolean;
    onClose: () => void;
    onOpenConfig: () => void;
    onLanguageChange: (lang: Language) => void;
}

const ModelConfigReminder: React.FC<ModelConfigReminderProps> = ({
    visible,
    onClose,
    onOpenConfig,
    onLanguageChange
}) => {
    const t = useT();
    const lang = useLang();
    if (!visible) return null;

    // 语言入口显示文字：英文只显示「English」，其它语言显示「中文 / Language」，保证任一界面语言下都能找到入口
    const langText = lang === 'en' ? LANGS.en.label : `${LANGS[lang].label} / Language`;

    return (
        <div className="chat-block model-config-reminder">
            <div className="model-config-reminder-content">
                <div className="model-config-reminder-icon"><SlidersIcon /></div>
                <div className="model-config-reminder-text">
                    <div className="model-config-reminder-title">{t('chat.modelNotConfigured.title')}</div>
                    <div className="model-config-reminder-desc">{t('chat.modelNotConfigured.desc')}</div>
                </div>
            </div>
            {/* 按钮行放在图标行外层，左边缘与图标对齐；语言入口靠右 */}
            <div className="model-config-reminder-actions">
                <button className="model-config-reminder-button primary" onClick={onOpenConfig}>
                    {t('chat.openConfig')}
                </button>
                {/* 可见层：地球图标 + 文字 + 箭头；透明的原生 select 盖在上面接管点击，下拉选项用各语言自称 */}
                <div className="model-config-reminder-language" title={languageLabel()}>
                    <GlobeIcon />
                    <span className="model-config-reminder-language-text">{langText}</span>
                    <span className="model-config-reminder-language-chevron" aria-hidden="true" />
                    <select
                        id="modelReminderLang"
                        className="model-config-reminder-language-select"
                        aria-label={languageLabel()}
                        value={lang}
                        onChange={(e) => onLanguageChange(normalizeLang(e.target.value))}
                    >
                        {LANGUAGES.map(code => (
                            <option key={code} value={code}>{LANGS[code].label}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
};

export default ModelConfigReminder;
