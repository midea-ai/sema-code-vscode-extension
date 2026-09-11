import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { ForkPreview, ForkFileChange, ForkFileEffect } from '../../types';
import { getSelectionPointer } from '../../utils/symbols';
import { useT, I18nKey } from '../../../common/i18n/react';

interface ForkDialogProps {
    preview: ForkPreview;
    onConfirm: (restoreFiles: boolean) => void;
    onCancel: () => void;
}

// 文件分两类展示：内容修改 / 存在性增删（recreate=恢复被删，delete=删掉新增）；label 为文案 key，渲染期取值
const GROUP_ORDER: { key: string; labelKey: I18nKey; effects: ForkFileEffect[] }[] = [
    { key: 'modify', labelKey: 'chat.fork.filterModify', effects: ['modify'] },
    { key: 'addremove', labelKey: 'chat.fork.filterAddRemove', effects: ['recreate', 'delete'] },
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
    const t = useT();
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
            { label: t('chat.fork.restoreAndFork') },
            { label: t('chat.fork.forkOnly'), title: t('chat.fork.forkOnlyTitle') },
            { label: t('common.cancel') },
        ]
        : [
            { label: t('chat.fork.fork') },
            { label: t('common.cancel') },
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
                    <div className="fork-dialog-title">{t('chat.fork.title')}</div>
                    <div className="fork-dialog-subtitle">{t('chat.fork.subtitle')}</div>
                </div>

                {hasRestorableFiles ? (
                    <div className="fork-dialog-files">
                        {groups.map(g => (
                            <div className="fork-file-group" key={g.key}>
                                <div className="fork-file-group-title">{t(g.labelKey)}（{g.items.length}）</div>
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
                            ? t('chat.fork.noChangesAfter')
                            : t('chat.fork.noSnapshot')}
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
