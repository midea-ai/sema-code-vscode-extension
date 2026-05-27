import React, { useLayoutEffect, useRef, useState } from 'react';

interface BaseBashContentProps {
    command: string;
    className?: string;
    style?: React.CSSProperties;
    onOpenFull?: () => void;   // 命令过长时点击打开完整命令
    maxHeightPx?: number;      // 溢出阈值，默认 80（需与 tools.css 中 .bash-command max-height 同步）
}

const DEFAULT_MAX_PX = 50;

const BaseBashContent: React.FC<BaseBashContentProps> = ({
    command,
    className = "bash-command",
    style,
    onOpenFull,
    maxHeightPx = DEFAULT_MAX_PX
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [overflowing, setOverflowing] = useState(false);

    // 测量内容是否超过折叠高度（同 UserInputBlock：scrollHeight 不受 overflow:hidden 影响）
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const measure = () => setOverflowing(el.scrollHeight > maxHeightPx + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [command, maxHeightPx]);

    const clickable = overflowing && !!onOpenFull;

    return (
        <div
            ref={ref}
            className={`${className}${overflowing ? ' overflowing' : ''}${clickable ? ' clickable' : ''}`}
            style={style}
            onClick={clickable ? onOpenFull : undefined}
            title={clickable ? '点击查看完整命令' : undefined}
        >
            <pre><code className="language-bash">{command}</code></pre>
        </div>
    );
};

export default BaseBashContent;
