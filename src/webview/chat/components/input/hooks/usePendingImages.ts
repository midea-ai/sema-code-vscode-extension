import { useState, useRef, useCallback, useEffect } from 'react';
import { ImageAttachment } from '../../../types';

// 输入框待发送图片的本地状态：除 core 需要的 data/media_type 外，多存 UI 展示字段
export interface PendingImage {
    id: string;                                  // 本地唯一 id，删除/打开用
    data: string;                                // 纯 base64（无 data:...;base64, 前缀）
    media_type: ImageAttachment['media_type'];
    name: string;                                // 'image.png'
    width: number;
    height: number;
    previewUrl: string;                          // URL.createObjectURL(blob)，缩略图/放大用
}

// core 只接受这几类，前端粘贴时即过滤（体验优于 core 静默丢弃）
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGES = 10;

// FileReader 读 dataURL 后切掉 data:...;base64, 前缀，得纯 base64
const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

// 用 objectURL 加载一次拿原始像素尺寸（失败回退 0）
const readDimensions = (url: string): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = url;
    });

export function usePendingImages() {
    const [images, setImages] = useState<PendingImage[]>([]);
    // toAttachments/clear 在事件回调里调用，用 ref 取最新值，避免闭包过期
    const imagesRef = useRef<PendingImage[]>([]);
    imagesRef.current = images;
    const idCounter = useRef(0);

    const addFiles = useCallback(async (files: File[] | FileList) => {
        const list = Array.from(files).filter(f => ACCEPTED_TYPES.has(f.type));
        if (list.length === 0) return;
        const remaining = MAX_IMAGES - imagesRef.current.length;
        if (remaining <= 0) return;
        const toAdd = list.slice(0, remaining);

        for (const file of toAdd) {
            const previewUrl = URL.createObjectURL(file);
            try {
                const [data, dim] = await Promise.all([
                    readAsBase64(file),
                    readDimensions(previewUrl)
                ]);
                const item: PendingImage = {
                    id: `img-${Date.now()}-${idCounter.current++}`,
                    data,
                    media_type: file.type as ImageAttachment['media_type'],
                    name: file.name || 'image.png',
                    width: dim.width,
                    height: dim.height,
                    previewUrl
                };
                // 并发 addFiles 可能让 slice 估算过期，入队时再兜底一次上限
                setImages(prev => {
                    if (prev.length >= MAX_IMAGES) {
                        URL.revokeObjectURL(previewUrl);
                        return prev;
                    }
                    return [...prev, item];
                });
            } catch {
                URL.revokeObjectURL(previewUrl);
            }
        }
    }, []);

    const remove = useCallback((id: string) => {
        setImages(prev => {
            const target = prev.find(i => i.id === id);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return prev.filter(i => i.id !== id);
        });
    }, []);

    const clear = useCallback(() => {
        imagesRef.current.forEach(i => URL.revokeObjectURL(i.previewUrl));
        setImages([]);
    }, []);

    // 从已有 attachments 恢复（如 fork 回填）：core 形状只有 data/media_type，
    // previewUrl 直接用 data URI（无 objectURL 可 revoke），尺寸异步现算、文件名缺省
    const setFromAttachments = useCallback((attachments: ImageAttachment[]) => {
        imagesRef.current.forEach(i => URL.revokeObjectURL(i.previewUrl));
        if (!attachments || attachments.length === 0) {
            setImages([]);
            return;
        }
        const items: PendingImage[] = attachments.slice(0, MAX_IMAGES).map(a => ({
            id: `img-${Date.now()}-${idCounter.current++}`,
            data: a.data,
            media_type: a.media_type,
            name: '',
            width: 0,
            height: 0,
            previewUrl: `data:${a.media_type};base64,${a.data}`
        }));
        setImages(items);
        // 异步补尺寸
        items.forEach(it => {
            const img = new Image();
            img.onload = () => setImages(prev => prev.map(p =>
                p.id === it.id ? { ...p, width: img.naturalWidth, height: img.naturalHeight } : p));
            img.src = it.previewUrl;
        });
    }, []);

    const toAttachments = useCallback((): ImageAttachment[] =>
        imagesRef.current.map(i => ({ type: 'image', data: i.data, media_type: i.media_type })), []);

    // 组件卸载时 revoke 全部，避免 objectURL 泄漏
    useEffect(() => () => {
        imagesRef.current.forEach(i => URL.revokeObjectURL(i.previewUrl));
    }, []);

    return { images, addFiles, remove, clear, toAttachments, setFromAttachments };
}
