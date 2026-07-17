import React from 'react';
import { Config, VscodeApi } from './types';
import ProviderLogo from '../common/ProviderLogo';
import { TrashIcon } from './utils/svgIcons';
import './style/section.css';

interface ModelListProps {
    config: Config | null;
    vscode: VscodeApi;
}

const ModelList: React.FC<ModelListProps> = ({ config, vscode }) => {
    // 解析模型名称以提取 provider 和 model 信息
    const parseModelName = (modelName: string) => {
        // 模型名称格式例如: "Claude-Sonnet-4-20250514-v1.0[custom]"
        // 提取 provider 部分（方括号内的内容）
        const providerMatch = modelName.match(/\[([^\]]+)\]$/);
        const provider = providerMatch ? providerMatch[1] : 'unknown';

        // 提取模型名称部分（去掉 provider 部分）
        const modelDisplayName = modelName.replace(/\[[^\]]+\]$/, '');

        return {
            provider,
            modelDisplayName,
            fullName: modelName
        };
    };

    // 获取模型的任务类型 - main 优先级高于 quick
    const getModelTaskType = (modelName: string): 'main' | 'quick' | '-' => {
        if (!config?.taskConfig) return '-';

        // 优先检查是否为 main 任务，即使同时也是 quick 任务
        if (config.taskConfig.main === modelName) return 'main';
        if (config.taskConfig.quick === modelName) return 'quick';
        return '-';
    };

    // 按任务类型排序模型列表
    const getSortedModelList = () => {
        if (!config?.modelList) return [];

        return [...config.modelList].sort((a, b) => {
            const taskA = getModelTaskType(a);
            const taskB = getModelTaskType(b);

            // 排序优先级: main > quick > -
            const taskOrder = { 'main': 0, 'quick': 1, '-': 2 };
            return taskOrder[taskA] - taskOrder[taskB];
        });
    };

    const handleDelete = (modelName: string) => {
        const { provider } = parseModelName(modelName);
        vscode.postMessage({
            command: 'deleteModel',
            provider,
            modelName
        });
    };


    const hasModels = config && config.modelList && config.modelList.length > 0;
    const sortedModelList = getSortedModelList();

    return (
        <div className="model-list">
            <div className="section-header">
                <h2 className="section-title" style={{ marginBottom: 0 }}>模型列表</h2>
            </div>
            <table className="model-table">
                <thead>
                    <tr>
                        <th>服务提供商</th>
                        <th>模型</th>
                        <th>任务</th>
                        <th>删除</th>
                    </tr>
                </thead>
                <tbody>
                    {!hasModels ? (
                        <tr>
                            <td colSpan={4} className="empty-state">暂无配置的模型</td>
                        </tr>
                    ) : (
                        sortedModelList.map((modelName, index) => {
                            const { provider, modelDisplayName, fullName } = parseModelName(modelName);
                            const taskType = getModelTaskType(modelName);

                            return (
                                <tr key={index}>
                                    <td>
                                        <span className="provider-cell">
                                            <ProviderLogo provider={provider.toLowerCase()} className="provider-cell-logo" />
                                            {provider}
                                        </span>
                                    </td>
                                    <td>{modelDisplayName}</td>
                                    <td>
                                        {taskType !== '-' && (
                                            <span className={`task-badge task-${taskType}`}>
                                                {taskType}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <button
                                            className="section-icon-btn section-icon-btn-danger"
                                            onClick={() => handleDelete(fullName)}
                                            title="删除此模型"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default ModelList;
