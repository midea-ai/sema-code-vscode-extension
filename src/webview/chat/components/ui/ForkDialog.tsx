import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { ForkPreview, ForkFileChange, ForkFileEffect } from '../../types';
import { getSelectionPointer } from '../../utils/symbols';

interface ForkDialogProps {
    preview: ForkPreview;
    onConfirm: (restoreFiles: boolean) => void;
    onCancel: () => void;
}

// 文件分两类展示：内容修改 / 存在性增删（recreate=恢复被删，delete=删掉新增）
const GROUP_ORDER: { key: string; label: string; effects: ForkFileEffect[] }[] = [
    { key: 'modify', label: '文件修改', effects: ['modify'] },
    { key: 'addremove', label: '文件增删', effects: ['recreate', 'delete'] },
];

const renderStats = (f: ForkFileChange) => {
    // 二进制文件不展示统计（无行级增减信息）
    if (f.binary) {
        return null;
    }
    return (
        <>
            {f.additions > 0 && <span className="fork-file-add">+{f.additions}</span>}
            {f.removals > 0 && <span className="fork-file-del">-{f.removals}</span>}
        </>
    );
};

/**
 * Fork / 撤销弹窗（居中模态浮层，复用 TaskDetailModal 的 portal 模式）。
 * 在某条用户消息处回退会话：可选仅撤销对话，或同时把文件回滚到该点。
 */
const ForkDialog: React.FC<ForkDialogProps> = ({ preview, onConfirm, onCancel }) => {
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const { canRestoreFiles, files } = preview;
    // 仅当既有快照锚点、且该点之后确有文件改动时，才提供「恢复文件」选项
    const hasRestorableFiles = canRestoreFiles && files.length > 0;
    // 按 effect 分组，空组不展示
    const groups = GROUP_ORDER
        .map(g => ({ ...g, items: files.filter(f => g.effects.includes(f.effect)) }))
        .filter(g => g.items.length > 0);

    // 选项列表（顺序与渲染一致，最后一项恒为「取消」）
    const options: { label: string; title?: string }[] = hasRestorableFiles
        ? [
            { label: '恢复文件并 Fork' },
            { label: '仅 Fork 会话', title: '仅撤销对话，已修改的文件保持不变' },
            { label: '取消' },
        ]
        : [
            { label: 'Fork 会话' },
            { label: '取消' },
        ];

    // 触发某个选项：最后一项为取消，首项视有无可恢复文件决定是否回滚
    const activate = useCallback((index: number) => {
        if (submitting) {
            return;
        }
        if (index === options.length - 1) {
            onCancel();
            return;
        }
        setSubmitting(true);
        onConfirm(hasRestorableFiles && index === 0);
    }, [submitting, options.length, hasRestorableFiles, onConfirm, onCancel]);

    // 点击遮罩关闭（执行中禁止关闭）
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !submitting) {
            onCancel();
        }
    }, [onCancel, submitting]);

    // 键盘导航：上下键切换选项，回车确认，ESC 关闭（执行中禁止操作）
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (submitting) {
                return;
            }
            switch (e.key) {
                case 'Escape':
                    onCancel();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(i => (i + 1) % options.length);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(i => (i - 1 + options.length) % options.length);
                    break;
                case 'Enter':
                    e.preventDefault();
                    activate(selectedIndex);
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [submitting, onCancel, options.length, selectedIndex, activate]);

    return ReactDOM.createPortal(
        <div className="fork-modal-overlay" onClick={handleBackdropClick}>
            <div className="fork-modal-container">
                <div className="fork-dialog-header">
                    <div className="fork-dialog-title">Fork / 撤销到此处</div>
                    <div className="fork-dialog-subtitle">将删除此消息及之后的所有对话</div>
                </div>

                {hasRestorableFiles ? (
                    <div className="fork-dialog-files">
                        {groups.map(g => (
                            <div className="fork-file-group" key={g.key}>
                                <div className="fork-file-group-title">{g.label}（{g.items.length}）</div>
                                {g.items.map(f => (
                                    <div className="fork-file-row" key={f.filePath}>
                                        {/* 首尾包裹 LRM 锚定为 LTR，避免 direction:rtl 下路径首/尾的 "/" 被 bidi 移位 */}
                                        <span className="fork-file-path" title={f.displayPath}>{'‎' + f.displayPath + '‎'}</span>
                                        <span className="fork-file-stats">{renderStats(f)}</span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="fork-dialog-note">
                        {canRestoreFiles
                            ? '此处之后无文件改动，将仅撤销对话'
                            : '此消息无文件快照，将仅撤销对话'}
                    </div>
                )}

                <div className="fork-dialog-buttons">
                    {options.map((opt, i) => (
                        <button
                            key={opt.label}
                            type="button"
                            className={`fork-dialog-btn ${selectedIndex === i ? 'selected' : ''}`}
                            title={opt.title}
                            disabled={submitting}
                            onClick={() => { setSelectedIndex(i); activate(i); }}
                        >
                            {selectedIndex === i && getSelectionPointer()}{opt.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ForkDialog;
