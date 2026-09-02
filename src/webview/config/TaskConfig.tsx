import React, { useState, useEffect } from 'react';
import { Config, VscodeApi } from './types';
import { RECOMMENDED_MAIN_MODEL, RECOMMENDED_QUICK_MODEL } from './default/defaultModelProvider';
import ProviderLogo, { parseProviderKey, stripProviderSuffix } from '../common/ProviderLogo';
import IconSelect from './IconSelect';

interface TaskConfigProps {
    config: Config | null;
    vscode: VscodeApi;
}

const TaskConfig: React.FC<TaskConfigProps> = ({ config, vscode }) => {
    const [taskConfig, setTaskConfig] = useState({
        main: '',
        quick: ''
    });
    const [savedConfig, setSavedConfig] = useState({
        main: '',
        quick: ''
    });
    const [hasChanges, setHasChanges] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    // 解析模型名称以显示友好的名称（提供商由选项前的 logo 标识，不再重复文字后缀）
    const parseModelName = (modelName: string) => stripProviderSuffix(modelName);

    useEffect(() => {
        if (config && config.taskConfig) {
            const newConfig = {
                main: config.taskConfig.main || '',
                quick: config.taskConfig.quick || ''
            };
            setTaskConfig(newConfig);
            setSavedConfig(newConfig);
        }
    }, [config]);

    useEffect(() => {
        const changed =
            taskConfig.main !== savedConfig.main ||
            taskConfig.quick !== savedConfig.quick;
        setHasChanges(changed);
    }, [taskConfig, savedConfig]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data;
            if (msg.command === 'taskConfigConfirmed') {
                setSavedConfig({ ...taskConfig });
                setHasChanges(false);
                setMessage({ text: '✓ 任务配置已更新', type: 'success' });
                setTimeout(() => setMessage(null), 3000);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [taskConfig]);

    const handleChange = (field: string, value: string) => {
        setTaskConfig(prev => ({ ...prev, [field]: value }));
        vscode.postMessage({
            command: 'updateModelPointer',
            pointer: field,
            modelName: value
        });
    };

    const handleConfirm = () => {
        if (!hasChanges) return;

        vscode.postMessage({
            command: 'confirmTaskConfig',
            data: taskConfig
        });
    };

    // 使用 modelList 中的所有模型作为可选项
    const availableModels = config?.modelList || [];

    const modelOptions = availableModels.map(modelName => ({
        value: modelName,
        label: parseModelName(modelName),
        icon: <ProviderLogo provider={parseProviderKey(modelName)} className="icon-select-logo" />
    }));

    return (
        <div className="task-config">
            <h2 className="section-title">任务配置</h2>

            <div className="task-row">
                <label className="task-label" htmlFor="mainModel">Main</label>
                <div className="task-select-wrapper">
                    <IconSelect
                        id="mainModel"
                        value={taskConfig.main}
                        onChange={(value) => handleChange('main', value)}
                        options={modelOptions}
                        disabled={availableModels.length === 0}
                        placeholder="无可用模型"
                    />
                    {RECOMMENDED_MAIN_MODEL && <span className="task-recommend">{RECOMMENDED_MAIN_MODEL}</span>}
                </div>
            </div>

            <div className="task-row">
                <label className="task-label" htmlFor="quickModel">Quick</label>
                <div className="task-select-wrapper">
                    <IconSelect
                        id="quickModel"
                        value={taskConfig.quick}
                        onChange={(value) => handleChange('quick', value)}
                        options={modelOptions}
                        disabled={availableModels.length === 0}
                        placeholder="无可用模型"
                    />
                    {RECOMMENDED_QUICK_MODEL && <span className="task-recommend">{RECOMMENDED_QUICK_MODEL}</span>}
                </div>
            </div>

            <div className="task-row" style={{ marginTop: '20px' }}>
                <div></div>
                <button
                    type="button"
                    className="confirm-task-btn"
                    disabled={!hasChanges}
                    onClick={handleConfirm}
                >
                    确认提交
                </button>
            </div>

            {message && (
                <div className={`message ${message.type}`} style={{ marginTop: '12px', display: 'flex' }}>
                    {message.text}
                </div>
            )}
        </div>
    );
};

export default TaskConfig;
