import { t as translate } from '../../../common/i18n/core';
import { TOOL_NAME_SEARCH_FILES } from '../../../../utils/tool';

/** title 里的 key: "value" 键值对，顺序、数量不限（pattern / path / glob / 其它） */
const SEARCH_FIELD_RE = /(\w+):\s*"((?:[^"\\]|\\.)*)"/g;

/** 搜索工具 title 形如 pattern: "x", glob: "*.py", path: "y"，拆成字段；没有 pattern 视为解析失败 */
export const parseSearchTitle = (title: string): { pattern: string; path: string; glob: string } | null => {
    const fields: Record<string, string> = {};
    for (const match of title.matchAll(SEARCH_FIELD_RE)) {
        fields[match[1]] = match[2];
    }
    if (fields.pattern === undefined) {
        return null;
    }
    return { pattern: fields.pattern, path: fields.path || '', glob: fields.glob || '' };
};

export interface SearchRowMeta {
    /** 已搜索 / 已查找文件 */
    verb: string;
    /** 带引号的关键词，单行省略 */
    target: string;
    /** 目标之后的位置：在 目录末段名 (glob)；目录为 . 且无 glob 时为空 */
    location: string;
    /** 行 hover 提示：关键词 + 完整路径 */
    title: string;
}

/** 去掉末尾分隔符后取路径末段；. 或空视为当前目录返回空 */
const getLastSegment = (path: string): string => {
    const trimmed = path.replace(/[/\\]+$/, '');
    if (!trimmed || trimmed === '.') {
        return '';
    }
    return trimmed.split(/[/\\]/).pop() || '';
};

const withGlob = (dir: string, glob: string): string => {
    if (!glob) {
        return dir;
    }
    return dir ? `${dir} (${glob})` : `(${glob})`;
};

/** 搜索行行头文案：已搜索 “关键词” 在 目录 (glob)；t 由组件的 useT() 传入以订阅语言 */
export const getSearchRowMeta = (toolName: string, title: string, t: typeof translate): SearchRowMeta => {
    const verb = toolName === TOOL_NAME_SEARCH_FILES ? t('tool.foundFiles') : t('tool.searched');
    const parsed = parseSearchTitle(title);
    if (!parsed) {
        return { verb, target: title, location: '', title };
    }

    const target = `“${parsed.pattern}”`;
    const shortDir = withGlob(getLastSegment(parsed.path), parsed.glob);
    const fullDir = withGlob(parsed.path && parsed.path !== '.' ? parsed.path : '', parsed.glob);
    return {
        verb,
        target,
        location: shortDir ? t('tool.searchIn', { dir: shortDir }) : '',
        title: fullDir ? `${target} ${t('tool.searchIn', { dir: fullDir })}` : target,
    };
};
