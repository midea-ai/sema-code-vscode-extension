import React from 'react';
import { CheckIcon } from '../../ui/IconButton';

interface ModelMenuProps {
    show: boolean;
    availableModels: string[];
    currentModel: string;
    isModelLoading: boolean;
    onModelSwitch: (model: string) => void;
    onOpenConfig: () => void;
    modelMenuRef: React.RefObject<HTMLDivElement>;
}

const ModelMenu: React.FC<ModelMenuProps> = ({
    show,
    availableModels,
    currentModel,
    isModelLoading,
    onModelSwitch,
    onOpenConfig,
    modelMenuRef
}) => {
    if (!show) return null;

    return (
        <div className="model-menu-popup" ref={modelMenuRef}>
            {/* 可用模型列表 */}
            {isModelLoading ? (
                <div className="model-menu-item model-current">
                    <span className="model-menu-text">正在加载模型...</span>
                </div>
            ) : availableModels.length > 0 ? (
                availableModels.map(model => (
                    <div
                        key={model}
                        className={`model-menu-item ${model === currentModel ? 'model-current' : ''}`}
                        onClick={() => onModelSwitch(model)}
                    >
                        <span className="model-menu-text">{model}</span>
                        {model === currentModel && (
                            <CheckIcon />
                        )}
                    </div>
                ))
            ) : (
                <div className="model-menu-item model-current">
                    <span className="model-menu-text">{currentModel || '未设置模型'}</span>
                </div>
            )}

            {/* 分隔线 */}
            {availableModels.length > 0 && <div className="model-menu-divider"></div>}

            {/* 模型管理 */}
            <div
                className="model-menu-item model-config"
                onClick={onOpenConfig}
            >
                <span className="model-menu-text">模型管理</span>
            </div>
        </div>
    );
};

export default ModelMenu;