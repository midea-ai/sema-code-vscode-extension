import React from 'react';
import { getFileIconName } from '../../utils/fileIconUtils';
import { fileIconSvgs } from './fileIconSvgs';

interface FileIconProps {
    fileName: string;
    isDirectory: boolean;
    className?: string;
    size?: number;
}

// 颜色常量定义
const colors = {
    white: '#D4D7D6',
    grey: '#4D5A5E',
    greyLight: '#6D8086',
    red: '#CC3E44',
    orange: '#E37933',
    yellow: '#CBCB41',
    green: '#8DC149',
    blue: '#519ABA',
    purple: '#A074C4',
    pink: '#F55385',
    ignore: '#41535B'
};

// 图标颜色映射（SVG 统一为 fill="currentColor"，这里是颜色的唯一来源）
const iconColors: { [key: string]: string } = {
    // 文件夹
    folder: colors.greyLight,

    // JavaScript/TypeScript（测试文件橙色区分）
    javascript: colors.yellow,
    react: colors.blue,
    typescript: colors.blue,
    vue: colors.green,
    'javascript-test': colors.orange,
    'typescript-test': colors.orange,
    'react-test': colors.orange,

    // C/C++（头文件官方为紫色）
    c: colors.blue,
    cpp: colors.blue,
    'c-header': colors.purple,
    'cpp-header': colors.purple,

    // C#
    'c-sharp': colors.blue,

    // Go
    go: colors.blue,
    go2: colors.blue,

    // Rust
    rust: colors.greyLight,

    // PHP
    php: colors.purple,

    // Ruby
    ruby: colors.red,

    // Shell
    shell: colors.green,
    powershell: colors.blue,
    windows: colors.blue,

    // Web前端
    html: colors.orange,
    css: colors.blue,
    sass: colors.pink,
    less: colors.blue,
    svelte: colors.red,
    vite: colors.yellow,
    svg: colors.purple,

    // Python
    python: colors.blue,
    notebook: colors.blue,

    // Java相关
    java: colors.red,
    'java-class': colors.blue,
    kotlin: colors.orange,
    scala: colors.red,

    // 配置文件
    json: colors.yellow,
    yml: colors.purple,
    config: colors.greyLight,

    // 文档
    markdown: colors.blue,
    info: colors.blue,
    'time-cop': colors.blue,
    contributing: colors.red,
    pdf: colors.red,
    word: colors.blue,
    xls: colors.green,
    csv: colors.green,

    // 图片
    image: colors.purple,
    favicon: colors.yellow,

    // 音视频
    audio: colors.purple,
    video: colors.pink,

    // 压缩文件
    zip: colors.greyLight,
    jar: colors.red,

    // Git相关
    git_ignore: colors.ignore,
    git: colors.ignore,

    // 构建工具
    docker: colors.blue,
    'docker-ignore': colors.grey,
    'docker-compose': colors.red,
    makefile: colors.orange,
    cmake: colors.blue,
    gradle: colors.blue,
    xml: colors.orange,
    maven: colors.red,

    // 其他语言
    swift: colors.orange,
    perl: colors.blue,
    R: colors.blue,
    dart: colors.blue,
    lua: colors.blue,
    graphql: colors.pink,
    terraform: colors.purple,
    prisma: colors.blue,

    // 数据库
    db: colors.pink,

    // 许可证
    license: colors.yellow,

    // 包管理
    lock: colors.green,
    npm: colors.red,
    yarn: colors.blue,

    // 特殊文件
    eslint: colors.purple,
    'eslint-ignore': colors.grey,
    babel: colors.yellow,
    webpack: colors.blue,
    tsconfig: colors.blue,

    // 其他
    tex: colors.blue,
    font: colors.red,

    // 默认文件
    default: colors.white
};

/** 文件图标的 SVG 与颜色（给非 React 场景使用，如 markdown 渲染后按文件名动态插入图标） */
export function getFileIconHtml(fileName: string): { svg: string; color: string } {
    const iconName = getFileIconName(fileName, false);
    return { svg: fileIconSvgs[iconName] || fileIconSvgs.default, color: iconColors[iconName] || colors.white };
}

/**
 * 文件图标组件
 * 根据文件名和类型动态显示对应的SVG图标；
 * SVG 尺寸随容器（width/height=100%）、颜色走 currentColor
 */
const FileIcon: React.FC<FileIconProps> = ({
    fileName,
    isDirectory,
    className = '',
    size = 16
}) => {
    const iconName = getFileIconName(fileName, isDirectory);
    const svgContent = fileIconSvgs[iconName] || fileIconSvgs.default;
    const finalSize = iconName === 'folder' ? 14 : size;

    return (
        <div
            className={`file-icon ${className}`}
            style={{
                width: finalSize,
                height: finalSize,
                color: iconColors[iconName] || colors.white,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                filter: 'contrast(1.2) saturate(1.1)',
                transform: 'scale(1.1)'
            }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
        />
    );
};

export default React.memo(FileIcon);
