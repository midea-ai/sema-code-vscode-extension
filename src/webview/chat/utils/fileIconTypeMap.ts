// 文件扩展名到类型的映射
export const iconMap: { [key: string]: string } = {
    // JavaScript/TypeScript
    'js': 'javascript',
    'jsx': 'react',
    'ts': 'typescript',
    'tsx': 'react',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'vue': 'vue',

    // C/C++
    'c': 'c',
    'h': 'c',
    'cpp': 'cpp',
    'cxx': 'cpp',
    'cc': 'cpp',
    'hpp': 'cpp',
    'hxx': 'cpp',
    'hh': 'cpp',

    // C#
    'cs': 'c-sharp',
    'csx': 'c-sharp',

    // Go
    'go': 'go',

    // Rust
    'rs': 'rust',
    'rlib': 'rust',

    // PHP
    'php': 'php',
    'phtml': 'php',
    'php3': 'php',
    'php4': 'php',
    'php5': 'php',
    'phps': 'php',

    // Ruby
    'rb': 'ruby',
    'rbw': 'ruby',
    'rake': 'ruby',
    'gemspec': 'ruby',

    // Shell
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'fish': 'shell',
    'ps1': 'powershell',
    'psm1': 'powershell',
    'psd1': 'powershell',

    // Web前端
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'sass',
    'sass': 'sass',

    // Python
    'py': 'python',
    'pyx': 'python',
    'pyo': 'python',
    'pyw': 'python',
    'pyc': 'python',
    'ipynb': 'notebook',

    // Java相关
    'java': 'java',
    'class': 'java',
    'jar': 'java',
    'kotlin': 'kotlin',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'scala': 'scala',
    'sc': 'scala',

    // 配置文件
    'json': 'json',
    'yaml': 'yml',
    'yml': 'yml',
    'toml': 'config',
    'ini': 'config',
    'conf': 'config',
    'cfg': 'config',
    'config': 'config',
    'env': 'config',

    // 文档
    'md': 'markdown',
    'markdown': 'markdown',
    // 'txt': 'default',
    // 'rtf': 'default',
    'pdf': 'pdf',
    'doc': 'word',
    'docx': 'word',
    'xls': 'xls',
    'xlsx': 'xls',

    // 图片
    'png': 'image',
    'jpg': 'image',
    'jpeg': 'image',
    'gif': 'image',
    'bmp': 'image',
    'webp': 'image',
    'svg': 'image',
    'ico': 'image',

    // 音视频
    'mp3': 'audio',
    'wav': 'audio',
    'flac': 'audio',
    'aac': 'audio',
    'ogg': 'audio',
    'mp4': 'video',
    'avi': 'video',
    'mkv': 'video',
    'mov': 'video',
    'wmv': 'video',
    'flv': 'video',
    'webm': 'video',

    // 压缩文件
    'zip': 'zip',
    'rar': 'zip',
    '7z': 'zip',
    'tar': 'zip',
    'gz': 'zip',
    'bz2': 'zip',
    'xz': 'zip',

    // Git相关
    'gitignore': 'git_ignore',
    'gitkeep': 'git',
    'gitattributes': 'git',
    'gitmodules': 'git',

    // 构建工具
    'dockerfile': 'docker',
    'makefile': 'makefile',
    'cmake': 'makefile',
    'gradle': 'gradle',
    'xml': 'xml',
    'pom': 'maven',

    // 其他语言
    'swift': 'swift',
    // 'dart': 'dart',
    // 'lua': 'lua',
    // 'r': 'R',
    // 'R': 'R',
    'pl': 'perl',
    'pm': 'perl',
    // 'clj': 'clojure',
    // 'cljs': 'clojure',
    // 'cljc': 'clojure',
    // 'elm': 'elm',
    // 'ex': 'elixir',
    // 'exs': 'elixir_script',
    // 'eex': 'elixir',
    // 'hs': 'haskell',
    // 'lhs': 'haskell',
    // 'ml': 'ocaml',
    // 'mli': 'ocaml',
    // 'fs': 'f-sharp',
    // 'fsx': 'f-sharp',
    // 'fsi': 'f-sharp',
    // 'cr': 'crystal',
    // 'nim': 'nim',
    // 'nims': 'nim',
    // 'nimble': 'nim',
    // 'jl': 'julia',
    // 'zig': 'zig',

    // 模板文件
    // 'ejs': 'ejs',
    // 'pug': 'pug',
    // 'jade': 'jade',
    // 'hbs': 'mustache',
    // 'handlebars': 'mustache',
    // 'mustache': 'mustache',
    // 'twig': 'twig',
    // 'liquid': 'liquid',
    // 'njk': 'nunjucks',
    // 'nunjucks': 'nunjucks',
    // 'haml': 'haml',
    // 'slim': 'slim',

    // 数据库
    'sql': 'db',
    'sqlite': 'db',
    'db': 'db',

    // 许可证
    'license': 'license',
    'licence': 'license',

    // 包管理
    'lock': 'lock',
    'package-lock': 'npm',
    'yarn': 'yarn',

    // 特殊文件
    // 'editorconfig': 'editorconfig',
    'eslintrc': 'eslint',
    'prettierrc': 'config',
    'babelrc': 'babel',
    'webpack': 'webpack',
    // 'rollup': 'rollup',
    // 'vite': 'vite',
    'tsconfig': 'tsconfig',
    // 'karma': 'karma',
    'protractor': 'config',

    // 其他
    // 'wasm': 'wasm',
    // 'wat': 'wat',
    // 'asm': 'asm',
    // 'cu': 'cu',
    // 'd': 'd',
    // 'v': 'vala',
    // 'vala': 'vala',
    'tex': 'tex',
    'latex': 'tex',
    'bib': 'tex',
    'font': 'font',
    'ttf': 'font',
    'otf': 'font',
    'woff': 'font',
    'woff2': 'font',
    'eot': 'font'
};