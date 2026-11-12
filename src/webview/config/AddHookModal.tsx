import React, { useState } from 'react';
import { CloseIcon } from './utils/svgIcons';
import { HookConfig, HookEventName, HOOK_EVENTS } from './types/hook';
import { useT, I18nKey } from '../common/i18n/react';
import './style/section.css';
import './style/agent.css';
import './style/mcp.css';

type HookAddScope = 'project' | 'user';

const SCOPE_PATHS: Record<HookAddScope, string> = {
    project: '.sema/hooks/hooks.json',
    user: '~/.sema/hooks/hooks.json'
};

// 编辑器为空时展示的示例（仅作 placeholder，不写入内容），格式同 hooks.json
const MANUAL_ADD_PLACEHOLDER = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node .sema/hooks/check.js", "timeout": 10 }
        ]
      }
    ]
  }
}`;

// core 的新增接口只带得了这些字段；其余字段（如 if）静默丢掉会改变 hook 的触发条件，直接拒绝
const GROUP_FIELDS = new Set(['matcher', 'hooks']);
const COMMAND_FIELDS = new Set(['type', 'command', 'timeout', 'failClosed']);
const EVENT_SET = new Set<string>(HOOK_EVENTS);

type ParseError = { key: I18nKey; params?: Record<string, string | number> };

const isPlainObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 把 hooks.json 格式的片段拍平成 core 新增接口的入参列表（一条命令一个 HookConfig），校验规则与 core 对齐。
 * 任意一条不合法即整体报错，不做部分提交
 */
export function parseHooksJson(text: string, scope: HookAddScope): { items: HookConfig[] } | { error: ParseError } {
    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { error: { key: 'config.mcp.err.invalidJson' } };
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.hooks)) return { error: { key: 'config.hooks.err.needHooks' } };

    const items: HookConfig[] = [];
    for (const [event, groups] of Object.entries(parsed.hooks)) {
        if (!EVENT_SET.has(event)) return { error: { key: 'config.hooks.err.unknownEvent', params: { event } } };
        if (!Array.isArray(groups)) return { error: { key: 'config.hooks.err.invalidEntry', params: { event } } };
        for (const group of groups) {
            if (!isPlainObject(group) || !Array.isArray(group.hooks)) return { error: { key: 'config.hooks.err.invalidEntry', params: { event } } };
            if (group.matcher !== undefined && typeof group.matcher !== 'string') return { error: { key: 'config.hooks.err.invalidEntry', params: { event } } };
            const groupExtra = Object.keys(group).find(k => !GROUP_FIELDS.has(k));
            if (groupExtra) return { error: { key: 'config.hooks.err.unsupportedField', params: { event, field: groupExtra } } };
            const matcher = group.matcher?.trim() || undefined;

            for (const cmd of group.hooks) {
                if (!isPlainObject(cmd)) return { error: { key: 'config.hooks.err.invalidEntry', params: { event } } };
                const cmdExtra = Object.keys(cmd).find(k => !COMMAND_FIELDS.has(k));
                if (cmdExtra) return { error: { key: 'config.hooks.err.unsupportedField', params: { event, field: cmdExtra } } };
                if (cmd.type !== undefined && cmd.type !== 'command') {
                    return { error: { key: 'config.hooks.err.typeUnsupported', params: { event, type: String(cmd.type) } } };
                }
                const command = typeof cmd.command === 'string' ? cmd.command.trim() : '';
                if (!command) return { error: { key: 'config.hooks.err.emptyCommand', params: { event } } };
                if (cmd.timeout !== undefined && !(typeof cmd.timeout === 'number' && Number.isFinite(cmd.timeout) && cmd.timeout > 0)) {
                    return { error: { key: 'config.hooks.err.timeout', params: { event } } };
                }
                if (cmd.failClosed !== undefined && typeof cmd.failClosed !== 'boolean') {
                    return { error: { key: 'config.hooks.err.invalidEntry', params: { event } } };
                }
                items.push({
                    scope,
                    event: event as HookEventName,
                    ...(matcher && { matcher }),
                    command,
                    ...(cmd.timeout !== undefined && { timeout: cmd.timeout }),
                    ...(cmd.failClosed === true && { failClosed: true })
                });
            }
        }
    }
    if (items.length === 0) return { error: { key: 'config.hooks.err.noHooks' } };
    return { items };
}

interface AddHookModalProps {
    isSaving: boolean;
    onClose: () => void;
    onSave: (items: HookConfig[]) => void;
}

/** 手动添加 hook 弹窗：粘贴 hooks.json 格式的片段，交互对齐 MCP 的手动添加 */
const AddHookModal: React.FC<AddHookModalProps> = ({ isSaving, onClose, onSave }) => {
    const t = useT();
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [scope, setScope] = useState<HookAddScope>('project');

    const handleSave = () => {
        const result = parseHooksJson(jsonText, scope);
        if ('error' in result) {
            setError(t(result.error.key, result.error.params));
            return;
        }
        // 不在这里查重：已存在的条目 core 不会重复写，原样提交即可
        onSave(result.items);
    };

    return (
        <div className="section-modal-overlay" onClick={onClose}>
            <div className="section-modal" onClick={(e) => e.stopPropagation()}>
                <div className="section-modal-header">
                    <span>{t('config.hooks.manualAddTitle')}</span>
                    <button className="section-modal-close" onClick={onClose}><CloseIcon /></button>
                </div>
                <div className="section-modal-body">
                    <textarea
                        className="mcp-json-editor"
                        value={jsonText}
                        placeholder={MANUAL_ADD_PLACEHOLDER}
                        onChange={(e) => { setJsonText(e.target.value); setError(null); }}
                        spellCheck={false}
                    />
                    <div className="mcp-scope-row">
                        <span className="mcp-scope-label">{t('config.mcp.scopeLabel')}</span>
                        {(['project', 'user'] as HookAddScope[]).map(s => (
                            <label
                                key={s}
                                className="checkbox-label mcp-scope-option"
                                title={`${s === 'project' ? t('common.installToProjectTip') : t('common.installToUserTip')} (${SCOPE_PATHS[s]})`}
                            >
                                <input
                                    type="radio"
                                    name="hook-add-scope"
                                    value={s}
                                    checked={scope === s}
                                    onChange={() => { setScope(s); setError(null); }}
                                />
                                <span>{s === 'project' ? t('config.mcp.scopeProject') : t('config.mcp.scopeUser')}</span>
                            </label>
                        ))}
                    </div>
                    {error && <div className="section-edit-error">{error}</div>}
                </div>
                <div className="section-modal-footer">
                    <button className="section-btn secondary" onClick={onClose} disabled={isSaving}>{t('common.cancel')}</button>
                    <button className={`section-btn primary ${isSaving ? 'btn-loading' : ''}`} onClick={handleSave} disabled={isSaving}>
                        {isSaving && <span className="spinner" />}
                        {isSaving ? t('common.saving') : t('common.ok')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddHookModal;
