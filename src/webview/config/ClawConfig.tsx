import React, { useEffect, useRef, useState } from 'react';
import { VscodeApi } from './types';
import './style/section.css';

interface ClawConfigProps {
    vscode: VscodeApi;
}

interface IntegrationSource {
    id: string;
    name: string;
    initial: string;
    iconBg: string;
    desc: string;
    recommended?: boolean;
}

// 远程入口来源。
const SOURCES: IntegrationSource[] = [
    { id: 'wechat', name: '微信 ClawBot 集成', initial: '微', iconBg: '#07C160', desc: '通过微信扫码连接 ClawBot，接收并回复消息。', recommended: true },
    { id: 'feishu', name: '飞书集成', initial: '飞', iconBg: '#3370FF', desc: '注册飞书应用以通过飞书接收和回复消息。' },
];

type Verbosity = 'detailed' | 'medium' | 'simple' | 'minimal';

// 信息显示详略：控制远程（微信）会话转发到手机的工具信息多少。
const VERBOSITY_OPTIONS: { id: Verbosity; name: string; desc: string; badge?: string }[] = [
    { id: 'detailed', name: '详细', desc: '展示完整工具调用、文件读取、编辑和终端信息。', badge: '默认' },
    { id: 'medium', name: '中等', desc: '保留关键执行过程，仅展示文件编辑和终端工具。' },
    { id: 'simple', name: '简单', desc: '隐藏工具过程，只同步对话文字内容。' },
    { id: 'minimal', name: '极简', desc: '仅同步最终结论，适合减少手机端消息打扰。' },
];

/**
 * Claw 远程入口配置页：扫码绑定（持久）+ 开启/关闭（运行时，不持久化）。
 * 所有重型逻辑都在扩展端按需懒载；这里只发消息、显示状态。
 */
const ClawConfig: React.FC<ClawConfigProps> = ({ vscode }) => {
    const [bound, setBound] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [occupancy, setOccupancy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [qrcode, setQrcode] = useState<string | null>(null);
    const [expired, setExpired] = useState(false);
    const [hint, setHint] = useState<string | null>(null);
    const [verifyNeeded, setVerifyNeeded] = useState(false);
    const [verifyCode, setVerifyCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [openSource, setOpenSource] = useState<string | null>(null);
    const [feishuModalOpen, setFeishuModalOpen] = useState(false);
    const [feishuAppId, setFeishuAppId] = useState('');
    const [feishuAppSecret, setFeishuAppSecret] = useState('');
    const [feishuError, setFeishuError] = useState<string | null>(null);
    // 当前绑定的平台（'wechat' | 'feishu' | null）：决定哪张卡可配置——单频道，二选一。
    const [platform, setPlatform] = useState<string | null>(null);
    const [verbosity, setVerbosity] = useState<Verbosity>('detailed');
    // 标记当前二维码是否已展示：用于区分首张二维码与后端自动刷新（不自动换图，转为「已过期」）
    const qrShownRef = useRef(false);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const m = event.data;
            switch (m.command) {
                case 'clawStatus':
                    setBound(!!m.data.bound);
                    setEnabled(!!m.data.enabled);
                    setPlatform(m.data.platform ?? null);
                    setOccupancy(m.data.occupancy ? m.data.occupancy.projectPath : null);
                    setError(m.data.error ?? null);
                    if (m.data.verbosity) setVerbosity(m.data.verbosity);
                    setBusy(false);
                    break;
                case 'clawQrCode':
                    // 首张二维码：展示；之后后端推来的刷新二维码：不自动替换，标记过期等用户手动刷新。
                    if (qrShownRef.current) {
                        setExpired(true);
                    } else {
                        qrShownRef.current = true;
                        setQrcode(m.data.qrcodeDataUrl ?? null);
                        setExpired(false);
                        setHint(null);
                    }
                    setVerifyNeeded(false);
                    setBusy(false);
                    break;
                case 'clawVerifyCodeNeeded':
                    setVerifyNeeded(true);
                    break;
                case 'clawBindResult':
                    setBusy(false);
                    setVerifyNeeded(false);
                    if (m.data.connected) {
                        qrShownRef.current = false;
                        setQrcode(null);
                        setExpired(false);
                        setHint(null);
                        setFeishuModalOpen(false);
                        setFeishuError(null);
                    } else {
                        setHint(m.data.message || '绑定未完成');       // 微信扫码区提示
                        setFeishuError(m.data.message || '连接失败');   // 飞书模态区提示
                    }
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        vscode.postMessage({ command: 'clawLoadStatus' });
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const startBind = () => {
        qrShownRef.current = false;
        setBusy(true);
        setError(null);
        setQrcode(null);
        setExpired(false);
        setVerifyNeeded(false);
        setHint('正在生成二维码…');
        vscode.postMessage({ command: 'clawStartBind' });
    };

    const submitVerifyCode = () => {
        if (!verifyCode.trim()) return;
        vscode.postMessage({ command: 'clawSubmitVerifyCode', code: verifyCode.trim() });
        setVerifyNeeded(false);
        setVerifyCode('');
        setHint('正在验证…');
    };

    const unbind = () => {
        vscode.postMessage({ command: 'clawUnbind' });
        qrShownRef.current = false;
        setQrcode(null);
        setExpired(false);
        setHint(null);
        setOpenSource(null);
    };

    const toggleEnable = () => {
        setBusy(true);
        setError(null);
        setOccupancy(null);
        vscode.postMessage({ command: enabled ? 'clawDisable' : 'clawEnable' });
    };

    const changeVerbosity = (level: Verbosity) => {
        setVerbosity(level); // 乐观更新；扩展端落盘后会回发 clawStatus 再确认。
        vscode.postMessage({ command: 'clawSaveVerbosity', value: level });
    };

    const connectFeishu = () => {
        if (!feishuAppId.trim() || !feishuAppSecret.trim()) {
            setFeishuError('App ID 和 App Secret 不能为空');
            return;
        }
        setBusy(true);
        setFeishuError(null);
        vscode.postMessage({ command: 'clawBindFeishu', appId: feishuAppId.trim(), appSecret: feishuAppSecret.trim() });
    };

    const handleConfigClick = (id: string) => {
        // 单频道：已绑定其它平台时禁止配置，必须先解绑。
        if (bound && platform && platform !== id) return;

        if (id === 'feishu') {
            // 已绑定飞书：展开/收起开启面板；否则弹出连接弹窗。
            if (platform === 'feishu' && bound) {
                setOpenSource(openSource === id ? null : id);
                return;
            }
            setFeishuError(null);
            setFeishuModalOpen(true);
            return;
        }
        if (openSource === id) {
            setOpenSource(null);
            return;
        }
        setOpenSource(id);
        if (id === 'wechat' && !(platform === 'wechat' && bound)) startBind();
    };

    const renderFeishuModal = () => (
        <div className="section-modal-overlay" onClick={() => setFeishuModalOpen(false)}>
            <div className="section-modal" onClick={(e) => e.stopPropagation()}>
                <div className="section-modal-header">
                    <span>连接飞书</span>
                    <button className="section-modal-close" onClick={() => setFeishuModalOpen(false)} aria-label="关闭">
                        ×
                    </button>
                </div>
                <div className="section-modal-body">
                    <p style={{ margin: '0 0 16px', color: 'var(--vscode-descriptionForeground)', lineHeight: 1.6, fontSize: 13 }}>
                        通过 WebSocket 长连接将此工作区绑定到飞书机器人。
                    </p>
                    <div className="form-group">
                        <label htmlFor="feishu-app-id">飞书 App ID</label>
                        <input
                            id="feishu-app-id"
                            type="text"
                            value={feishuAppId}
                            onChange={(e) => setFeishuAppId(e.target.value)}
                            placeholder="如 cli_aa92b8926b2b9ba3"
                        />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="feishu-app-secret">飞书 App Secret</label>
                        <input
                            id="feishu-app-secret"
                            type="password"
                            value={feishuAppSecret}
                            onChange={(e) => setFeishuAppSecret(e.target.value)}
                            placeholder="请输入飞书 App Secret"
                        />
                    </div>
                    {feishuError && (
                        <div style={{ color: 'var(--s-color-danger, #e55)', fontSize: 12, marginTop: 12 }}>{feishuError}</div>
                    )}
                </div>
                <div className="section-modal-footer">
                    <button className="section-btn secondary" onClick={() => setFeishuModalOpen(false)} disabled={busy}>取消</button>
                    <button className="section-btn primary" onClick={connectFeishu} disabled={busy}>
                        {busy ? '连接中…' : '连接飞书'}
                    </button>
                </div>
            </div>
        </div>
    );

    // 已绑定：只展示「解绑 / 开启」。
    const renderBoundPanel = () => (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--s-card-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="section-btn secondary small" onClick={unbind} disabled={enabled}>解绑</button>
                <button className="section-btn primary small" onClick={toggleEnable} disabled={busy}>
                    {enabled ? '关闭' : '开启'}
                </button>
                <span style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>
                    {enabled ? '运行中（本窗口独占）' : '已就绪，可开启'}
                </span>
            </div>
            {occupancy && (
                <div style={{ color: 'var(--s-color-danger, #e55)', fontSize: 12, marginTop: 8 }}>
                    claw 正在『{occupancy}』使用中，请先在那里关闭。
                </div>
            )}
            {error && (
                <div style={{ color: 'var(--s-color-danger, #e55)', fontSize: 12, marginTop: 8 }}>{error}</div>
            )}
        </div>
    );

    // 未绑定：居中展示二维码（过期后手动刷新）。
    const renderQrPanel = () => (
        <div style={{ padding: '16px 14px', borderTop: '1px solid var(--s-card-border)', textAlign: 'center' }}>
            {expired ? (
                <>
                    <div style={{ fontSize: 13, marginBottom: 10, opacity: 0.85 }}>二维码已过期</div>
                    <button className="section-btn primary small" onClick={startBind}>刷新</button>
                </>
            ) : qrcode ? (
                <>
                    <div style={{ fontSize: 13, marginBottom: 10 }}>打开微信扫描二维码</div>
                    <img src={qrcode} alt="微信二维码" style={{ width: 200, height: 200, background: '#fff', padding: 8, borderRadius: 6 }} />
                    {verifyNeeded && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                            <input
                                type="text"
                                value={verifyCode}
                                onChange={(e) => setVerifyCode(e.target.value)}
                                placeholder="请输入手机微信上的验证码"
                                style={{ flex: '0 0 200px' }}
                            />
                            <button className="section-btn primary small" onClick={submitVerifyCode}>提交</button>
                        </div>
                    )}
                </>
            ) : (
                <div style={{ fontSize: 13, opacity: 0.85 }}>{hint || '正在生成二维码…'}</div>
            )}
        </div>
    );

    return (
        <div className="agent-config">
          <div className="section-groups">
            <div className="config-section">
                <h3 className="config-section-title">
                    Claw配置（Beta）
                    <span
                        className="section-hint-icon"
                        title="远程同一时刻只能启用一个渠道，绑定其一后，另一个需先解绑才能配置。"
                    >ⓘ</span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-gap-lg)' }}>
                    {SOURCES.map((src) => {
                        const open = openSource === src.id;
                        const isActive = platform === src.id && bound;              // 这张卡是当前绑定的平台
                        const lockedByOther = bound && platform !== null && platform !== src.id; // 已绑别的平台
                        const statusLabel = isActive ? (enabled ? '运行中' : '已绑定') : null;

                        return (
                            <div className="section-card" key={src.id}>
                                <div className="section-card-header">
                                    <div className="section-card-icon" style={{ background: src.iconBg }}>{src.initial}</div>
                                    <span className="section-card-name">{src.name}</span>
                                    {src.recommended && <span className="section-installed-badge">推荐</span>}
                                    {statusLabel && (
                                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--s-color-success, #3a3)' }}>{statusLabel}</span>
                                    )}
                                    <div className="section-card-actions">
                                        <button
                                            className="section-btn secondary small"
                                            onClick={() => handleConfigClick(src.id)}
                                            disabled={lockedByOther}
                                            title={lockedByOther ? '已绑定其它渠道，请先解绑' : undefined}
                                        >
                                            {open ? '收起' : '配置'}
                                        </button>
                                    </div>
                                </div>
                                <div className="section-card-desc">{src.desc}</div>
                                {open && (
                                    src.id === 'wechat'
                                        ? (isActive ? renderBoundPanel() : renderQrPanel())
                                        : (isActive ? renderBoundPanel() : null)
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {feishuModalOpen && renderFeishuModal()}

            <div className="config-section claw-display-section">
                <h3 className="config-section-title">
                    显示设置
                    <span
                        className="section-hint-icon"
                        title="控制远程（微信）会话转发到手机的信息详略，仅影响手机端展示，不影响本地会话记录。"
                    >ⓘ</span>
                </h3>
                <div className="form-row">
                    {VERBOSITY_OPTIONS.map((opt) => (
                        <div className="form-group claw-verbosity-group" key={opt.id}>
                            <label
                                className={`checkbox-label claw-verbosity-option ${verbosity === opt.id ? 'active' : ''}`}
                                title={opt.desc}
                            >
                                <input
                                    type="radio"
                                    name="claw-verbosity"
                                    value={opt.id}
                                    checked={verbosity === opt.id}
                                    onChange={() => changeVerbosity(opt.id)}
                                />
                                <span className="checkmark"></span>
                                <span className="claw-verbosity-copy">
                                    <span className="claw-verbosity-name">
                                        {opt.name}
                                        {opt.badge && <span className="readonly-tab">{opt.badge}</span>}
                                    </span>
                                    <span className="claw-verbosity-desc">{opt.desc}</span>
                                </span>
                            </label>
                        </div>
                    ))}
                </div>
            </div>
          </div>
        </div>
    );
};

export default ClawConfig;
