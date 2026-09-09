import { useState, useEffect, RefObject } from 'react';
import { VscodeApi } from '../../../types';

export interface UseModelMenuReturn {
    showModelMenu: boolean;
    isModelLoading: boolean;
    currentModel: string; // 本会话当前生效的模型（来自后端事件，不做本地乐观更新）
    setShowModelMenu: (show: boolean) => void;
    handleToggleModelMenu: () => void;
    handleModelSwitch: (model: string) => void;
    handleOpenConfig: () => void;
}

/**
 * 模型菜单管理 Hook
 * 切换只发 switchModel 命令（ChatSession 自动补 sessionId），后端改本会话并写全局默认，其他已打开会话不动；
 * 显示值等后端按 core 会话级 model:update 推回的 updateModelInfo，切换失败时显示自然保持不变。
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
        if (model === modelName) {
            // 点击当前模型，不做任何操作
            setShowModelMenu(false);
            return;
        }

        // 只发命令：后端改本会话并写全局默认，显示由后端事件回推
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
        currentModel: modelName,
        setShowModelMenu,
        handleToggleModelMenu,
        handleModelSwitch,
        handleOpenConfig
    };
};