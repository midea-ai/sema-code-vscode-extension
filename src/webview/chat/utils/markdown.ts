import DOMPurify from 'dompurify';
import katex from 'katex';

/**
 * 简化的Markdown渲染，只支持：
 * 1. ## 标题加粗
 * 2. ``` 代码块高亮
 * 3. **文本** 加粗
 * 4. `代码` 颜色变化
 */
export function renderMarkdownToHtml(content: string, vscode?: any): string {
  if (!content || content.trim() === '') {
    return '';
  }

  let processedContent = content;
  const codeBlockPlaceholders: string[] = [];
  const inlineCodePlaceholders: string[] = [];
  const imagePlaceholders: string[] = [];
  const urlPlaceholders: string[] = [];
  const mathPlaceholders: string[] = [];
  // 公式占位用纯 ASCII + 随机盐：要让占位串能"穿过" DOMPurify（不会被解析器吞掉），
  // 同时避免和用户原文里的字符串碰撞。\x00 那一套占位走的是 sanitize 之前恢复，公式不行。
  const mathSalt = Math.random().toString(36).slice(2, 10);
  const mathToken = (i: number) => `__KATEX_${mathSalt}_${i}__`;

  // 步骤1: 提取代码块
  processedContent = processedContent.replace(/```([\s\S]*?)```/g, (match, code) => {
    let processedCode = code.trim();

    // 定义支持的语言标识符列表
    const languageIdentifiers = [
      'python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'rust',
      'ruby', 'php', 'swift', 'kotlin', 'scala', 'html', 'css', 'scss', 'json', 'xml',
      'yaml', 'yml', 'markdown', 'bash', 'sh', 'sql', 'r', 'vue', 'dart'
    ];

    // 如果第一行是语言标识符，去掉它并记录语言
    let langClass = '';
    const lines = processedCode.split('\n');
    if (lines.length > 0 && lines[0].trim()) {
      const firstLine = lines[0].trim().toLowerCase();
      if (languageIdentifiers.includes(firstLine)) {
        langClass = ` class="language-${firstLine}"`;
        processedCode = lines.slice(1).join('\n');
      }
    }

    const escapedCode = escapeHtml(processedCode);
    const placeholder = `\x00CODE_BLOCK_${codeBlockPlaceholders.length}\x00`;
    codeBlockPlaceholders.push(`<pre class="code-block"><code${langClass}>${escapedCode}</code></pre>`);
    return placeholder;
  });

  // 步骤2: 提取内联代码（先处理双反引号，允许内部包含单反引号）
  // 使用更宽松的匹配：两个反引号之间的任意内容（非贪婪）
  processedContent = processedContent.replace(/``([\s\S]+?)``/g, (match, code) => {
    const escapedCode = escapeHtml(code);
    const placeholder = `\x00INLINE_CODE_${inlineCodePlaceholders.length}\x00`;
    const codeHtml = createInlineCodeHtml(code, escapedCode, vscode);
    inlineCodePlaceholders.push(codeHtml);
    return placeholder;
  });

  // 步骤3: 提取单反引号内联代码（避免匹配占位符中的内容）
  // [^`\x00] 表示：不是反引号，也不是 NULL 字符
  processedContent = processedContent.replace(/`([^`\x00]+?)`/g, (match, code) => {
    const escapedCode = escapeHtml(code);
    const placeholder = `\x00INLINE_CODE_${inlineCodePlaceholders.length}\x00`;
    const codeHtml = createInlineCodeHtml(code, escapedCode, vscode);
    inlineCodePlaceholders.push(codeHtml);
    return placeholder;
  });

  // 步骤3.3: 提取块级公式 $$...$$（必须早于行内 $...$，否则会被抢吃成 ""）
  processedContent = processedContent.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expr) => {
    const i = mathPlaceholders.length;
    mathPlaceholders.push(
      `<div class="md-math-block">${katex.renderToString(expr.trim(), {
        displayMode: true,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      })}</div>`
    );
    return mathToken(i);
  });

  // 步骤3.4: 提取行内公式 $...$
  //   (?<![\\$])  起始 $ 前不是 \ 或 $（避开 \$ 转义、$$ 块级残留）
  //   \$(?!\s)     起始 $ 后不能紧跟空白
  //   ([^\n$]+?)   内容不跨行、不含 $（非贪婪）
  //   (?<!\s)\$    收尾 $ 前不能紧跟空白
  //   (?!\d)       收尾 $ 后不能紧跟数字（避开 "$5,$10 packs" 这种货币误识别）
  processedContent = processedContent.replace(
    /(?<![\\$])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g,
    (_match, expr) => {
      const i = mathPlaceholders.length;
      mathPlaceholders.push(
        `<span class="md-math-inline">${katex.renderToString(expr, {
          displayMode: false,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
        })}</span>`
      );
      return mathToken(i);
    }
  );

  // 步骤3.5 / 3.6: 图片、本地 URL 仅在非流式（vscode 已传入）阶段提取并渲染
  // 流式阶段（vscode=undefined）整体跳过，保留原始 markdown 文本，避免：
  //   - partial regex 在打字过程中部分命中导致页面抖动
  //   - 图片无法走 resolveImagePath 解析、退化为 broken icon
  //   - 半截 URL 提前可点
  if (vscode) {
    // 图片占位 - ![alt](path) 语法，路径分本地/远程两支处理
    processedContent = processedContent.replace(/!\[([^\]]*)\]\(([^)\s]+?)\)/g, (match, alt, src) => {
      const placeholder = `\x00IMG_${imagePlaceholders.length}\x00`;
      imagePlaceholders.push(createImageHtml(src.trim(), alt, vscode, match));
      return placeholder;
    });

    // 本地 loopback URL 占位 - 仅支持裸 URL，仅 localhost/127.0.0.1/0.0.0.0/[::1]
    // 负向回顾排除 `](url)` 形式（不处理 markdown link，避免显示文本与目标分离的欺骗风险）
    processedContent = processedContent.replace(
      /(?<!\]\()https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s<>"'`)\]]*)?/gi,
      (match) => {
        let url = match;
        let trailing = '';
        const trailMatch = url.match(/[.,;:!?。，；！？、]+$/);
        if (trailMatch) {
          trailing = trailMatch[0];
          url = url.slice(0, -trailing.length);
        }
        const safeUrl = escapeHtml(url);
        const placeholder = `\x00URL_${urlPlaceholders.length}\x00`;
        urlPlaceholders.push(`<a class="md-url-link" data-url="${safeUrl}">${safeUrl}</a>`);
        return placeholder + trailing;
      }
    );
  }

  // 步骤4: 表格处理
  processedContent = processTableMarkdown(processedContent);

  // 步骤5: 标题处理
  processedContent = processedContent.replace(/^#{1,6}\s+(.*)$/gm, (match, title) => {
    return `\n\n<strong>${title}</strong>\n\n`;
  });

  // 清理多余的换行符
  processedContent = processedContent.replace(/\n{3,}/g, '\n\n');
  processedContent = processedContent.replace(/^\n+/, '');
  processedContent = processedContent.replace(/\n+$/, '');

  // 步骤6: 粗体处理
  processedContent = processedContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 步骤7: 换行处理
  processedContent = processedContent.replace(/\n/g, '<br>');

  // 步骤8: 恢复内联代码
  inlineCodePlaceholders.forEach((inlineCode, index) => {
    const placeholder = `\x00INLINE_CODE_${index}\x00`;
    processedContent = processedContent.split(placeholder).join(inlineCode);
  });

  // 步骤8.5: 恢复图片占位
  imagePlaceholders.forEach((img, index) => {
    const placeholder = `\x00IMG_${index}\x00`;
    processedContent = processedContent.split(placeholder).join(img);
  });

  // 步骤8.6: 恢复 URL 占位
  urlPlaceholders.forEach((url, index) => {
    const placeholder = `\x00URL_${index}\x00`;
    processedContent = processedContent.split(placeholder).join(url);
  });

  // 步骤9: 恢复代码块
  codeBlockPlaceholders.forEach((codeBlock, index) => {
    const placeholder = `\x00CODE_BLOCK_${index}\x00`;
    processedContent = processedContent.split(placeholder).join(codeBlock);
  });

  // 步骤10: 清理多余的<br>标签
  processedContent = processedContent.replace(/(<br>){3,}/g, '<br><br>');
  processedContent = processedContent.replace(/<\/code><\/pre><br><br>/g, '</code></pre><br>');

  // console.log(JSON.stringify(processedContent));

  // 步骤11: DOMPurify最终消毒，防止XSS
  processedContent = DOMPurify.sanitize(processedContent, {
    ALLOWED_TAGS: ['strong', 'br', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'a'],
    ALLOWED_ATTR: [
      'class', 'data-temp-id', 'data-file-path', 'data-line-info',
      'src', 'alt', 'data-img-path', 'data-img-url', 'data-img-temp-id', 'data-md-original',
      'data-url'
    ],
  });

  // 步骤12: 恢复公式占位
  // KaTeX 输出含大量 span/style 和 MathML，加进 DOMPurify 白名单会显著扩大攻击面，
  // 因此让 KaTeX HTML 绕过 sanitize 直接注入。KaTeX 自身已用 trust:false 关掉 \href 等危险命令。
  mathPlaceholders.forEach((html, i) => {
    processedContent = processedContent.split(mathToken(i)).join(html);
  });

  return processedContent;
}

/**
 * 处理Markdown表格
 */
function processTableMarkdown(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 检查是否是表格的开始（包含 | 且下一行是分隔行）
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      // 找到表格的所有行
      const tableLines: string[] = [line];
      let j = i + 1;

      while (j < lines.length && (isTableRow(lines[j]) || isTableSeparator(lines[j]))) {
        tableLines.push(lines[j]);
        j++;
      }

      // 转换表格为HTML
      const tableHtml = convertTableToHtml(tableLines);
      result.push(tableHtml);
      i = j;
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * 检查是否是表格行（包含 |）
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && !isTableSeparator(line);
}

/**
 * 检查是否是表格分隔行（如 |------|------|）
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  // 分隔行只包含 |、-、: 和空格
  return /^\|?[\s\-:|]+\|?$/.test(trimmed) && trimmed.includes('-');
}

/**
 * 将表格行转换为HTML
 */
function convertTableToHtml(tableLines: string[]): string {
  const rows: string[][] = [];

  for (const line of tableLines) {
    if (isTableSeparator(line)) {
      continue; // 跳过分隔行
    }

    // 解析单元格
    const cells = parseTableRow(line);
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) {
    return '';
  }

  // 生成HTML表格
  let html = '<table class="markdown-table">';

  // 第一行作为表头
  if (rows.length > 0) {
    html += '<thead><tr>';
    for (const cell of rows[0]) {
      html += `<th>${cell}</th>`;
    }
    html += '</tr></thead>';
  }

  // 剩余行作为表体
  if (rows.length > 1) {
    html += '<tbody>';
    for (let i = 1; i < rows.length; i++) {
      html += '<tr>';
      for (const cell of rows[i]) {
        html += `<td>${cell}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  }

  html += '</table>';
  return html;
}

/**
 * 解析表格行，提取单元格内容
 */
function parseTableRow(line: string): string[] {
  let trimmed = line.trim();

  // 移除首尾的 |
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.slice(0, -1);
  }

  // 按 | 分割并清理每个单元格
  const cells = trimmed.split('|').map(cell => cell.trim());
  return cells;
}

/**
 * HTML转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 创建内联代码HTML，如果是文件路径格式则添加点击事件
 */
function createInlineCodeHtml(originalCode: string, escapedCode: string, vscode?: any): string {
  // 仅在 vscode 可用（非流式）时检测并发起文件路径校验；流式阶段一律按纯内联代码渲染，等结束后再走完整逻辑
  if (vscode && isPotentialFilePath(originalCode)) {
    const { filePath, lineInfo } = parseFilePath(originalCode);
    const randomStr = Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36)).join('').slice(0, 9);
    const tempId = `file-check-${Date.now()}-${randomStr}`;

    setTimeout(() => {
      vscode.postMessage({
        type: 'verifyFilePath',
        filePath: filePath,
        tempId: tempId,
        originalCode: originalCode,
        lineInfo: lineInfo
      });
    }, 0);

    return `<code class="inline-code" data-temp-id="${tempId}" data-file-path="${escapeHtml(filePath)}" ${lineInfo ? `data-line-info="${escapeHtml(lineInfo)}"` : ''}>${escapedCode}</code>`;
  }

  return `<code class="inline-code">${escapedCode}</code>`;
}

/**
 * 判断是否可能是文件路径格式（仅做基本格式检查）
 */
function isPotentialFilePath(code: string): boolean {
  // 排除一些明显不是文件路径的情况
  if (code.includes(' ') || code.length > 200 || code.length < 2) {
    return false;
  }

  // 匹配文件路径格式：
  // 1. filename.ext
  // 2. filename.ext:line
  // 3. filename.ext:line~line
  // 4. filename.ext:line-line
  // 5. path/filename.ext
  // 6. path/filename.ext:line
  // 7. path/filename.ext:line~line
  // 8. path/filename.ext:line-line
  // 9. 没有扩展名的文件：src/readme
  const filePathPattern = /^[a-zA-Z0-9_\-./\\]+(\.[a-zA-Z0-9]+)?(:\d+[-~]\d+|:\d+)?$/;

  // 基本格式检查
  if (!filePathPattern.test(code)) {
    return false;
  }

  // 更严格的检查：至少包含一个字母、数字、斜杠或点
  const hasValidChars = /[a-zA-Z0-9./]/.test(code);
  if (!hasValidChars) {
    return false;
  }

  // 检查是否看起来像文件路径
  const looksLikeFile =
    code.includes('/') ||           // 包含路径分隔符
    code.includes('.') ||           // 包含文件扩展名
    code.includes(':') ||           // 包含行号信息
    /^[a-zA-Z0-9_-]+$/.test(code);  // 或者是简单的文件名

  return looksLikeFile;
}

/**
 * 解析文件路径，提取文件名和行号信息
 */
function parseFilePath(code: string): { filePath: string; lineInfo?: string } {
  const match = code.match(/^(.+?)(:(\d+[-~]\d+|\d+))?$/);
  if (match) {
    const filePath = match[1];
    const lineInfo = match[3]; // 直接获取行号信息，不需要去掉冒号
    return { filePath, lineInfo };
  }
  return { filePath: code };
}

/**
 * 检查内容是否包含Markdown格式
 */
export function hasMarkdownFormatting(content: string): boolean {
  if (!content) return false;

  const markdownPatterns = [
    /#{1,6}\s+/,           // 标题
    /\*\*.*?\*\*/,         // 粗体
    /``[\s\S]+?``/,        // 双反引号内联代码
    /`[^`]+?`/,            // 单反引号内联代码
    /```[\s\S]*?```/,      // 代码块
    /^\|.+\|$/m,           // 表格行
    /!\[[^\]]*\]\([^)\s]+?\)/, // 图片
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i, // 本地 loopback URL
    /\$\$[\s\S]+?\$\$/,    // 块级公式
    /(?<![\\$])\$(?!\s)[^\n$]+?(?<!\s)\$(?!\d)/, // 行内公式
  ];

  return markdownPatterns.some(pattern => pattern.test(content));
}

/**
 * 创建图片 HTML
 * - 远程 URL（http/https）：直接渲染 src，标记 data-img-url，点击在浏览器打开
 * - 本地路径：webview 不能直接加载相对/绝对路径（CSP + 资源协议限制），
 *   先渲染 1×1 透明占位，并发 resolveImagePath 让扩展端用 webview.asWebviewUri 转出真实 src 后回填；
 *   data-img-path 保留以维持点击跳转逻辑（openFile 对不存在的路径静默 no-op）
 */
function createImageHtml(src: string, alt: string, vscode?: any, originalMd?: string): string {
  const safeAlt = escapeHtml(alt || '');

  if (/^https?:\/\//i.test(src)) {
    const safeSrc = escapeHtml(src);
    return `<img src="${safeSrc}" alt="${safeAlt}" class="md-image md-image-remote" data-img-url="${safeSrc}" />`;
  }

  const safePath = escapeHtml(src);
  // 原始 markdown 文本，本地图片不存在时回退展示用
  const safeOriginal = escapeHtml(originalMd || `![${alt}](${src})`);

  if (vscode) {
    const randomStr = Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36)).join('').slice(0, 9);
    const tempId = `img-resolve-${Date.now()}-${randomStr}`;
    // 1×1 透明 GIF，避免初次渲染触发无效请求或被 CSP 拦截
    const placeholderSrc = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    setTimeout(() => {
      vscode.postMessage({
        type: 'resolveImagePath',
        filePath: src,
        tempId
      });
    }, 0);

    return `<img src="${placeholderSrc}" alt="${safeAlt}" class="md-image md-image-local" data-img-path="${safePath}" data-img-temp-id="${tempId}" data-md-original="${safeOriginal}" />`;
  }

  // 没有 vscode 对象（如静态/测试场景），退回原生路径渲染
  return `<img src="${safePath}" alt="${safeAlt}" class="md-image md-image-local" data-img-path="${safePath}" data-md-original="${safeOriginal}" />`;
}