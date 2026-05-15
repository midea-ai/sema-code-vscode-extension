/**
 * 共享的文件排除规则，供 FileOperationManager 和 FileStateDiffManager 使用
 */

/** 排除的目录和文件名集合（用于 Set 查找） */
export const EXCLUDED_NAMES = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', '.vscode',
    '.DS_Store', '__pycache__', '.pytest_cache', 'venv', '.venv', '.env', '.idea',
    'target', 'ios', 'android', '.tmp', 'temp', 'logs',
    '.gradle', 'gradle', '.m2', '.settings',
    '.nuxt', '.output', '.svelte-kit', '.astro',
    '.vuepress', '.vitepress', '.cache', '.parcel-cache',
    'coverage', '.nyc_output', 'storybook-static',
    '.docusaurus', '.expo', '.react-email'
]);

/** vscode.workspace.findFiles 用的排除 glob */
export const EXCLUDE_GLOB =
    '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/out/**,**/.vscode/**,**/.DS_Store/**,**/__pycache__/**,**/.pytest_cache/**,**/venv/**,**/.venv/**,**/.env/**,**/.idea/**,**/target/**,**/ios/**,**/android/**}';

/** 排除的特定文件名 */
export const EXCLUDED_FILES = new Set([
    '.project', '.classpath', '.eslintcache', '.DS_Store', 'Thumbs.db'
]);

/**
 * 非文本文件扩展名（二进制/媒体/压缩/字体等）
 * - FileStateDiffManager: 用于跳过 diff
 * - FileOperationManager: 用于判断是否需走 VS Code 默认查看器（如图片预览）
 */
export const NON_TEXT_EXTENSIONS = new Set([
    '.jar', '.war', '.ear',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tiff', '.tif',
    '.pdf', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.flac', '.ogg',
    '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);
