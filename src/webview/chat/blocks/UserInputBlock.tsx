import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CopyIcon, CheckIcon, ForkIcon } from '../components/ui/IconButton';
import { ImageAttachment } from '../types';
import ImageThumbnail from '../components/ImageThumbnail';
import ImagePreviewModal from '../components/ImagePreviewModal';

interface UserInputBlockProps {
    content: string;
    attachments?: ImageAttachment[];    // 用户发送时携带的图片（core 回吐）
    uuid?: string;                      // 有值才可 fork（旧历史消息无锚点）
    canFork?: boolean;                  // = 会话处于 idle
    onFork?: (uuid: string) => void;
}

// 气泡里的单张图片：core 回吐只有 {data,media_type}，尺寸用 new Image() 现算、文件名缺省
const BubbleImage: React.FC<{ attachment: ImageAttachment; onOpen: (src: string) => void }> = ({ attachment, onOpen }) => {
    const src = `data:${attachment.media_type};base64,${attachment.data}`;
    const [dim, setDim] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    useEffect(() => {
        const img = new Image();
        img.onload = () => setDim({ width: img.naturalWidth, height: img.naturalHeight });
        img.src = src;
    }, [src]);
    return (
        <ImageThumbnail
            src={src}
            mediaType={attachment.media_type}
            width={dim.width}
            height={dim.height}
            onOpen={onOpen}
        />
    );
};

// 折叠态最大高度（px），需与 styles.css 中 .user-input-content.collapsed 的 max-height 同步
// 当前为 line-height 1.5 * 字号 12px * 3 行 = 54px
const COLLAPSED_MAX_PX = 54;

const UserInputBlock: React.FC<UserInputBlockProps> = React.memo(({ content, attachments, uuid, canFork, onFork }) => {

    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
    const [copied, setCopied] = useState<boolean>(false);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const copyTimerRef = useRef<number | null>(null);

    // 测量内容是否超过折叠高度（scrollHeight 不受 max-height/overflow 影响，展开/折叠两态一致）
    useLayoutEffect(() => {
        const el = contentRef.current;
        if (!el) {
            return;
        }
        const measure = () => {
            setIsOverflowing(el.scrollHeight > COLLAPSED_MAX_PX + 1);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [content]);

    useEffect(() => () => {
        if (copyTimerRef.current) {
            window.clearTimeout(copyTimerRef.current);
        }
    }, []);

    const handleToggle = () => {
        setIsExpanded(prev => !prev);
    };

    const handleCopy = () => {
        if (!content) {
            return;
        }
        navigator.clipboard.writeText(content).then(() => {
            setCopied(true);
            if (copyTimerRef.current) {
                window.clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = window.setTimeout(() => setCopied(false), 1000);
        }).catch(() => { /* ignore */ });
    };

    return (
        <div className="user-input-block">
            {attachments && attachments.length > 0 && (
                <div className="user-input-images">
                    {attachments.map((att, i) => (
                        <BubbleImage key={i} attachment={att} onOpen={setPreviewSrc} />
                    ))}
                </div>
            )}
            <div
                ref={contentRef}
                className={`user-input-content${isOverflowing && !isExpanded ? ' collapsed' : ''}`}
            >
                {content}
            </div>
            {isOverflowing && (
                <button type="button" className="user-input-toggle" onClick={handleToggle}>
                    {isExpanded ? '收起' : '展开'}
                </button>
            )}
            <button
                type="button"
                className="user-input-copy"
                title={copied ? '已复制' : '复制'}
                onClick={handleCopy}
            >
                {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            {uuid && (
                <button
                    type="button"
                    className="user-input-fork"
                    title={canFork ? '从此处 Fork / 撤销' : '生成中，暂不可 Fork'}
                    disabled={!canFork}
                    onClick={() => canFork && onFork?.(uuid)}
                >
                    <ForkIcon />
                </button>
            )}
            {previewSrc && (
                <ImagePreviewModal src={previewSrc} onClose={() => setPreviewSrc(null)} />
            )}
        </div>
    );
});

UserInputBlock.displayName = 'UserInputBlock';

export default UserInputBlock;
