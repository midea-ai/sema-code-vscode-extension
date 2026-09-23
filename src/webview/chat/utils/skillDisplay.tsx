/**
 * 技能显示映射：把特定 skill 的斜杠名显示为「图标 + 名字」（斜杠面板、输入框、用户气泡三处共用）。
 * 只影响显示，发给 core 的文本仍是 `/<斜杠名> ...`。要增删映射只需改 SKILL_DISPLAY。
 * 名字/描述直接写英文，不走 i18n（四款办公软件名各语言通用）。
 */
import React from 'react';
import { getFileIconHtml } from '../components/ui/FileIcon';

export type SkillIconName = 'chart' | 'chrome' | 'puzzle';

export interface SkillDisplay {
    /** 图标（二选一）：file = 复用文件图标，按后缀取（.docx / .xlsx / .pptx / .pdf）；icon = 内置 SVG */
    file?: string;
    icon?: SkillIconName;
    /** 名字颜色：文件图标取 FileIcon 的类型同色；内置图标随此色 */
    color: string;
    name: string;
    desc: string;
}

/** key = 斜杠名（SKILL.md frontmatter 的 name） */
export const SKILL_DISPLAY: Record<string, SkillDisplay> = {
    'minimax-docx':   { file: '.docx', color: '#519ABA', name: 'Word',       desc: 'Create and edit Word documents' },
    'minimax-xlsx':   { file: '.xlsx', color: '#7CA843', name: 'Excel',      desc: 'Create, edit and analyze spreadsheets' },
    'pptx-generator': { file: '.pptx', color: '#E37933', name: 'PowerPoint', desc: 'Generate and edit slides' },
    'minimax-pdf':    { file: '.pdf',  color: '#CC3E44', name: 'PDF',        desc: 'Generate and fill PDFs' },
    'visualize':      { icon: 'chart',  color: '#4285F4', name: 'Visualize',  desc: 'Charts, maps, simulators and mockups rendered in the chat' },
    'chrome-use':     { icon: 'chrome', color: '#fabd15', name: 'Chrome',     desc: 'Browse and operate web pages in your own Chrome' },
    'sema-extend':    { icon: 'puzzle', color: '#A074C4', name: 'SemaExtend', desc: 'Install, configure or remove skills, MCP servers and plugins' },
};

/** 内置图标（对齐 lucide 的 ChartColumn / Chrome / Puzzle 线稿，stroke 走 currentColor，线宽 2 与 webui 一致） */
const SKILL_ICON_SVG: Record<SkillIconName, string> = {
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
    chrome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" x2="12" y1="8" y2="8"/><line x1="3.95" x2="8.54" y1="6.06" y2="14"/><line x1="10.88" x2="15.46" y1="21.94" y2="14"/></svg>',
    puzzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>',
};

export const skillDisplayOf = (name: string): SkillDisplay | undefined => SKILL_DISPLAY[name];

const DISPLAY_ORDER = Object.keys(SKILL_DISPLAY);
/** 在 SKILL_DISPLAY 中的序号（面板按此排序）；无映射返回一个大数，排在所有有映射的技能之后且相互保持原顺序 */
export const skillDisplayOrder = (name: string): number => { const i = DISPLAY_ORDER.indexOf(name); return i < 0 ? DISPLAY_ORDER.length : i; };

/**
 * 文本以 `/<映射技能名>` 开头 → 返回技能名、前缀长度（含其后一个空格）与剩余文本。
 * 默认后接空白或结尾都算；输入框传 requireSpace，避免手敲到一半刚好拼出技能名就被换成标签
 */
export function matchSkillPrefix(text: string, requireSpace = false): { name: string; display: SkillDisplay; prefixLen: number; rest: string } | null {
    const m = text.match(requireSpace ? /^\/(\S+)\s/ : /^\/(\S+)(\s|$)/);
    if (!m) return null;
    const display = SKILL_DISPLAY[m[1]];
    if (!display) return null;
    const prefixLen = m[0].length;
    return { name: m[1], display, prefixLen, rest: text.slice(prefixLen) };
}

/**
 * 图标 + 同色名字，内联在文字前面（无底色）。尺寸规格对齐 webui：
 * 文件图标走 .skill-label-file 的 scale(1.35)、不加对比度滤镜；线稿图标原尺寸 stroke 2。
 * 不用 FileIcon 组件是为了避开其内联的 scale(1.1)+contrast 滤镜，React 与 HTML 两条路径结构完全一致。
 */
export function SkillLabel({ display, className, size = 15 }: { display: SkillDisplay; className?: string; size?: number }) {
    let icon: React.ReactNode = null;
    if (display.file) {
        const { svg, color } = getFileIconHtml(display.file);
        icon = <span className="skill-label-icon skill-label-file" style={{ width: size, height: size, color }} dangerouslySetInnerHTML={{ __html: svg }} />;
    } else if (display.icon) {
        icon = <span className="skill-label-icon skill-label-svg" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: SKILL_ICON_SVG[display.icon] }} />;
    }
    return (
        <span className={`skill-label${className ? ' ' + className : ''}`} style={{ color: display.color }}>
            {icon}
            <span className="skill-label-name">{display.name}</span>
        </span>
    );
}

/** 输入框技能标签的内部 HTML（非 React DOM）：与 SkillLabel 同一套结构与类名 */
export function buildSkillLabelHtml(display: SkillDisplay, size = 15): string {
    let icon = '';
    if (display.file) {
        const { svg, color } = getFileIconHtml(display.file);
        icon = `<span class="skill-label-icon skill-label-file" style="width:${size}px;height:${size}px;color:${color}">${svg}</span>`;
    } else if (display.icon) {
        icon = `<span class="skill-label-icon skill-label-svg" style="width:${size}px;height:${size}px">${SKILL_ICON_SVG[display.icon]}</span>`;
    }
    return `<span class="skill-label" style="color:${display.color}">${icon}<span class="skill-label-name">${display.name}</span></span>`;
}
