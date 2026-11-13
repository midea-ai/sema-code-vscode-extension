import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useT } from '../../common/i18n/react';
import { OpenIcon } from '../../config/utils/svgIcons';

interface ImagePreviewModalProps {
    src: string;          // 放大显示的图片源（objectURL 或 data:base64）
    onClose: () => void;
    /** 传入时右上角显示「像素尺寸 + 跳转按钮」：在宿主编辑器中打开该图片文件（仅本地有文件路径的图片可用） */
    onOpenFile?: () => void;
}

// 点击缩略图后的放大遮罩。仿 TaskDetailModal：portal 到 body，点背景/Esc 关闭。
const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ src, onClose, onOpenFile }) => {
    const t = useT();
    // 图片原始像素尺寸，加载完成后才有
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);

    // 点任意位置（含图片本身）都关闭——跳转按钮自行拦截冒泡
    const handleBackdropClick = useCallback(() => {
        onClose();
    }, [onClose]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return ReactDOM.createPortal(
        <div className="image-preview-overlay" onClick={handleBackdropClick}>
            <img
                className="image-preview-img"
                src={src}
                alt=""
                onLoad={e => {
                    const { naturalWidth, naturalHeight } = e.currentTarget;
                    if (naturalWidth && naturalHeight) setSize({ width: naturalWidth, height: naturalHeight });
                }}
            />
            {onOpenFile && (
                <div className="image-preview-toolbar">
                    {size && <span className="image-preview-size">{size.width} × {size.height}</span>}
                    <button
                        type="button"
                        className="image-preview-open"
                        title={t('common.open')}
                        aria-label={t('common.open')}
                        onClick={e => {
                            e.stopPropagation();
                            onOpenFile();
                            onClose();
                        }}
                    >
                        <OpenIcon size={13} />
                    </button>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ImagePreviewModal;
