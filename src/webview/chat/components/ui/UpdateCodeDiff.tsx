import React, { useMemo } from 'react';
import { diffWordsWithSpace, Change } from 'diff';
import '../../style/code.css';

export interface UpdateCodeDiffProps {
  diffContent: DiffContent;
  language: string;
}

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

interface RenderRow {
  type: 'context' | 'added' | 'removed' | 'meta' | 'separator';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
  diffParts?: Change[];
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Split hljs-highlighted HTML by newlines while preserving open span context.
 * At each newline: close all open spans, push the line, then reopen them on the next line.
 * This ensures multi-line tokens (block comments, template literals, etc.) render correctly.
 */
const splitHighlightedLines = (html: string): string[] => {
  const lines: string[] = [];
  let cur = '';
  const spanStack: string[] = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { cur += html.slice(i); break; }
      const tag = html.slice(i, end + 1);
      i = end + 1;

      if (tag.startsWith('</span')) {
        spanStack.pop();
      } else if (tag.startsWith('<span')) {
        spanStack.push(tag);
      }
      cur += tag;
    } else if (html[i] === '\n') {
      for (let j = spanStack.length - 1; j >= 0; j--) cur += '</span>';
      lines.push(cur);
      cur = spanStack.join('');
      i++;
    } else {
      cur += html[i++];
    }
  }

  for (let j = spanStack.length - 1; j >= 0; j--) cur += '</span>';
  lines.push(cur);
  return lines;
};

/**
 * Highlight a list of lines as one code block so multi-line constructs get correct context.
 * Returns per-line highlighted HTML.
 */
const highlightBlock = (contents: string[], language: string): string[] => {
  if (!(window as any).hljs || !language || contents.length === 0) {
    return contents.map(escapeHtml);
  }
  try {
    const result = (window as any).hljs.highlight(contents.join('\n'), {
      language,
      ignoreIllegals: true,
    });
    const lines = splitHighlightedLines(result.value);
    while (lines.length < contents.length) lines.push('');
    return lines.slice(0, contents.length);
  } catch {
    return contents.map(escapeHtml);
  }
};

/**
 * Overlay word-level diff background highlights on top of syntax-highlighted HTML.
 * Handles span boundaries: the mark span is closed before any closing </span> and
 * reopened immediately after, preventing invalid HTML nesting.
 */
const applyWordDiffOverlay = (
  html: string,
  diffParts: Change[],
  lineType: 'removed' | 'added',
): string => {
  const ranges: Array<[number, number]> = [];
  let pos = 0;
  for (const part of diffParts) {
    const mark = lineType === 'removed' ? !!part.removed : !!part.added;
    if (mark) ranges.push([pos, pos + part.value.length]);
    pos += part.value.length;
  }
  if (ranges.length === 0) return html;

  const cls = `diff-highlight diff-highlight-${lineType}`;
  const inRange = (p: number) => ranges.some(([s, e]) => p >= s && p < e);

  let out = '';
  let textPos = 0;
  let marked = false;
  let i = 0;

  const open = () => { out += `<span class="${cls}">`; marked = true; };
  const close = () => { out += '</span>'; marked = false; };

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { out += html.slice(i); break; }
      const tag = html.slice(i, end + 1);
      i = end + 1;

      if (tag === '</span>') {
        if (marked) close();
        out += tag;
        if (inRange(textPos)) open();
      } else {
        out += tag;
      }
      continue;
    }

    // Text content; handle HTML entities as single logical characters
    let ch = html[i];
    let step = 1;
    if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i <= 8) {
        ch = html.slice(i, semi + 1);
        step = semi + 1 - i;
      }
    }

    if (inRange(textPos) && !marked) open();
    else if (!inRange(textPos) && marked) close();

    out += ch;
    i += step;
    textPos++;
  }

  if (marked) close();
  return out;
};

const processPatchToRows = (diffContent: DiffContent): RenderRow[] => {
  const rows: RenderRow[] = [];

  (diffContent.patch || []).forEach((hunk, index) => {
    if (index > 0) {
      rows.push({ type: 'separator', content: '' });
    }

    let currentOldLine = hunk.oldStart;
    let currentNewLine = hunk.newStart;

    hunk.lines.forEach((line) => {
      if (line.startsWith('\\ No newline')) return;

      const marker = line[0];
      const content = line.slice(1);

      if (marker === '-') {
        rows.push({ type: 'removed', oldLineNumber: currentOldLine++, content });
      } else if (marker === '+') {
        rows.push({ type: 'added', newLineNumber: currentNewLine++, content });
      } else {
        rows.push({ type: 'context', oldLineNumber: currentOldLine++, newLineNumber: currentNewLine++, content });
      }
    });
  });

  if (diffContent.diffText) {
    rows.push({ type: 'meta', content: diffContent.diffText });
  }

  return rows;
};

/**
 * Compute word-level diffs for adjacent removed/added line pairs of equal count.
 */
const WORD_DIFF_MAX_CHANGE_RATIO = 0.5;

const computeWordDiffs = (rows: RenderRow[]): RenderRow[] => {
  const result = [...rows];
  let i = 0;

  while (i < result.length) {
    if (result[i].type === 'removed') {
      const removedStart = i;
      while (i < result.length && result[i].type === 'removed') i++;
      const removedEnd = i;

      const addedStart = i;
      while (i < result.length && result[i].type === 'added') i++;
      const addedEnd = i;

      const pairCount = Math.min(removedEnd - removedStart, addedEnd - addedStart);
      for (let k = 0; k < pairCount; k++) {
        const removedIdx = removedStart + k;
        const addedIdx = addedStart + k;
        const changes = diffWordsWithSpace(
          result[removedIdx].content,
          result[addedIdx].content,
        );
        const total = changes.reduce((s, c) => s + c.value.length, 0);
        const changed = changes.reduce((s, c) => s + (c.added || c.removed ? c.value.length : 0), 0);
        if (total === 0 || changed / total <= WORD_DIFF_MAX_CHANGE_RATIO) {
          result[removedIdx].diffParts = changes.filter((c) => !c.added);
          result[addedIdx].diffParts = changes.filter((c) => !c.removed);
        }
      }
    } else {
      i++;
    }
  }

  return result;
};

const UpdateCodeDiff: React.FC<UpdateCodeDiffProps> = React.memo(({ diffContent, language }) => {
  const rows = useMemo(() => {
    const rawRows = processPatchToRows(diffContent);
    return computeWordDiffs(rawRows);
  }, [diffContent]);

  /**
   * Build per-row highlighted HTML using block highlighting for correct multi-line context.
   * Old view  = context + removed lines  → used for removed rows
   * New view  = context + added lines   → used for added and context rows
   */
  const highlightedHtmlMap = useMemo(() => {
    const oldEntries: { idx: number; content: string }[] = [];
    const newEntries: { idx: number; content: string }[] = [];

    rows.forEach((row, index) => {
      if (row.type === 'context') {
        oldEntries.push({ idx: index, content: row.content });
        newEntries.push({ idx: index, content: row.content });
      } else if (row.type === 'removed') {
        oldEntries.push({ idx: index, content: row.content });
      } else if (row.type === 'added') {
        newEntries.push({ idx: index, content: row.content });
      }
    });

    const oldHL = highlightBlock(oldEntries.map(e => e.content), language);
    const newHL = highlightBlock(newEntries.map(e => e.content), language);

    const map = new Map<number, string>();
    oldEntries.forEach((e, i) => map.set(e.idx, oldHL[i]));
    // Overwrite context lines with new-view result (identical content, consistent coloring)
    newEntries.forEach((e, i) => map.set(e.idx, newHL[i]));
    return map;
  }, [rows, language]);

  return (
    <div className="update-code-diff">
      <div className="update-code-diff-scroll">
        <table>
          <colgroup>
            <col />
            <col />
            <col />
          </colgroup>
          <tbody>
            {rows.map((row, index) => {
              if (row.type === 'separator') {
                return (
                  <tr key={index} className="diff-row-separator">
                    <td></td>
                    <td></td>
                    <td>
                      <div className="diff-separator-pattern"></div>
                    </td>
                  </tr>
                );
              }

              if (row.type === 'meta') {
                return (
                  <tr key={index} className="diff-row-meta">
                    <td colSpan={3}>{row.content}</td>
                  </tr>
                );
              }

              let rowClass = '';
              let lineNum: number | undefined;
              let sign = '';

              if (row.type === 'added') {
                rowClass = 'diff-row-added';
                lineNum = row.newLineNumber;
                sign = '+';
              } else if (row.type === 'removed') {
                rowClass = 'diff-row-removed';
                lineNum = row.oldLineNumber;
                sign = '-';
              } else if (row.type === 'context') {
                lineNum = row.newLineNumber;
              }

              const baseHtml = highlightedHtmlMap.get(index) ?? escapeHtml(row.content);
              const contentHtml =
                (row.type === 'removed' || row.type === 'added') && row.diffParts
                  ? applyWordDiffOverlay(baseHtml, row.diffParts, row.type)
                  : baseHtml;

              return (
                <tr key={index} className={rowClass}>
                  <td className="diff-line-number">{lineNum || ''}</td>
                  <td className="diff-sign">{sign}</td>
                  <td className="diff-content">
                    {row.content
                      ? <span dangerouslySetInnerHTML={{ __html: contentHtml }} />
                      : <span>&#x200B;</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

UpdateCodeDiff.displayName = 'UpdateCodeDiff';

export default UpdateCodeDiff;
