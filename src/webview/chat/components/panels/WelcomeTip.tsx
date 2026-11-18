// WelcomeTip.tsx —— 欢迎页顶部的跑马灯，内容定义见 ../../welcomeTip.ts
import React, { useRef, useState, useSyncExternalStore } from 'react';
import { useLang, useT } from '../../../common/i18n/react';
import { VscodeApi } from '../../types';
import { WELCOME_TIP } from '../../welcomeTip';

// 显隐状态放模块级：同一 webview 内的多个会话标签共用。
// dismissedId = 最后一次点「不再显示」的内容 id，由宿主随 systemConfigUpdate 下发；
//               下发前（undefined）不显示，避免已关闭的用户首屏闪一下
// closed = 叉号临时关闭，只在本 webview 存活期间有效
let dismissedId: string | undefined;
let closed = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const isVisible = () => !!WELCOME_TIP && dismissedId !== undefined && dismissedId !== WELCOME_TIP.id && !closed;
const notify = () => listeners.forEach(fn => fn());

export function setWelcomeTipDismissedId(id: string): void {
    if (dismissedId === id) return;
    dismissedId = id;
    notify();
}

/** 悬停滚动速度（px/s） */
const SCROLL_SPEED = 40;

// 命令：点击复制，约 1 秒内原位显示「已复制」（原文字隐藏但仍占位，宽度不变）
const TipCommand: React.FC<{ text: string }> = ({ text }) => {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1000);
        });
    };
    return (
        <span className={`welcome-tip-cmd${copied ? ' is-copied' : ''}`} title={t('common.copy')} onClick={copy}>
            <span className="welcome-tip-cmd-text">{text}</span>
            {copied && <span className="welcome-tip-cmd-copied">{t('common.copied')}</span>}
        </span>
    );
};

// 行内 markdown：`命令` 与 [文字](链接)，其余原样输出
const INLINE_MD = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function renderInline(text: string, openLink: (url: string) => void): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    INLINE_MD.lastIndex = 0;
    while ((match = INLINE_MD.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        if (match[1] !== undefined) {
            nodes.push(<TipCommand key={match.index} text={match[1]} />);
        } else {
            const url = match[3];
            // 不写 href：VS Code webview 会自行打开带真实 href 的 <a>（不看 preventDefault），与 openLink 叠加成两个标签
            nodes.push(
                <a key={match.index} className="welcome-tip-link" title={url} onClick={() => openLink(url)}>
                    {match[2]}
                </a>
            );
        }
        last = match.index + match[0].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

const WelcomeTip: React.FC<{ vscode: VscodeApi }> = ({ vscode }) => {
    const t = useT();
    const lang = useLang();
    const visible = useSyncExternalStore(subscribe, isVisible, isVisible);
    const viewportRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    if (!WELCOME_TIP || !visible) return null;

    const { id, content } = WELCOME_TIP;
    const dismiss = () => {
        setWelcomeTipDismissedId(id);
        vscode.postMessage({ type: 'dismissWelcomeTip', id });
    };
    const close = () => {
        closed = true;
        notify();
    };

    // 悬停时按实际溢出量算位移与时长，交给 CSS 变量：宽窄窗口滚动速度一致
    const onEnter = (e: React.MouseEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        const track = trackRef.current;
        if (!viewport || !track) return;
        const overflow = Math.max(0, track.scrollWidth - viewport.clientWidth);
        e.currentTarget.style.setProperty('--welcome-tip-shift', `${-overflow}px`);
        e.currentTarget.style.setProperty('--welcome-tip-duration', `${overflow / SCROLL_SPEED}s`);
    };

    return (
        <div className="welcome-tip" onMouseEnter={onEnter}>
            <div className="welcome-tip-viewport" ref={viewportRef}>
                <div className="welcome-tip-track" ref={trackRef}>
                    {renderInline(content[lang] || content.en, (url) => vscode.postMessage({ type: 'openExternal', url }))}
                </div>
            </div>
            <button type="button" className="welcome-tip-dismiss" onClick={dismiss}>{t('chat.welcomeTip.dismiss')}</button>
            <button type="button" className="welcome-tip-close" title={t('common.close')} onClick={close}>×</button>
        </div>
    );
};

export default WelcomeTip;
