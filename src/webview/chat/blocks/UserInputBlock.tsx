import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CopyIcon, CheckIcon, ForkIcon } from '../components/ui/IconButton';

interface UserInputBlockProps {
    content: string;
    uuid?: string;                      // 有值才可 fork（旧历史消息无锚点）
    canFork?: boolean;                  // = 会话处于 idle
    onFork?: (uuid: string) => void;
}

// 折叠态最大高度（px），需与 styles.css 中 .user-input-content.collapsed 的 max-height 同步
// 当前为 line-height 1.5 * 字号 12px * 3 行 = 54px
const COLLAPSED_MAX_PX = 54;

const UserInputBlock: React.FC<UserInputBlockProps> = React.memo(({ content, uuid, canFork, onFork }) => {

    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
    const [copied, setCopied] = useState<boolean>(false);
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
        </div>
    );
});

UserInputBlock.displayName = 'UserInputBlock';

export default UserInputBlock;
