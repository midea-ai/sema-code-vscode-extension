import React, { useState, useEffect } from 'react';
import { VscodeApi } from './types';
import {
    TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_VIEW_FILE,
    TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_EDIT_NOTEBOOK,
    TOOL_NAME_RUN_SHELL, TOOL_NAME_CREATE_CRON, TOOL_NAME_DEL_CRON,
    TOOL_NAME_LIST_CRONS, TOOL_NAME_FETCH_URL, TOOL_NAME_SKILL
} from '../../utils/tool';

// 预设工具组合
const TOOL_PRESETS = {
    readonly: {
        name: '只读工具',
        tools: [TOOL_NAME_SEARCH_FILES, TOOL_NAME_SEARCH_CONTENT, TOOL_NAME_VIEW_FILE]
    },
    edit: {
        name: '编辑工具',
        tools: [TOOL_NAME_PATCH_FILE, TOOL_NAME_WRITE_FILE, TOOL_NAME_EDIT_NOTEBOOK]
    },
    execute: {
        name: '终端工具',
        tools: [TOOL_NAME_RUN_SHELL]
    },
    cron: {
        name: '定时任务工具',
        tools: [TOOL_NAME_CREATE_CRON, TOOL_NAME_DEL_CRON, TOOL_NAME_LIST_CRONS]
    },
    other: {
        name: '其他工具',
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
        const preset = TOOL_PRESETS[presetKey as keyof typeof TOOL_PRESETS];
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
                <label>名称 <span className="required">*</span></label>
                <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    placeholder="Agent 名称，如：test_runner, code-checker 等"
                    maxLength={NAME_MAX}
                    className={formData.name.trim() && !isNameValid() ? 'input-error' : ''}
                />
                <div className="field-hint">
                    <span className={formData.name.trim().length > NAME_MAX ? 'error' : ''}>
                        {formData.name.length}/{NAME_MAX}
                    </span>
                    {formData.name.trim().length > 0 && formData.name.trim().length < NAME_MIN && (
                        <span className="error">（至少 {NAME_MIN} 字符）</span>
                    )}
                    {formData.name.trim().length >= NAME_MIN && formData.name.trim().length <= NAME_MAX && !isNameValid() && (
                        <span className="error">（只允许英文字母、数字、连字符和下划线）</span>
                    )}
                </div>
            </div>

            <div className="agent-form-group">
                <label>描述 <span className="required">*</span></label>
                <textarea
                    value={formData.description}
                    onChange={(e) => handleFormChange('description', e.target.value)}
                    placeholder="Agent 的使用时机"
                    rows={3}
                    maxLength={DESCRIPTION_MAX}
                    className={formData.description.trim() && !isDescriptionValid() ? 'input-error' : ''}
                />
                <div className="field-hint">
                    <span className={formData.description.trim().length > DESCRIPTION_MAX ? 'error' : ''}>
                        {formData.description.length}/{DESCRIPTION_MAX}
                    </span>
                    {formData.description.trim().length > 0 && formData.description.trim().length < DESCRIPTION_MIN && (
                        <span className="error">（至少 {DESCRIPTION_MIN} 字符）</span>
                    )}
                </div>
            </div>

            <div className="agent-form-group">
                <label>Prompt <span className="required">*</span></label>
                <textarea
                    value={formData.prompt}
                    onChange={(e) => handleFormChange('prompt', e.target.value)}
                    placeholder="Agent 的系统提示词"
                    rows={8}
                    maxLength={PROMPT_MAX}
                    className={formData.prompt.trim() && !isPromptValid() ? 'input-error' : ''}
                />
                <div className="field-hint">
                    <span className={!isPromptValid() && formData.prompt.trim().length > 0 ? 'error' : ''}>
                        {formData.prompt.length}/{PROMPT_MAX}
                    </span>
                    {formData.prompt.trim().length > 0 && formData.prompt.trim().length < PROMPT_MIN && (
                        <span className="error">（至少 {PROMPT_MIN} 字符）</span>
                    )}
                </div>
            </div>

            <div className="agent-form-group">
                <label>工具</label>
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
                        使用所有工具
                    </label>
                    {!useAllTools && (
                        <div className="tools-selection">
                            <div className="tools-presets">
                                <div className="presets-title">预设</div>
                                <div className="presets-grid">
                                    {Object.entries(TOOL_PRESETS).map(([key, preset]) => (
                                        <label key={key} className="checkbox-label preset-item">
                                            <input
                                                type="checkbox"
                                                checked={selectedPresets.has(key)}
                                                onChange={(e) => handlePresetSelection(key, e.target.checked)}
                                            />
                                            {preset.name} ({preset.tools.length})
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="tools-header">
                                <div className="select-all-indicator">
                                    已选择 ({selectedTools.size}/{ALL_TOOLS.length})
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
                    <label>模型</label>
                    <select
                        value={formData.model}
                        onChange={(e) => handleFormChange('model', e.target.value)}
                    >
                        <option value="main">Main (默认)</option>
                        <option value="quick">Quick</option>
                    </select>
                </div>

                <div className="agent-form-group">
                    <label>位置</label>
                    <select
                        value={formData.locate}
                        onChange={(e) => handleFormChange('locate', e.target.value as 'project' | 'user')}
                    >
                        <option value="project">项目级 (默认)</option>
                        <option value="user">用户级</option>
                    </select>
                </div>
            </div>

            <div className="add-agent-form-footer">
                <button className="btn-secondary" onClick={handleCancel}>取消</button>
                <button
                    className="btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || !formData.name.trim() || !isNameValid() || !isDescriptionValid() || !isPromptValid()}
                >
                    {submitting ? '创建中...' : '创建'}
                </button>
            </div>
        </div>
    );
};

export default AddAgentForm;
