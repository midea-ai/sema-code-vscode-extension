import React, { useEffect, useMemo, useState } from 'react';
import { ImageIcon } from '../../components/ui/IconButton';
import ImagePreviewModal from '../../components/ImagePreviewModal';
import { GeneratedImageItem, GeneratedImagesContent, ToolContent, VscodeApi } from '../../types';
import ToolRowHeader from './ToolRowHeader';
import { useT } from '../../../common/i18n/react';
import { hasTextSelection } from '../../utils/selection';

interface GeneratedImageBlockProps {
    /** 一行里合并的若干次 generate_image 调用（相邻调用由 groupMessages 合并），单条时传 [content] */
    contents: ToolContent[];
    vscode?: VscodeApi;
}

const isGeneratedImagesContent = (value: unknown): value is GeneratedImagesContent => {
    return !!value && typeof value === 'object' && Array.isArray((value as GeneratedImagesContent).images);
};

// 1×1 透明 GIF，解析出真实 data URI 前占位（与 markdown 本地图片同一做法）
const PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

/**
 * 单张生成图缩略图：webview 不能直接加载本地路径，
 * 发 resolveImagePath 让宿主（VSCode / JB 的 EditorOps）读成 data URI 后回填；失败时回退显示路径文字。
 */
const GeneratedThumb: React.FC<{ image: GeneratedImageItem; vscode?: VscodeApi; onOpen: (src: string) => void }> = ({ image, vscode, onOpen }) => {
    const [src, setSrc] = useState<string | null>(null);
    const [missing, setMissing] = useState(false);
    const fileName = image.filePath.split(/[\\/]/).pop() || image.filePath;

    useEffect(() => {
        if (!vscode) {
            setSrc(image.filePath);
            return;
        }
        const randomStr = Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36)).join('').slice(0, 9);
        const tempId = `gen-img-${Date.now()}-${randomStr}`;

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message?.type !== 'imagePathResolved' || message.tempId !== tempId) {
                return;
            }
            if (message.exists && message.src) {
                setSrc(message.src);
            } else {
                setMissing(true);
            }
        };
        window.addEventListener('message', handleMessage);
        vscode.postMessage({ type: 'resolveImagePath', filePath: image.filePath, tempId });
        return () => window.removeEventListener('message', handleMessage);
    }, [image.filePath, vscode]);

    if (missing) {
        return <div className="generated-image-missing" title={image.filePath}>{image.filePath}</div>;
    }

    return (
        <img
            className="generated-image-thumb"
            src={src || PLACEHOLDER_SRC}
            alt={fileName}
            title={fileName}
            onClick={() => {
                if (hasTextSelection() || !src) return;
                onOpen(src);
            }}
        />
    );
};

/**
 * 生成图片工具块（对齐 core webui 的 GenImageCard）：相邻的多次调用合并成一行，
 * 行内只放状态与张数，不带提示词或文件名（生成中拿不到文件名，附件目录里的图又都叫 image.png）；
 * 展开状态：用户未手动操作时跟随「是否生成中」，生成中默认展开（看得到占位），全部完成后自动折叠；
 * 手动点过行头后钉住用户设的状态。展开体：已完成的调用显示方形小缩略图（无任何文本，点击放大），
 * 生成中的调用（tool:execution:chunk 起即进入）每个显示一个同尺寸脉动占位。
 */
const GeneratedImageBlock: React.FC<GeneratedImageBlockProps> = React.memo(({ contents, vscode }) => {
    const t = useT();
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

    const pendingCount = contents.filter(c => c.completed === false).length;
    const running = pendingCount > 0;
    const isExpanded = manualExpanded ?? running;

    const images = useMemo<GeneratedImageItem[]>(() => {
        const seen = new Set<string>();
        const out: GeneratedImageItem[] = [];
        for (const c of contents) {
            if (c.completed === false || !isGeneratedImagesContent(c.content)) continue;
            for (const img of c.content.images) {
                if (!img || typeof img.filePath !== 'string' || !img.filePath || seen.has(img.filePath)) continue;
                seen.add(img.filePath);
                out.push(img);
            }
        }
        return out;
    }, [contents]);

    const verb = running
        ? t('tool.imageGenerating')
        : images.length > 1 ? t('tool.imageGeneratedN', { n: images.length }) : t('tool.imageGenerated');
    const expandable = running || images.length > 0;

    return (
        <div className="chat-block chat-block--borderless generated-image-block">
            <ToolRowHeader
                icon={<ImageIcon />}
                streaming={running}
                verb={verb}
                expandable={expandable}
                isExpanded={isExpanded}
                onClick={() => { if (expandable) setManualExpanded(!isExpanded); }}
            />
            {expandable && isExpanded && (
                <div className="generated-image-list">
                    {images.map(img => (
                        <GeneratedThumb key={img.filePath} image={img} vscode={vscode} onOpen={setPreviewSrc} />
                    ))}
                    {Array.from({ length: pendingCount }, (_, i) => (
                        <div key={`pending-${i}`} className="generated-image-pending" />
                    ))}
                </div>
            )}
            {previewSrc && (
                <ImagePreviewModal src={previewSrc} onClose={() => setPreviewSrc(null)} />
            )}
        </div>
    );
});

GeneratedImageBlock.displayName = 'GeneratedImageBlock';

export default GeneratedImageBlock;
