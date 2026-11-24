import React, { useMemo, useState } from 'react';
import { Config, VscodeApi } from './types';
import ProviderLogo from '../common/ProviderLogo';
import { EditIcon, TrashIcon, PlusIcon } from './utils/svgIcons';
import { useRowDragOrder } from './utils/useRowDragOrder';
import { useT } from '../common/i18n/react';
import './style/section.css';

interface ModelListProps {
    config: Config | null;
    vscode: VscodeApi;
    /** 点「添加模型」：由 App 切到新增模型页 */
    onAdd: () => void;
}

const ModelList: React.FC<ModelListProps> = ({ config, vscode, onAdd }) => {
    const t = useT();
    /** 拖拽换序只在 VSCode 侧生效（JB 配置页不接 saveModelOrder，保持原有展示） */
    const canDrag = !(window as any).__SEMA_JB__;
    /** 拖完先按本地顺序渲染，不等 host 回推（host 只在 loadConfig 时下发排好序的列表） */
    const [localOrder, setLocalOrder] = useState<string[] | null>(null);

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

    /** main / quick 固定置顶，不可拖动 */
    const pinnedNames = useMemo(() => {
        const names = [config?.taskConfig?.main, config?.taskConfig?.quick];
        return names.filter((name, index): name is string => !!name && names.indexOf(name) === index);
    }, [config?.taskConfig?.main, config?.taskConfig?.quick]);

    /**
     * 展示顺序：main / quick 置顶 → 其余按拖拽保存的顺序 → 新增模型补尾。
     * 没拖过时与原来的「任务类型排序 + core 原顺序」一致
     */
    const orderedNames = useMemo(() => {
        const all = config?.modelList ?? [];
        const head = pinnedNames.filter(name => all.includes(name));
        const source = localOrder ?? all;
        const tail = source.filter(name => all.includes(name) && !head.includes(name));
        const added = all.filter(name => !head.includes(name) && !tail.includes(name));
        return [...head, ...tail, ...added];
    }, [config?.modelList, pinnedNames, localOrder]);

    /** 拖拽排序：只落扩展本地，不涉及 core */
    const { tableRef, rowProps } = useRowDragOrder(orderedNames, pinnedNames, order => {
        setLocalOrder(order);
        vscode.postMessage({ command: 'saveModelOrder', order });
    });

    const handleDelete = (modelName: string) => {
        const { provider } = parseModelName(modelName);
        vscode.postMessage({
            command: 'deleteModel',
            provider,
            modelName
        });
    };

    /** 编辑：向扩展端要完整落盘配置，回 modelProfileResult 后由 App 切到新增页回填 */
    const handleEdit = (fullName: string) => {
        const { provider, modelDisplayName } = parseModelName(fullName);
        vscode.postMessage({
            command: 'getModelProfile',
            provider,
            modelName: modelDisplayName
        });
    };

    const hasModels = orderedNames.length > 0;

    return (
        <div className="model-list">
            <div className="section-header">
                <h2 className="section-title" style={{ marginBottom: 0 }}>{t('config.tab.modelList')}</h2>
                <button className="section-btn primary small model-add-btn" onClick={onAdd}>
                    <PlusIcon />
                    {t('config.modelForm.addModel')}
                </button>
            </div>
            <table className="model-table" ref={tableRef}>
                <thead>
                    <tr>
                        <th>{t('config.modelList.provider')}</th>
                        <th>{t('config.modelList.model')}</th>
                        <th>{t('config.modelList.actions')}</th>
                    </tr>
                </thead>
                <tbody>
                    {!hasModels ? (
                        <tr>
                            <td colSpan={3} className="empty-state">{t('config.modelList.empty')}</td>
                        </tr>
                    ) : (
                        orderedNames.map(modelName => {
                            const { provider, modelDisplayName, fullName } = parseModelName(modelName);
                            const taskType = getModelTaskType(modelName);

                            return (
                                <tr key={fullName} {...rowProps(modelName, canDrag)}>
                                    <td>
                                        <span className="provider-cell">
                                            <ProviderLogo provider={provider.toLowerCase()} className="provider-cell-logo" />
                                            {provider}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="model-cell">
                                            {modelDisplayName}
                                            {taskType !== '-' && (
                                                <span className={`task-badge task-${taskType}`}>
                                                    {taskType}
                                                </span>
                                            )}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="section-icon-btn-group">
                                            <button
                                                className="section-icon-btn"
                                                onClick={() => handleEdit(fullName)}
                                                title={t('config.modelList.editTip')}
                                            >
                                                <EditIcon />
                                            </button>
                                            <button
                                                className="section-icon-btn section-icon-btn-danger"
                                                onClick={() => handleDelete(fullName)}
                                                title={t('config.modelList.deleteTip')}
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
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
