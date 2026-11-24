import React, { useMemo, useState } from 'react';
import { Config, VscodeApi } from './types';
import ProviderLogo, { parseProviderKey, stripProviderSuffix } from '../common/ProviderLogo';
import { EditIcon, TrashIcon, PlusIcon } from './utils/svgIcons';
import { useRowDragOrder } from './utils/useRowDragOrder';
import { useT } from '../common/i18n/react';
import './style/section.css';

interface ImageModelListProps {
    config: Config | null;
    vscode: VscodeApi;
    /** 点「添加图像模型」：由 App 切到新增图像模型页 */
    onAdd: () => void;
}

/**
 * 图像模型列表：与对话模型各自独立，没有对话模型时也能配置。
 * 没有「main / quick」任务角标，只在当前 image 指针指向的那条上标「使用中」；该条固定置顶且不可拖动。
 */
const ImageModelList: React.FC<ImageModelListProps> = ({ config, vscode, onAdd }) => {
    const t = useT();
    /** 拖拽换序只在 VSCode 侧生效（JB 配置页不接 saveModelOrder，保持原有展示） */
    const canDrag = !(window as any).__SEMA_JB__;
    /** 拖完先按本地顺序渲染，不等 host 回推 */
    const [localOrder, setLocalOrder] = useState<string[] | null>(null);

    const imageList = useMemo(() => config?.imageModelList || [], [config?.imageModelList]);
    const imageActive = config?.taskConfig?.image || '';

    /** 「使用中」的图像模型固定置顶，类似对话模型里的 main */
    const pinnedNames = useMemo(
        () => (imageActive && imageList.includes(imageActive) ? [imageActive] : []),
        [imageActive, imageList]
    );

    /** 展示顺序：「使用中」置顶 → 其余按拖拽保存的顺序 → 新增模型补尾 */
    const orderedNames = useMemo(() => {
        const head = pinnedNames.filter(name => imageList.includes(name));
        const source = localOrder ?? imageList;
        const tail = source.filter(name => imageList.includes(name) && !head.includes(name));
        const added = imageList.filter(name => !head.includes(name) && !tail.includes(name));
        return [...head, ...tail, ...added];
    }, [imageList, pinnedNames, localOrder]);

    /** 拖拽排序：只落扩展本地，不涉及 core */
    const { tableRef, rowProps } = useRowDragOrder(orderedNames, pinnedNames, order => {
        setLocalOrder(order);
        vscode.postMessage({ command: 'saveModelOrder', order, kind: 'image' });
    });

    const handleDelete = (modelName: string) => {
        vscode.postMessage({ command: 'deleteImageModel', modelName });
    };

    /** 编辑：向扩展端要完整落盘配置，回 imageModelProfileResult 后由 App 切到新增图像模型页回填（provider 保留原始大小写，core 精确匹配） */
    const handleEdit = (fullName: string) => {
        const providerMatch = fullName.match(/\[([^\]]+)\]$/);
        vscode.postMessage({
            command: 'getImageModelProfile',
            provider: providerMatch ? providerMatch[1] : '',
            modelName: stripProviderSuffix(fullName)
        });
    };

    return (
        <div className="image-model-list">
            <div className="section-header">
                <h2 className="section-title" style={{ marginBottom: 0 }}>{t('config.imageList.title')}</h2>
                {/* 图像模型是可选项：用次要样式，避免和「添加模型」同样显眼被误认为必填 */}
                <button className="section-btn secondary small model-add-btn" onClick={onAdd}>
                    <PlusIcon />
                    {t('config.imageList.add')}
                </button>
            </div>
            {/* 说明只在还没有图像模型时显示；等 config 加载完再判断，避免已有模型时先闪一下 */}
            {config && imageList.length === 0 && (
                <div className="description image-model-list-desc">{t('config.imageList.desc')}</div>
            )}
            {orderedNames.length > 0 && (
                <table className="model-table" ref={tableRef}>
                    <thead>
                        <tr>
                            <th>{t('config.modelList.provider')}</th>
                            <th>{t('config.modelList.model')}</th>
                            <th>{t('config.modelList.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orderedNames.map(fullName => {
                            const provider = parseProviderKey(fullName);
                            return (
                                <tr key={fullName} {...rowProps(fullName, canDrag)}>
                                    <td>
                                        <span className="provider-cell">
                                            <ProviderLogo provider={provider} className="provider-cell-logo" />
                                            {provider}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="model-cell">
                                            {stripProviderSuffix(fullName)}
                                            {fullName === imageActive && (
                                                <span className="task-badge task-image">{t('config.imageList.inUse')}</span>
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
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default ImageModelList;
