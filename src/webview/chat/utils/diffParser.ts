/**
 * 从原始 content 字符串解析出 DiffLine 数组
 * 格式：前N个字符是行号，接着是标记符(+/-/空格)，然后是代码内容
 */
interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface DiffContent {
  type: string;
  patch: DiffHunk[];
  diffText: string;
}

/**
 * 首个 hunk 在右侧（新内容）的锚点行，1-based，用于打开 diff 时定位到这次编辑。
 * 左右两侧在 unified diff 里是同一条可视行，取右侧是因为宿主 API（VSCode diff 的 selection、
 * JB 的 SCROLL_TO_LINE）只作用在右侧；无 patch 时退回第 1 行。
 */
export function firstHunkLine(diffContent: DiffContent): number {
  const newStart = diffContent.patch?.[0]?.newStart;
  return newStart && newStart > 0 ? newStart : 1;
}

/**
 * 统计 diff 中添加和删除的行数
 * 当 type 为 "new" 时，直接使用 hunk.newLines（因为 lines 内容可能被省略）
 */
export function countDiffChanges(diffContent: DiffContent): { addedCount: number; removedCount: number } {
  let added = 0;
  let removed = 0;

  if (diffContent.type === 'new') {
    diffContent.patch.forEach(hunk => {
      added += hunk.newLines;
    });
  } else {
    diffContent.patch.forEach(hunk => {
      hunk.lines.forEach(line => {
        if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
      });
    });
  }
  // console.log(`addedCount: ${added}, removedCount: ${removed}`)

  return { addedCount: added, removedCount: removed };
}
