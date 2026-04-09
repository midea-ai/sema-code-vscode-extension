import DOMPurify from 'dompurify';

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
    ALLOWED_TAGS: ['strong', 'br', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['class', 'data-temp-id', 'data-file-path', 'data-line-info'],
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
  // 检查是否可能是文件路径格式（基本格式检查）
  if (isPotentialFilePath(originalCode)) {
    const { filePath, lineInfo } = parseFilePath(originalCode);

    // 如果有 vscode 对象，请求后端验证文件是否存在
    if (vscode) {
      // 先返回带有验证标记的HTML，后续通过消息更新
      const randomStr = Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36)).join('').slice(0, 9);
      const tempId = `file-check-${Date.now()}-${randomStr}`;

      // 异步请求文件验证
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
    } else {
      // 没有 vscode 对象时，使用原来的逻辑
      return `<code class="inline-code file-path-code" data-file-path="${escapeHtml(filePath)}" ${lineInfo ? `data-line-info="${escapeHtml(lineInfo)}"` : ''}>${escapedCode}</code>`;
    }
  }

  // 普通内联代码
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
  ];

  return markdownPatterns.some(pattern => pattern.test(content));
}