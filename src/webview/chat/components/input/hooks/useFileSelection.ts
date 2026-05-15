import { useState, useEffect, useRef, RefObject } from 'react';
import { VscodeApi, FileItem, SelectedFile } from '../../../types';

export interface UseFileSelectionReturn {
    selectedFiles: SelectedFile[];
    showFilePicker: boolean;
    availableFiles: FileItem[];
    setSelectedFiles: (files: SelectedFile[]) => void;
    setShowFilePicker: (show: boolean) => void;
    requestWorkspaceFiles: () => void;
    searchWorkspaceFiles: (query: string) => void;
    handleFileClick: (filePath: string, startLine?: number) => void;
}

/**
 * 文件选择管理 Hook
 * 仅维护 selectedFiles（保留供高亮/跳转使用）、FilePicker 显隐与工作区文件列表
 */
export const useFileSelection = (
    vscode: VscodeApi,
    filePickerRef: RefObject<HTMLDivElement>,
    addFileButtonRef: RefObject<HTMLButtonElement>,
    inputBoxRef: RefObject<HTMLElement>
): UseFileSelectionReturn => {
    const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
    const [showFilePicker, setShowFilePicker] = useState<boolean>(false);
    const [availableFiles, setAvailableFiles] = useState<FileItem[]>([]);
    // 请求计数器，用于丢弃过期的 workspaceFiles 响应（避免输入抖动导致结果错位）
    const reqIdRef = useRef<number>(0);

    // 监听来自扩展的文件列表消息
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'workspaceFiles') {
                if (typeof message.reqId === 'number' && message.reqId !== reqIdRef.current) {
                    return;
                }
                // 排序统一在 InputBox.filteredAvailableFiles 处理：
                // 有搜索词时按后端相关度顺序展示，无搜索词时再按"已打开优先 / 隐藏靠后"分组
                setAvailableFiles(message.files);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    // 点击外部关闭文件选择器（输入框内点击不视为外部）
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const isOutsidePicker = filePickerRef.current && !filePickerRef.current.contains(target);
            const isOutsideButton = addFileButtonRef.current && !addFileButtonRef.current.contains(target);
            const isOutsideInput = inputBoxRef.current && !inputBoxRef.current.contains(target);

            if (isOutsidePicker && isOutsideButton && isOutsideInput) {
                setShowFilePicker(false);
            }
        };

        if (showFilePicker) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showFilePicker, filePickerRef, addFileButtonRef, inputBoxRef]);

    const requestWorkspaceFiles = () => {
        const reqId = ++reqIdRef.current;
        vscode.postMessage({
            type: 'requestWorkspaceFiles',
            reqId
        });
    };

    const searchWorkspaceFiles = (query: string) => {
        const reqId = ++reqIdRef.current;
        vscode.postMessage({
            type: 'searchWorkspaceFiles',
            query,
            reqId
        });
    };

    const handleFileClick = (filePath: string, startLine?: number) => {
        vscode.postMessage({
            type: 'openFile',
            filePath: filePath,
            line: startLine || 1
        });
    };

    return {
        selectedFiles,
        showFilePicker,
        availableFiles,
        setSelectedFiles,
        setShowFilePicker,
        requestWorkspaceFiles,
        searchWorkspaceFiles,
        handleFileClick
    };
};
