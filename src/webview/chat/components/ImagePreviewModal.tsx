import React, { useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface ImagePreviewModalProps {
    src: string;          // 放大显示的图片源（objectURL 或 data:base64）
    onClose: () => void;
}

// 点击缩略图后的放大遮罩。仿 TaskDetailModal：portal 到 body，点背景/Esc 关闭。
const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ src, onClose }) => {
    // 点任意位置（含图片本身）都关闭——遮罩内无其它交互元素
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
            <img className="image-preview-img" src={src} alt="" />
        </div>,
        document.body
    );
};

export default ImagePreviewModal;
