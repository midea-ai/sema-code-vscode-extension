import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CopyIcon, CheckIcon, ForkIcon, ClockIcon } from '../components/ui/IconButton';
import { GoalInputMark, ImageAttachment, InputSource, VscodeApi } from '../types';
import { PasteAttachment } from '../../common/paste';
import ImageThumbnail from '../components/ImageThumbnail';
import ImagePreviewModal from '../components/ImagePreviewModal';
import { FileRefChip, refPaths, refStatPath, splitFileRefs } from '../utils/fileRefDisplay';
import { usePathExists } from '../utils/usePathExists';
import { SkillLabel, matchSkillPrefix } from '../utils/skillDisplay';
import { TargetIcon } from '../components/panels/GoalBar';
import { useT, I18nKey } from '../../common/i18n/react';

interface UserInputBlockProps {
    content: string;
    attachments?: ImageAttachment[];    // 用户发送时携带的图片（core 回吐）
    pastes?: PasteAttachment[];         // 超长粘贴转存的附件文件（从 input 模板解析）
    source?: InputSource;               // 输入来源；非 user 时气泡上方渲染来源标签
    goal?: GoalInputMark;               // 长期目标标记：设定 / 更新加标签；自动续轮（round）不渲染气泡只留标签行
    uuid?: string;                      // 有值才可 fork（旧历史消息无锚点）
    canFork?: boolean;                  // = 会话处于 idle
    onFork?: (uuid: string) => void;
    /** 排队中（core 处理上一条时收到的输入）：虚线淡化样式，无复制/fork 按钮 */
    pending?: boolean;
    vscode?: VscodeApi;
}

// 非 user 来源的标签文案 key；未登记的来源不渲染
const SOURCE_LABEL_KEY: Partial<Record<InputSource, I18nKey>> = {
    cron: 'chat.source.cron',
};

/** 长期目标标记文案：设定 / 更新 / 第 n/m 轮 */
const goalMarkLabel = (t: ReturnType<typeof useT>, mark: GoalInputMark): string => {
    if (mark.action === 'set') return t('chat.source.goalSet');
    if (mark.action === 'update') return t('chat.source.goalUpdate');
    return t('chat.source.goalRound', { n: mark.round, max: mark.maxRounds });
};

// 气泡上方右对齐的来源小标签（pending 气泡和正式气泡共用）；目标标记优先于来源标签（续轮输入 source=goal 只显示目标标签）
export const UserInputSourceTag: React.FC<{ source?: InputSource; goal?: GoalInputMark }> = ({ source, goal }) => {
    const t = useT();
    if (goal) {
        return (
            <div className="user-input-source">
                <TargetIcon size={12} />
                <span>{goalMarkLabel(t, goal)}</span>
            </div>
        );
    }
    const labelKey = source ? SOURCE_LABEL_KEY[source] : undefined;
    const label = labelKey ? t(labelKey) : undefined;
    if (!label) {
        return null;
    }
    return (
        <div className="user-input-source">
            <ClockIcon />
            <span>{label}</span>
        </div>
    );
};

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

// 气泡里的粘贴芯片：与输入框附件条的 PasteChip 同款（image-chip paste-chip，和图片缩略图同高同边框），
// 只是没有「在文本框中显示」与叉号；在图片行下方单独一行，点击在编辑器打开转存文件
const PastePill: React.FC<{ preview: string; onOpen: () => void }> = ({ preview, onOpen }) => (
    <div className="image-chip paste-chip" title={preview} onClick={onOpen}>
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
    </div>
);

// 折叠态最大高度（px），需与 styles.css 中 .user-input-content.collapsed 的 max-height 同步
// 当前为 line-height 1.5 * 字号 12px * 3 行 = 54px
const COLLAPSED_MAX_PX = 54;

const UserInputBlock: React.FC<UserInputBlockProps> = React.memo(({ content, attachments, pastes, source, goal, uuid, canFork, onFork, pending, vscode }) => {
    const t = useT();

    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
    const [copied, setCopied] = useState<boolean>(false);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const copyTimerRef = useRef<number | null>(null);

    // @ 文件引用经宿主确认存在后显示为「文件图标 + 文件名」芯片（与输入框一致），点击打开；不存在的保持原文。
    // 复制/fork 仍用 content 原文
    const text = typeof content === 'string' ? content : '';
    // 以映射技能开头的消息：`/<技能名>` 显示为图标 + 名字（排队中的气泡同样处理），复制仍是原文
    const skill = matchSkillPrefix(text);
    const bodyText = skill ? skill.rest : text;
    const refKeys = useMemo(() => refPaths(bodyText), [bodyText]);
    const stat = usePathExists(vscode, refKeys);
    const body = useMemo(() => splitFileRefs(bodyText).map((s, i) => {
        if (s.type === 'text') return s.text;
        const st = stat(refStatPath(s.path));
        if (!st?.exists) return s.raw;
        const seg = { ...s, isDirectory: st.isDirectory };
        return (
            <FileRefChip
                key={i}
                seg={seg}
                onOpen={vscode ? sg => vscode.postMessage({ type: 'openFile', filePath: sg.path, line: sg.line || 1, endLine: sg.endLine }) : undefined}
            />
        );
    }), [bodyText, stat, vscode]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (!text) {
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            if (copyTimerRef.current) {
                window.clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = window.setTimeout(() => setCopied(false), 1000);
        }).catch(() => { /* ignore */ });
    };

    const openPaste = (p: PasteAttachment) => vscode?.postMessage({ type: 'openFile', filePath: p.path, line: 1 });

    // 纯附件输入（无文字）不渲染正文容器，避免出现空块；排队中仍渲染以保留虚线占位
    const showText = !!text || !!pending;

    const bubble = (
        <div className={`user-input-block${pending ? ' pending' : ''}`}>
            {attachments && attachments.length > 0 && (
                <div className="user-input-images">
                    {attachments.map((att, i) => (
                        <BubbleImage key={i} attachment={att} onOpen={setPreviewSrc} />
                    ))}
                </div>
            )}
            {pastes && pastes.length > 0 && (
                <div className="user-input-pastes">
                    {pastes.map(p => <PastePill key={p.path} preview={p.preview} onOpen={() => openPaste(p)} />)}
                </div>
            )}
            {showText && (
                <div
                    ref={contentRef}
                    className={`user-input-content${pending ? ' pending' : ''}${isOverflowing && !isExpanded ? ' collapsed' : ''}`}
                >
                    {skill && <SkillLabel display={skill.display} className="user-input-skill" />}{body}
                </div>
            )}
            {!pending && isOverflowing && (
                <button type="button" className="user-input-toggle" onClick={handleToggle}>
                    {isExpanded ? t('common.collapse') : t('common.expand')}
                </button>
            )}
            {!pending && (
                <button
                    type="button"
                    className="user-input-copy"
                    title={copied ? t('common.copied') : t('common.copy')}
                    onClick={handleCopy}
                >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
            )}
            {!pending && uuid && (
                <button
                    type="button"
                    className="user-input-fork"
                    title={canFork ? t('chat.forkFromHere') : t('chat.forkUnavailable')}
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

    // 目标自动续轮：文本是固定触发语，不渲染气泡本体，只留「目标第 n/m 轮」标签行（排队中同样处理）
    if (source === 'goal' && goal?.action === 'round') {
        return (
            <div className="user-input-wrap user-input-goal-round">
                <UserInputSourceTag source={source} goal={goal} />
            </div>
        );
    }

    // 无来源标签时不额外包裹，保持原 DOM 结构
    if (!goal && (!source || !SOURCE_LABEL_KEY[source])) {
        return bubble;
    }
    return (
        <div className="user-input-wrap">
            <UserInputSourceTag source={source} goal={goal} />
            {bubble}
        </div>
    );
});

UserInputBlock.displayName = 'UserInputBlock';

export default UserInputBlock;
