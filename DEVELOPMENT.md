# Sema Code VSCode Extension 开发文档

## 目录

- [开发环境搭建](#开发环境搭建)
- [构建系统](#构建系统)
- [打包与发布](#打包与发布)
- [调试指南](#调试指南)


## 开发环境搭建

### 前置要求

- Node.js 18.x+
- VSCode ^1.75.0
- npm

### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/midea-ai/sema-code-vscode-extension.git
cd sema-code-vscode-extension

# 2. 安装依赖
npm install

# 3. 编译项目
npm run compile

# 4. 在 VSCode 中按 F5 启动调试
#    这将打开一个新的 Extension Development Host 窗口
```

## 构建系统

### Webpack 配置

项目使用 4 个独立的 Webpack 配置，分别构建不同的目标产物：

| 配置 | 目标 | 入口 | 产物 |
|||||
| `extensionConfig` | Node.js | `src/extension.ts` | `dist/extension.js` |
| `chatWebviewConfig` | Web | `src/webview/chat/index.tsx` | `dist/webview/chat.js` |
| `configWebviewConfig` | Web | `src/webview/config/index.tsx` | `dist/webview/config.js` |
| `sessionHistoryWebviewConfig` | Web | `src/webview/sessionHistory/index.tsx` | `dist/webview/sessionHistory.js` |

### 编译差异

- **Extension 代码**：使用 `ts-loader` + `tsconfig.json`，目标为 CommonJS
- **Webview 代码**：使用 `babel-loader` + `.babelrc.json`，支持 JSX/TSX 转译
- **外部模块**：`vscode` 和 `@vscode/ripgrep` 标记为 externals，不打包

### 产物结构

```
dist/
├── extension.js              # Extension Host 代码
└── webview/
    ├── chat.js               # 聊天界面
    ├── config.js             # 配置面板
    └── sessionHistory.js     # 会话历史面板
```




## 打包与发布

### 多平台打包

```bash
# 使用脚本打包所有平台
./package-all.sh

# 产出文件格式：
# sema-vscode-extension-darwin-x64-<version>.vsix
# sema-vscode-extension-darwin-arm64-<version>.vsix
# sema-vscode-extension-linux-x64-<version>.vsix
# sema-vscode-extension-win32-x64-<version>.vsix
```

### 发布到 Marketplace

```bash
# 需要先登录或使用 PAT
vsce login <publisher>

# 发布所有平台包
for vsix in sema-vscode-extension-*.vsix; do
    vsce publish --packagePath "$vsix"
done
```

### .vscodeignore

打包时排除开发相关文件（源码、配置文件等），仅包含 `dist/` 产物和必要资源。



## 调试指南

### 调试 Webview

- 在 Extension Development Host 窗口中，按 `Ctrl+Shift+P`
- 执行 `Developer: Open Webview Developer Tools`
- 可以在浏览器开发者工具中调试 React 组件

### 预览模式（Preview Mode）

项目内置了一套 Mock 预览系统，可以在**不启动 sema-core 后端**的情况下独立预览和调试所有 UI 组件的渲染效果。这对于样式调整、新组件开发和 UI 走查非常有用。

**相关文件：**
- `src/webview/chat/utils/mockMessages.ts` — Mock 数据定义与预览控制开关
- `src/webview/chat/utils/PreviewDialogs.tsx` — 弹窗类组件的预览容器
- `src/webview/chat/App.tsx` — 根组件中集成预览模式的渲染逻辑

**使用方式：**

通过修改 `mockMessages.ts` 中的 `PREVIEW_COMPONENTS` 常量来控制预览范围：

```typescript
// 预览所有组件（消息块 + 弹窗）
export const PREVIEW_COMPONENTS: string[] | null = null;

// 只预览指定组件
export const PREVIEW_COMPONENTS: string[] | null = ['run_shell'];

// 关闭预览（正常模式，默认值）
export const PREVIEW_COMPONENTS: string[] | null = [];
```

修改后重新编译（`npm run compile`）并 Reload Window 即可看到效果。

