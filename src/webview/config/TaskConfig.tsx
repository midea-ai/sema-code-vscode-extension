import React, { useState, useEffect } from 'react';
import { Config, VscodeApi } from './types';
import { RECOMMENDED_MAIN_MODEL_KEY, RECOMMENDED_QUICK_MODEL_KEY } from './default/defaultModelProvider';
import ProviderLogo, { parseProviderKey, stripProviderSuffix } from '../common/ProviderLogo';
import IconSelect from './IconSelect';
import { useT } from '../common/i18n/react';

interface TaskConfigProps {
    config: Config | null;
    vscode: VscodeApi;
}

/**
 * 任务配置：main / quick 两个下拉，选完即落盘，没有单独的提交按钮。
 * 失败时扩展端会弹错误并重新 loadConfig，本地状态随 config 回滚；
 * 成功反馈由上方模型表格里的 main / quick 角标移位承担，不再弹 toast。
 */
const TaskConfig: React.FC<TaskConfigProps> = ({ config, vscode }) => {
    const t = useT();
    const [taskConfig, setTaskConfig] = useState({
        main: '',
        quick: ''
    });

    // 解析模型名称以显示友好的名称（提供商由选项前的 logo 标识，不再重复文字后缀）
    const parseModelName = (modelName: string) => stripProviderSuffix(modelName);

    useEffect(() => {
        if (config && config.taskConfig) {
            setTaskConfig({
                main: config.taskConfig.main || '',
                quick: config.taskConfig.quick || ''
            });
        }
    }, [config]);

    const handleChange = (field: 'main' | 'quick', value: string) => {
        if (taskConfig[field] === value) return;
        const next = { ...taskConfig, [field]: value };
        setTaskConfig(next);
        vscode.postMessage({
            command: 'confirmTaskConfig',
            data: next
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
            <h2 className="section-title">{t('config.task.title')}</h2>

            <div className="task-row">
                <label className="task-label" htmlFor="mainModel">Main</label>
                <div className="task-select-wrapper">
                    <IconSelect
                        id="mainModel"
                        value={taskConfig.main}
                        onChange={(value) => handleChange('main', value)}
                        options={modelOptions}
                        disabled={availableModels.length === 0}
                        placeholder={t('config.task.noModel')}
                    />
                    {RECOMMENDED_MAIN_MODEL_KEY && <span className="task-recommend">{t(RECOMMENDED_MAIN_MODEL_KEY)}</span>}
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
                        placeholder={t('config.task.noModel')}
                    />
                    {RECOMMENDED_QUICK_MODEL_KEY && <span className="task-recommend">{t(RECOMMENDED_QUICK_MODEL_KEY)}</span>}
                </div>
            </div>
        </div>
    );
};

export default TaskConfig;
