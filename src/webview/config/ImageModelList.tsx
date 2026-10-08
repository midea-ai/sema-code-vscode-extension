import React from 'react';
import { Config, VscodeApi } from './types';
import ProviderLogo, { parseProviderKey, stripProviderSuffix } from '../common/ProviderLogo';
import { EditIcon, TrashIcon, PlusIcon } from './utils/svgIcons';
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
 * 没有「main / quick」任务角标，只在当前 image 指针指向的那条上标「使用中」。
 */
const ImageModelList: React.FC<ImageModelListProps> = ({ config, vscode, onAdd }) => {
    const t = useT();
    const imageList = config?.imageModelList || [];
    const imageActive = config?.taskConfig?.image || '';

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
            {imageList.length > 0 && (
                <table className="model-table">
                    <thead>
                        <tr>
                            <th>{t('config.modelList.provider')}</th>
                            <th>{t('config.modelList.model')}</th>
                            <th>{t('config.modelList.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {imageList.map(fullName => {
                            const provider = parseProviderKey(fullName);
                            return (
                                <tr key={fullName}>
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
