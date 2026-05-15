import { useState, useEffect, RefObject } from 'react';
import { VscodeApi } from '../../../types';

export interface UseModelMenuReturn {
    showModelMenu: boolean;
    isModelLoading: boolean;
    currentModel: string; // 返回当前模型（可能是临时的）
    setShowModelMenu: (show: boolean) => void;
    handleToggleModelMenu: () => void;
    handleModelSwitch: (model: string) => void;
    handleOpenConfig: () => void;
}

/**
 * 模型菜单管理 Hook
 */
export const useModelMenu = (
    vscode: VscodeApi,
    disabled: boolean,
    modelName: string,
    modelMenuRef: RefObject<HTMLDivElement>,
    modelButtonRef: RefObject<HTMLButtonElement>
): UseModelMenuReturn => {
    const [showModelMenu, setShowModelMenu] = useState<boolean>(false);
    const [isModelLoading, setIsModelLoading] = useState<boolean>(true);
    const [localModel, setLocalModel] = useState<string>(modelName); // 本地状态

    // 监听外部传入的模型名称变化
    useEffect(() => {
        setLocalModel(modelName);
    }, [modelName]);

    // 监听模型名称变化，更新加载状态
    useEffect(() => {
        if (modelName) {
            setIsModelLoading(false);
        } else {
            const timer = setTimeout(() => {
                setIsModelLoading(false);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [modelName]);

    // 点击外部关闭模型菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const isOutsideMenu = modelMenuRef.current && !modelMenuRef.current.contains(target);
            const isOutsideButton = modelButtonRef.current && !modelButtonRef.current.contains(target);

            if (isOutsideMenu && isOutsideButton) {
                setShowModelMenu(false);
            }
        };

        if (showModelMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showModelMenu, modelMenuRef, modelButtonRef]);

    const handleToggleModelMenu = () => {
        if (disabled || isModelLoading) return;
        setShowModelMenu(!showModelMenu);
    };

    const handleModelSwitch = (model: string) => {
        if (model === localModel) {
            // 点击当前模型，不做任何操作
            setShowModelMenu(false);
            return;
        }

        // 立即更新本地显示的值
        setLocalModel(model);
        
        // 发送消息给 VSCode 进行实际切换
        vscode.postMessage({
            type: 'switchModel',
            modelName: model
        });
        
        setShowModelMenu(false);
    };

    const handleOpenConfig = () => {
        vscode.postMessage({
            type: 'openConfig'
        });
        setShowModelMenu(false);
    };

    return {
        showModelMenu,
        isModelLoading,
        currentModel: localModel, // 返回本地状态
        setShowModelMenu,
        handleToggleModelMenu,
        handleModelSwitch,
        handleOpenConfig
    };
};