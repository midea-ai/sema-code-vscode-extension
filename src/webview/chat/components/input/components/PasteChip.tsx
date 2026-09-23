import React from 'react';
import { RemoveIcon } from '../../ui/IconButton';
import { useT } from '../../../../common/i18n/react';

interface PasteChipProps {
    preview: string;
    onDelete: () => void;
    onShowInInput: () => void;
}

// 输入框附件条里的超长粘贴芯片：与图片缩略图同高同边框，[文本图标] 单行截断预览 ·「在文本框中显示」，hover 出叉号
const PasteChip: React.FC<PasteChipProps> = ({ preview, onDelete, onShowInInput }) => {
    const t = useT();
    return (
        <div className="image-chip paste-chip deletable" title={preview}>
            <span className="paste-chip-icon">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 1.5h5.5L13 5v9.5H4z" />
                    <path d="M9.5 1.5V5H13" />
                    <path d="M6 8h5M6 10.5h5" />
                </svg>
            </span>
            <span className="image-chip-name">
                <span className="image-chip-name-text paste-chip-preview">{preview}</span>
            </span>
            <button
                type="button"
                className="paste-chip-show"
                onClick={e => { e.stopPropagation(); onShowInInput(); }}
                title={t('chat.input.pasteShowInInput')}
            >
                {t('chat.input.pasteShowInInput')}
            </button>
            <button
                type="button"
                className="image-chip-remove"
                onClick={e => { e.stopPropagation(); onDelete(); }}
                title={t('common.delete')}
            >
                <RemoveIcon />
            </button>
        </div>
    );
};

export default PasteChip;
