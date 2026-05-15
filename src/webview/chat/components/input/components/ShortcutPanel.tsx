import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { ShortcutCommand } from '../../../../../utils/command';
import { filterShortcutCommands } from '../utils/commandUtils';
import Tooltip from '../../ui/Tooltip';

// 描述文本：当被 ellipsis 截断时，悬浮显示完整内容
const ShortcutDesc: React.FC<{ desc: string }> = ({ desc }) => {
    const [isTruncated, setIsTruncated] = useState(false);
    const observerRef = useRef<ResizeObserver | null>(null);

    const setRef = useCallback((node: HTMLSpanElement | null) => {
        if (observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
        }
        if (!node) {
            return;
        }
        const check = () => setIsTruncated(node.scrollWidth > node.clientWidth + 1);
        check();
        const ro = new ResizeObserver(check);
        ro.observe(node);
        observerRef.current = ro;
    }, []);

    useEffect(() => () => {
        observerRef.current?.disconnect();
    }, []);

    return (
        <Tooltip content={isTruncated ? desc : ''} className="shortcut-desc-tooltip">
            <span ref={setRef} className="shortcut-desc">{desc}</span>
        </Tooltip>
    );
};

interface ShortcutPanelProps {
    show: boolean;
    commands: ShortcutCommand[];
    searchQuery?: string;
    selectedIndex?: number;
    onExecuteShortcut: (text: string, send: boolean) => void;
    shortcutPanelRef: React.RefObject<HTMLDivElement>;
}

const ShortcutPanel: React.FC<ShortcutPanelProps> = ({
    show,
    commands,
    searchQuery = '',
    selectedIndex = 0,
    onExecuteShortcut,
    shortcutPanelRef
}) => {
    const selectedItemRef = useRef<HTMLDivElement>(null);

    const filteredCommands = useMemo(
        () => filterShortcutCommands(commands, searchQuery),
        [commands, searchQuery]
    );

    // 确保 selectedIndex 在有效范围内
    const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, filteredCommands.length - 1));

    // 当选中项改变时，滚动到可见区域
    useEffect(() => {
        if (selectedItemRef.current) {
            selectedItemRef.current.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth'
            });
        }
    }, [safeSelectedIndex]);

    if (!show) return null;

    // 如果没有匹配的命令，不显示面板
    if (filteredCommands.length === 0) return null;

    // 按 category 拆分，但保留在 filteredCommands 中的原始下标，
    // 这样面板里的高亮 flatIndex 与 InputBox 键盘导航用的索引保持一致。
    type Indexed = { item: ShortcutCommand; flatIndex: number };
    const commandItems: Indexed[] = [];
    const skillItems: Indexed[] = [];
    filteredCommands.forEach((item, idx) => {
        const entry = { item, flatIndex: idx };
        if (item.category === 'skill') {
            skillItems.push(entry);
        } else {
            commandItems.push(entry);
        }
    });

    const renderItem = ({ item, flatIndex }: Indexed) => (
        <div
            key={flatIndex}
            ref={flatIndex === safeSelectedIndex ? selectedItemRef : null}
            className={`shortcut-panel-item ${flatIndex === safeSelectedIndex ? 'selected' : ''}`}
            onClick={() => onExecuteShortcut(item.text, item.send ?? false)}
        >
            <span className="shortcut-slash">/</span>
            <span className="shortcut-command">{item.text}</span>
            <ShortcutDesc desc={item.desc} />
        </div>
    );

    const showDivider = commandItems.length > 0 && skillItems.length > 0;

    return (
        <div className="shortcut-panel-popup" ref={shortcutPanelRef}>
            {commandItems.length > 0 && (
                <>
                    <div className="shortcut-panel-section-title">Command</div>
                    {commandItems.map(renderItem)}
                </>
            )}
            {showDivider && <div className="shortcut-panel-divider" />}
            {skillItems.length > 0 && (
                <>
                    <div className="shortcut-panel-section-title">Skill</div>
                    {skillItems.map(renderItem)}
                </>
            )}
        </div>
    );
};

export default ShortcutPanel;
