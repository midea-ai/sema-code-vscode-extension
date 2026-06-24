import React from 'react';
import { RemoveIcon } from './ui/IconButton';
import { ImageAttachment } from '../types';

interface ImageThumbnailProps {
    src: string;                              // 输入框用 objectURL，气泡用 data:base64
    mediaType: ImageAttachment['media_type'];
    name?: string;                            // 来源文件名（拖拽/选择有；剪贴板/气泡无）
    width: number;
    height: number;
    onOpen: (src: string) => void;            // 点击放大
    deletable?: boolean;                      // 输入框态 true（hover 出叉号）；气泡态 false
    onDelete?: () => void;
}

// 无来源文件名时的默认名：image.<ext>
const EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

// 输入框缩略图条 与 气泡顶部缩略图行 共用。横向卡片：[小缩略图] 文件名 243×281
const ImageThumbnail: React.FC<ImageThumbnailProps> = ({
    src, mediaType, name, width, height, onOpen, deletable, onDelete
}) => {
    const displayName = name && name.trim() ? name : `image.${EXT[mediaType] || 'png'}`;
    const sizeText = width && height ? `${width}×${height}` : '';
    return (
        <div className={`image-chip${deletable ? ' deletable' : ''}`} onClick={() => onOpen(src)}>
            <img
                className="image-chip-thumb"
                src={src}
                alt={displayName}
            />
            <span className="image-chip-name" title={displayName}>{displayName}</span>
            {sizeText && <span className="image-chip-size">{sizeText}</span>}
            {deletable && (
                <button
                    type="button"
                    className="image-chip-remove"
                    title="移除"
                    onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
                >
                    <RemoveIcon />
                </button>
            )}
        </div>
    );
};

export default ImageThumbnail;
