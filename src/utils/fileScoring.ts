/**
 * 文件搜索结果评分。query 传入前需自行 trim；rawQuery 保留原始大小写，query 为其小写形式。
 *
 * bucket 越小越优先：
 *   0 - basename 完全相等
 *   1 - basename 去扩展名后相等（仅文件）
 *   2 - basename 前缀匹配
 *   3 - basename 单词边界命中（驼峰/分隔符/数字-字母切换处起始的子串，或驼峰首字母子序列匹配）
 *   4 - basename 普通子串命中（非词首）
 *   5 - 仅路径命中（一般为目录条目，或 query 含路径分隔符的特殊场景）
 *
 * 同 bucket 内排序：
 *   目录优先 → matchIdx 越靠左优先 → 大小写完全匹配优先 → 路径深度浅优先 → 路径短优先。
 *   "大小写完全匹配"指 path 中包含原始大小写的 rawQuery；用户键入小写 'skill' 时
 *   skill.json 应排在 SKILL.md 之前。
 */

export interface FileScore {
    bucket: number;
    matchIdx: number;
    caseExact: boolean;
    depth: number;
    len: number;
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

/**
 * 在 name 中按"单词起点子序列"匹配 query。
 * 例：query="fcm" 在 "FileChangeManager" 命中（F、C、M 均在词首）。
 * query 已小写化，name 保留原大小写以判断驼峰边界。
 */
const matchAtWordBoundaries = (name: string, query: string): boolean => {
    if (!query) {
        return false;
    }
    const lowerName = name.toLowerCase();
    let qi = 0;
    for (let i = 0; i < name.length && qi < query.length; i++) {
        if (lowerName[i] === query[qi] && isWordBoundaryAt(name, i)) {
            qi++;
        }
    }
    return qi === query.length;
};

export const scoreItem = (
    path: string,
    isDirectory: boolean,
    query: string,
    rawQuery: string
): FileScore => {
    const name = path.split('/').pop() || path;
    const lowerName = name.toLowerCase();
    const lowerPath = path.toLowerCase();

    let bucket: number;
    let matchIdx: number;

    if (lowerName === query) {
        bucket = 0;
        matchIdx = 0;
    } else if (!isDirectory && (() => {
        const dotIdx = name.lastIndexOf('.');
        const stem = dotIdx > 0 ? name.substring(0, dotIdx) : name;
        return stem.toLowerCase() === query;
    })()) {
        bucket = 1;
        matchIdx = 0;
    } else if (lowerName.startsWith(query)) {
        bucket = 2;
        matchIdx = 0;
    } else if (lowerName.includes(query)) {
        const idx = lowerName.indexOf(query);
        bucket = isWordBoundaryAt(name, idx) ? 3 : 4;
        matchIdx = idx;
    } else if (matchAtWordBoundaries(name, query)) {
        bucket = 3;
        matchIdx = 0;
    } else {
        // basename 不命中，落到路径命中（多为目录条目）
        bucket = 5;
        const idx = lowerPath.indexOf(query);
        matchIdx = idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    }

    // caseExact 要看真正承载命中的目标：
    //   bucket 0-4 看 basename（避免被祖先目录里的小写 query 干扰）
    //   bucket 5 才看完整 path
    // 例：query='skill' 时 .sema/skills/cron/SKILL.md 的 basename 'SKILL.md' 不含原始 'skill'，
    //     而 .sema/skills/cron/skill.json 的 basename 'skill.json' 含——后者才该胜出。
    const caseExactTarget = bucket === 5 ? path : name;
    return {
        bucket,
        matchIdx,
        caseExact: rawQuery.length > 0 && caseExactTarget.includes(rawQuery),
        depth: (path.match(/\//g) || []).length,
        len: path.length
    };
};

export interface ScoredItem {
    score: FileScore;
    isDirectory: boolean;
}

export const compareScored = (a: ScoredItem, b: ScoredItem): number => {
    if (a.score.bucket !== b.score.bucket) {
        return a.score.bucket - b.score.bucket;
    }
    // 同 bucket：目录优先（输入目录名时多半是想浏览/选目录）
    if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
    }
    if (a.score.matchIdx !== b.score.matchIdx) {
        return a.score.matchIdx - b.score.matchIdx;
    }
    // 大小写完全匹配优先：键入小写 'skill' 时让 skill.json 排在 SKILL.md 之前
    if (a.score.caseExact !== b.score.caseExact) {
        return a.score.caseExact ? -1 : 1;
    }
    if (a.score.depth !== b.score.depth) {
        return a.score.depth - b.score.depth;
    }
    if (a.score.len !== b.score.len) {
        return a.score.len - b.score.len;
    }
    return 0;
};
