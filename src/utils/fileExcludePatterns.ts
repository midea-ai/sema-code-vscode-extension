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

/** 排除的文件扩展名（二进制/媒体/压缩文件） */
export const EXCLUDED_EXTENSIONS = new Set([
    '.jar', '.war', '.ear',
    '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.ttf', '.woff', '.woff2', '.eot',
    '.pdf', '.zip', '.tar', '.gz'
]);
