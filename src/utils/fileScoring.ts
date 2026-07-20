/**
 * 文件搜索结果评分。query 传入前需自行 trim 并小写化。
 *
 * bucket 越小越优先：
 *   0 - basename 完全相等
 *   1 - basename 去扩展名后相等（仅文件）
 *   2 - basename 前缀匹配
 *   3 - basename 词边界子串命中（-_./ 分隔符、驼峰、数字-字母切换处起始）
 *   4 - basename 普通子串命中（非词首）
 *   5 - 仅路径命中（目录条目，或 query 含路径分隔符的浏览式搜索）
 *
 * 同 bucket 平级链按命中位置分两组：
 *   basename 命中（0-4）：目录优先 → isOpen → 主干短优先 → 路径浅优先 → 字典序
 *   仅路径命中（5）  ：目录优先 → isOpen → 字典序（浏览目录场景，长度信号无意义）
 * 字典序兜底由调用方 localeCompare 承担。
 *
 * 主干长度用去扩展名后的长度：bucket 1 内主干全等自动退化到 depth，
 * 避免 index.ts 仅因扩展名短而压过 index.html。
 */

export interface FileScore {
    bucket: number;
    stemLen: number;
    depth: number;
}

const SEPARATOR_RE = /[-_./\\ ]/;
const DIGIT_RE = /[0-9]/;

const isWordBoundaryAt = (s: string, i: number): boolean => {
    if (i <= 0) {
        return true;
    }
    const prev = s[i - 1];
    const cur = s[i];
    if (SEPARATOR_RE.test(prev)) {
        return true;
    }
    // camelCase: 小写后跟大写
    if (prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z') {
        return true;
    }
    // 数字与字母交界
    if (DIGIT_RE.test(prev) !== DIGIT_RE.test(cur)) {
        return true;
    }
    return false;
};

export const scoreItem = (
    path: string,
    isDirectory: boolean,
    query: string
): FileScore => {
    const name = path.split('/').pop() || path;
    const lowerName = name.toLowerCase();
    const dotIdx = name.lastIndexOf('.');
    const stem = !isDirectory && dotIdx > 0 ? name.substring(0, dotIdx) : name;

    let bucket: number;
    if (lowerName === query) {
        bucket = 0;
    } else if (!isDirectory && stem.toLowerCase() === query) {
        bucket = 1;
    } else if (lowerName.startsWith(query)) {
        bucket = 2;
    } else if (lowerName.includes(query)) {
        bucket = isWordBoundaryAt(name, lowerName.indexOf(query)) ? 3 : 4;
    } else {
        // basename 不命中，落到路径命中（目录条目或浏览式搜索）
        bucket = 5;
    }

    return {
        bucket,
        stemLen: stem.length,
        depth: (path.match(/\//g) || []).length
    };
};

export interface ScoredItem {
    score: FileScore;
    isDirectory: boolean;
    isOpen: boolean;
}

export const compareScored = (a: ScoredItem, b: ScoredItem): number => {
    if (a.score.bucket !== b.score.bucket) {
        return a.score.bucket - b.score.bucket;
    }
    // 同 bucket：目录优先（输入目录名时多半是想浏览/选目录）
    if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
    }
    // 已打开文件优先：正在编辑的文件意图信号最强（仅 bucket 内，不跨档置顶）
    if (a.isOpen !== b.isOpen) {
        return a.isOpen ? -1 : 1;
    }
    // 仅路径命中：basename 长短与相关性无关，直接交给调用方字典序
    if (a.score.bucket === 5) {
        return 0;
    }
    if (a.score.stemLen !== b.score.stemLen) {
        return a.score.stemLen - b.score.stemLen;
    }
    if (a.score.depth !== b.score.depth) {
        return a.score.depth - b.score.depth;
    }
    return 0;
};
