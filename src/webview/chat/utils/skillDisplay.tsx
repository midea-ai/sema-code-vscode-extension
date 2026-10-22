/**
 * 技能 / 内置命令显示映射：把特定斜杠名显示为「图标 + 名字」（斜杠面板、输入框、用户气泡三处共用）。
 * 只影响显示，发给 core 的文本仍是 `/<斜杠名> ...`。要增删映射只需改 SKILL_DISPLAY / COMMAND_DISPLAY。
 * 技能名直接写英文（办公软件名各语言通用）；命令名与所有描述走 i18n，只写 zh / en，其他语言兜底英文（与 webui 一致）。
 */
import React from 'react';
import { getFileIconHtml } from '../components/ui/FileIcon';
import { FILE_LABEL_ICON } from './fileRefDisplay';
import { t, type I18nKey } from '../../common/i18n/core';

export type SkillIconName = 'chart' | 'chrome' | 'telescope' | 'puzzle' | 'eraser' | 'database' | 'messageQuestion' | 'target';

export interface SkillDisplay {
    /** 图标（二选一）：file = 复用文件图标，按后缀取（.docx / .xlsx / .pptx / .pdf）；icon = 内置 SVG */
    file?: string;
    icon?: SkillIconName;
    /** 名字颜色：文件图标取 FileIcon 的类型同色；内置图标随此色。省略（内置命令）= 输入框/气泡里与 @ 文件芯片同用链接高亮色，斜杠面板里用命令名现有的正文色 */
    color?: string;
    /** 名字：技能写英文常量 name；命令写 i18n key nameKey（二选一，nameKey 优先） */
    name?: string;
    nameKey?: I18nKey;
    descKey: I18nKey;
}

/** key = 斜杠名（SKILL.md frontmatter 的 name） */
export const SKILL_DISPLAY: Record<string, SkillDisplay> = {
    'minimax-docx':   { file: '.docx', color: '#519ABA', name: 'Word',       descKey: 'skill.minimax-docx.desc' },
    'minimax-xlsx':   { file: '.xlsx', color: '#7CA843', name: 'Excel',      descKey: 'skill.minimax-xlsx.desc' },
    'pptx-generator': { file: '.pptx', color: '#E37933', name: 'PowerPoint', descKey: 'skill.pptx-generator.desc' },
    'minimax-pdf':    { file: '.pdf',  color: '#CC3E44', name: 'PDF',        descKey: 'skill.minimax-pdf.desc' },
    'visualize':      { icon: 'chart',     color: '#4285F4', name: 'Visualize',  descKey: 'skill.visualize.desc' },
    'chrome-use':     { icon: 'chrome',    color: '#fabd15', name: 'Chrome',     descKey: 'skill.chrome-use.desc' },
    'deep-research':  { icon: 'telescope', color: '#2A9D8F', name: 'Research',   descKey: 'skill.deep-research.desc' },
    'sema-extend':    { icon: 'puzzle',    color: '#A074C4', name: 'SemaExtend', descKey: 'skill.sema-extend.desc' },
};

/** key = 内置命令名（与 utils/command.ts 的 getBuiltinShortcutCommands 一致）；不写 color：输入框/气泡里走链接高亮色（与 @ 文件芯片一致） */
export const COMMAND_DISPLAY: Record<string, SkillDisplay> = {
    'clear':     { icon: 'eraser',          nameKey: 'chat.cmd.clear.name',     descKey: 'chat.cmd.clear' },
    'compact':   { icon: 'database',        nameKey: 'chat.cmd.compact.name',   descKey: 'chat.cmd.compact' },
    'quickchat': { icon: 'messageQuestion', nameKey: 'chat.cmd.quickchat.name', descKey: 'chat.cmd.quickchat' },
    'goal':      { icon: 'target',          nameKey: 'chat.cmd.goal.name',      descKey: 'chat.cmd.goal' },
};

/** 内置图标（对齐 lucide 的 ChartColumn / Chrome / Telescope / Puzzle / Eraser / Database / MessageCircleQuestion / Target 线稿，stroke 走 currentColor，线宽 2 与 webui 一致） */
const SKILL_ICON_SVG: Record<SkillIconName, string> = {
    eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/></svg>',
    database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
    messageQuestion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
    chrome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" x2="12" y1="8" y2="8"/><line x1="3.95" x2="8.54" y1="6.06" y2="14"/><line x1="10.88" x2="15.46" y1="21.94" y2="14"/></svg>',
    telescope: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"/><path d="m13.56 11.747 4.332-.924"/><path d="m16 21-3.105-6.21"/><path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z"/><path d="m6.158 8.633 1.114 4.456"/><path d="m8 21 3.105-6.21"/><circle cx="12" cy="13" r="2"/></svg>',
    puzzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>',
};

export const skillDisplayOf = (name: string): SkillDisplay | undefined => SKILL_DISPLAY[name];
export const commandDisplayOf = (name: string): SkillDisplay | undefined => COMMAND_DISPLAY[name];
/** 技能或内置命令的显示映射（输入框原子标签按斜杠名查找时用） */
export const displayOf = (name: string): SkillDisplay | undefined => SKILL_DISPLAY[name] || COMMAND_DISPLAY[name];

/** 当前语言下的显示名 / 短描述（渲染和面板过滤统一走这里，切换语言即时生效；不要在模块顶层常量里调用） */
export const displayName = (d: SkillDisplay): string => d.nameKey ? t(d.nameKey) : d.name || '';
export const displayDesc = (d: SkillDisplay): string => t(d.descKey);

const DISPLAY_ORDER = Object.keys(SKILL_DISPLAY);
/** 在 SKILL_DISPLAY 中的序号（面板按此排序）；无映射返回一个大数，排在所有有映射的技能之后且相互保持原顺序 */
export const skillDisplayOrder = (name: string): number => { const i = DISPLAY_ORDER.indexOf(name); return i < 0 ? DISPLAY_ORDER.length : i; };

/**
 * 文本以 `/<映射技能名或内置命令名>` 开头 → 返回名字、前缀长度（含其后一个空格）与剩余文本。
 * 默认后接空白或结尾都算；输入框传 requireSpace，避免手敲到一半刚好拼出技能名就被换成标签
 */
export function matchSkillPrefix(text: string, requireSpace = false): { name: string; display: SkillDisplay; prefixLen: number; rest: string } | null {
    const m = text.match(requireSpace ? /^\/(\S+)\s/ : /^\/(\S+)(\s|$)/);
    if (!m) return null;
    const display = displayOf(m[1]);
    if (!display) return null;
    const prefixLen = m[0].length;
    return { name: m[1], display, prefixLen, rest: text.slice(prefixLen) };
}

/** 无固定色的命令：正文（输入框/气泡）里 .skill-label-accent 走链接高亮色与 @ 文件芯片一致；panel（斜杠面板）里 .skill-label-panel 走命令名现有的正文色 */
const labelClass = (display: SkillDisplay, panel: boolean | undefined, className?: string): string =>
    ['skill-label', !display.color && (panel ? 'skill-label-panel' : 'skill-label-accent'), className].filter(Boolean).join(' ');

/**
 * 图标 + 同色名字，内联在文字前面（无底色）。尺寸规格对齐 webui：
 * 文件图标走 .skill-label-file 的 scale(1.35)、不加对比度滤镜；线稿图标原尺寸 stroke 2。
 * 不用 FileIcon 组件是为了避开其内联的 scale(1.1)+contrast 滤镜，React 与 HTML 两条路径结构完全一致。
 */
export function SkillLabel({ display, className, size = FILE_LABEL_ICON, panel }: { display: SkillDisplay; className?: string; size?: number; panel?: boolean }) {
    let icon: React.ReactNode = null;
    if (display.file) {
        const { svg, color } = getFileIconHtml(display.file);
        icon = <span className="skill-label-icon skill-label-file" style={{ width: size, height: size, color }} dangerouslySetInnerHTML={{ __html: svg }} />;
    } else if (display.icon) {
        icon = <span className="skill-label-icon skill-label-svg" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: SKILL_ICON_SVG[display.icon] }} />;
    }
    return (
        <span className={labelClass(display, panel, className)} style={display.color ? { color: display.color } : undefined}>
            {icon}
            <span className="skill-label-name">{displayName(display)}</span>
        </span>
    );
}

/** 输入框技能 / 命令标签的内部 HTML（非 React DOM）：与 SkillLabel 同一套结构与类名 */
export function buildSkillLabelHtml(display: SkillDisplay, size = FILE_LABEL_ICON): string {
    let icon = '';
    if (display.file) {
        const { svg, color } = getFileIconHtml(display.file);
        icon = `<span class="skill-label-icon skill-label-file" style="width:${size}px;height:${size}px;color:${color}">${svg}</span>`;
    } else if (display.icon) {
        icon = `<span class="skill-label-icon skill-label-svg" style="width:${size}px;height:${size}px">${SKILL_ICON_SVG[display.icon]}</span>`;
    }
    const style = display.color ? ` style="color:${display.color}"` : '';
    return `<span class="${labelClass(display, false)}"${style}>${icon}<span class="skill-label-name">${displayName(display)}</span></span>`;
}
