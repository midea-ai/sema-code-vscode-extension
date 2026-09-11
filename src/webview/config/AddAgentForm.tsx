import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
import IconSelect from './IconSelect';
import {
    TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_VIEW_FILE,
    TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_EDIT_NOTEBOOK,
    TOOL_NAME_RUN_SHELL, TOOL_NAME_CREATE_CRON, TOOL_NAME_DEL_CRON,
    TOOL_NAME_LIST_CRONS, TOOL_NAME_FETCH_URL, TOOL_NAME_SKILL
} from '../../utils/tool';
import { useT, I18nKey } from '../common/i18n/react';

// 预设工具组合（nameKey 为文案 key，渲染期经 t() 取值）
const TOOL_PRESETS: Record<string, { nameKey: I18nKey; tools: string[] }> = {
    readonly: {
        nameKey: 'config.agent.preset.readonly',
        tools: [TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_VIEW_FILE]
    },
    edit: {
        nameKey: 'config.agent.preset.edit',
        tools: [TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_EDIT_NOTEBOOK]
    },
    execute: {
        nameKey: 'config.agent.preset.execute',
        tools: [TOOL_NAME_RUN_SHELL]
    },
    cron: {
        nameKey: 'config.agent.preset.cron',
        tools: [TOOL_NAME_CREATE_CRON, TOOL_NAME_DEL_CRON, TOOL_NAME_LIST_CRONS]
    },
    other: {
        nameKey: 'config.agent.preset.other',
        tools: [TOOL_NAME_FETCH_URL, TOOL_NAME_SKILL]
    }
};

// 所有可用工具列表
const ALL_TOOLS = [
    TOOL_NAME_RUN_SHELL, TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_VIEW_FILE,
    TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE, TOOL_NAME_EDIT_NOTEBOOK,
    TOOL_NAME_CREATE_CRON, TOOL_NAME_DEL_CRON, TOOL_NAME_LIST_CRONS,
    TOOL_NAME_FETCH_URL, TOOL_NAME_SKILL
];

// 创建表单的初始状态
const initialFormState = {
    name: '',
    description: '',
    prompt: '',
    tools: '*' as string[] | '*',
    model: 'main',
    locate: 'project' as 'project' | 'user'
};

const NAME_MIN = 3;
const NAME_MAX = 50;
const DESCRIPTION_MIN = 1;
const DESCRIPTION_MAX = 200;
const PROMPT_MIN = 1;
const PROMPT_MAX = 1000;

interface AddAgentFormProps {
    vscode: VscodeApi;
    onSuccess: () => void;
    onClose: () => void;
}

const AddAgentForm: React.FC<AddAgentFormProps> = ({ vscode, onSuccess, onClose }) => {
    const t = useT();
    const [formData, setFormData] = useState(initialFormState);
    const [useAllTools, setUseAllTools] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(ALL_TOOLS));
    const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set(['all']));

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'addAgentResult') {
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
        setUseAllTools(true);
        setSelectedTools(new Set(ALL_TOOLS));
        setSelectedPresets(new Set(['all']));
    };

    const handleFormChange = (field: keyof typeof formData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const updatePresetSelection = (selectedToolsSet: Set<string>) => {
        const newSelectedPresets = new Set<string>();
        Object.entries(TOOL_PRESETS).forEach(([key, preset]) => {
            if (preset.tools.every(tool => selectedToolsSet.has(tool))) {
                newSelectedPresets.add(key);
            }
        });
        setSelectedPresets(newSelectedPresets);
    };

    const handleToolSelection = (tool: string, checked: boolean) => {
        setSelectedTools(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(tool);
            else newSet.delete(tool);
            updatePresetSelection(newSet);
            return newSet;
        });
    };

    const handlePresetSelection = (presetKey: string, checked: boolean) => {
        const preset = TOOL_PRESETS[presetKey];
        if (!preset) return;
        setSelectedTools(prev => {
            const newSet = new Set(prev);
            if (checked) preset.tools.forEach(tool => newSet.add(tool));
            else preset.tools.forEach(tool => newSet.delete(tool));
            updatePresetSelection(newSet);
            return newSet;
        });
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

        let tools: string[] | '*' | undefined;
        if (useAllTools) {
            tools = '*';
        } else if (selectedTools.size > 0) {
            tools = Array.from(selectedTools);
        }

        vscode.postMessage({
            command: 'addAgent',
            data: {
                name: formData.name.trim(),
                description: formData.description.trim(),
                prompt: formData.prompt.trim(),
                tools,
                model: formData.model || 'main',
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
                    placeholder={t('config.agent.namePlaceholder')}
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
                    placeholder={t('config.agent.descPlaceholder')}
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
                    placeholder={t('config.agent.promptPlaceholder')}
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
                <label>{t('config.agent.tools')}</label>
                <div className="tools-input-group">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={useAllTools}
                            onChange={(e) => {
                                const checked = e.target.checked;
                                setUseAllTools(checked);
                                if (!checked) {
                                    const readonlyTools = TOOL_PRESETS.readonly.tools;
                                    setSelectedTools(new Set(readonlyTools));
                                    setSelectedPresets(new Set(['readonly']));
                                }
                            }}
                        />
                        {t('config.agent.useAllTools')}
                    </label>
                    {!useAllTools && (
                        <div className="tools-selection">
                            <div className="tools-presets">
                                <div className="presets-title">{t('config.agent.presets')}</div>
                                <div className="presets-grid">
                                    {Object.entries(TOOL_PRESETS).map(([key, preset]) => (
                                        <label key={key} className="checkbox-label preset-item">
                                            <input
                                                type="checkbox"
                                                checked={selectedPresets.has(key)}
                                                onChange={(e) => handlePresetSelection(key, e.target.checked)}
                                            />
                                            {t(preset.nameKey)} ({preset.tools.length})
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="tools-header">
                                <div className="select-all-indicator">
                                    {t('config.agent.selected')} ({selectedTools.size}/{ALL_TOOLS.length})
                                </div>
                            </div>
                            <div className="tools-list-checkboxes">
                                {ALL_TOOLS.map((tool, index) => (
                                    <label key={index} className="checkbox-label tool-item">
                                        <input
                                            type="checkbox"
                                            checked={selectedTools.has(tool)}
                                            onChange={(e) => handleToolSelection(tool, e.target.checked)}
                                        />
                                        {tool}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="form-row">
                <div className="agent-form-group">
                    <label>{t('config.agent.model')}</label>
                    <IconSelect
                        value={formData.model}
                        onChange={(value) => handleFormChange('model', value)}
                        options={[
                            { value: 'main', label: t('config.agent.mainDefault') },
                            { value: 'quick', label: 'Quick' }
                        ]}
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

export default AddAgentForm;
