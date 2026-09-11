import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
import IconSelect from './IconSelect';
import { useT } from '../common/i18n/react';

const initialFormState = {
    name: '',
    description: '',
    prompt: '',
    argumentHint: '',
    locate: 'project' as 'project' | 'user'
};

const NAME_MIN = 3;
const NAME_MAX = 50;
const DESCRIPTION_MIN = 1;
const DESCRIPTION_MAX = 200;
const PROMPT_MIN = 1;
const PROMPT_MAX = 1000;

interface AddCommandFormProps {
    vscode: VscodeApi;
    onSuccess: () => void;
    onClose: () => void;
}

const AddCommandForm: React.FC<AddCommandFormProps> = ({ vscode, onSuccess, onClose }) => {
    const t = useT();
    const [formData, setFormData] = useState(initialFormState);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'addCommandResult') {
                setSubmitting(false);
                if (message.success) {
                    resetForm();
                    onSuccess();
                    onClose();
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [onSuccess, onClose]);

    const resetForm = () => {
        setFormData(initialFormState);
    };

    const handleFormChange = (field: keyof typeof formData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const isNameValid = () => {
        const name = formData.name.trim();
        const len = name.length;
        if (len < NAME_MIN || len > NAME_MAX) return false;
        return /^[a-zA-Z0-9_-]+$/.test(name);
    };

    const isDescriptionValid = () => {
        const len = formData.description.trim().length;
        return len >= DESCRIPTION_MIN && len <= DESCRIPTION_MAX;
    };

    const isPromptValid = () => {
        const len = formData.prompt.trim().length;
        return len >= PROMPT_MIN && len <= PROMPT_MAX;
    };

    const handleSubmit = () => {
        if (!formData.name.trim() || !isNameValid()) return;
        if (!formData.description.trim() || !isDescriptionValid()) return;
        if (!formData.prompt.trim() || !isPromptValid()) return;

        setSubmitting(true);

        vscode.postMessage({
            command: 'addCommand',
            data: {
                name: formData.name.trim(),
                description: formData.description.trim(),
                prompt: formData.prompt.trim(),
                ...(formData.argumentHint.trim() && { argumentHint: formData.argumentHint.trim() }),
                locate: formData.locate
            }
        });
    };

    const handleCancel = () => {
        resetForm();
        onClose();
    };

    return (
        <div className="add-agent-form">
            <div className="agent-form-group">
                <label>{t('config.form.name')} <span className="required">*</span></label>
                <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    placeholder={t('config.command.namePlaceholder')}
                    maxLength={NAME_MAX}
                    className={formData.name.trim() && !isNameValid() ? 'input-error' : ''}
                />
                <div className="field-hint">
                    <span className={formData.name.trim().length > NAME_MAX ? 'error' : ''}>
                        {formData.name.length}/{NAME_MAX}
                    </span>
                    {formData.name.trim().length > 0 && formData.name.trim().length < NAME_MIN && (
                        <span className="error">{t('config.form.minChars', { n: NAME_MIN })}</span>
                    )}
                    {formData.name.trim().length >= NAME_MIN && formData.name.trim().length <= NAME_MAX && !isNameValid() && (
                        <span className="error">{t('config.form.nameCharset')}</span>
                    )}
                </div>
            </div>

            <div className="agent-form-group">
                <label>{t('config.form.description')} <span className="required">*</span></label>
                <textarea
                    value={formData.description}
                    onChange={(e) => handleFormChange('description', e.target.value)}
                    placeholder={t('config.command.descPlaceholder')}
                    rows={3}
                    maxLength={DESCRIPTION_MAX}
                    className={formData.description.trim() && !isDescriptionValid() ? 'input-error' : ''}
                />
                <div className="field-hint">
                    <span className={formData.description.trim().length > DESCRIPTION_MAX ? 'error' : ''}>
                        {formData.description.length}/{DESCRIPTION_MAX}
                    </span>
                    {formData.description.trim().length > 0 && formData.description.trim().length < DESCRIPTION_MIN && (
                        <span className="error">{t('config.form.minChars', { n: DESCRIPTION_MIN })}</span>
                    )}
                </div>
            </div>

            <div className="agent-form-group">
                <label>Prompt <span className="required">*</span></label>
                <textarea
                    value={formData.prompt}
                    onChange={(e) => handleFormChange('prompt', e.target.value)}
                    placeholder={t('config.command.promptPlaceholder')}
                    rows={8}
                    maxLength={PROMPT_MAX}
                    className={formData.prompt.trim() && !isPromptValid() ? 'input-error' : ''}
                />
                <div className="field-hint">
                    <span className={!isPromptValid() && formData.prompt.trim().length > 0 ? 'error' : ''}>
                        {formData.prompt.length}/{PROMPT_MAX}
                    </span>
                    {formData.prompt.trim().length > 0 && formData.prompt.trim().length < PROMPT_MIN && (
                        <span className="error">{t('config.form.minChars', { n: PROMPT_MIN })}</span>
                    )}
                </div>
            </div>

            <div className="agent-form-group">
                <label>{t('config.command.argHint')}</label>
                <input
                    type="text"
                    value={formData.argumentHint}
                    onChange={(e) => handleFormChange('argumentHint', e.target.value)}
                    placeholder={t('config.command.argHintPlaceholder')}
                />
            </div>

            <div className="agent-form-group">
                <label>{t('config.form.location')}</label>
                <IconSelect
                    value={formData.locate}
                    onChange={(value) => handleFormChange('locate', value as 'project' | 'user')}
                    options={[
                        { value: 'project', label: t('common.projectDefault') },
                        { value: 'user', label: t('common.userLevel') }
                    ]}
                />
            </div>

            <div className="add-agent-form-footer">
                <button className="btn-secondary" onClick={handleCancel}>{t('common.cancel')}</button>
                <button
                    className="btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || !formData.name.trim() || !isNameValid() || !isDescriptionValid() || !isPromptValid()}
                >
                    {submitting ? t('common.creating') : t('common.create')}
                </button>
            </div>
        </div>
    );
};

export default AddCommandForm;
