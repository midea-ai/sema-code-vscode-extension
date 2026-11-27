# Sema Code VSCode Extension 开发文档

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

> 桌宠二进制与 ripgrep 不再打进扩展包：
> - **ripgrep**：运行时优先复用 VS Code 本体内置的 `rg`，其次使用系统 `PATH` 或 `~/.sema/rg/` 缓存，全部缺失时按需下载。
> - **桌宠**：启用桌宠时自动从 GitHub `pet-assets` Release 按需下载到 `~/.sema/pet/bin/`；若改了桌宠源码需本地验证，可运行 `npm run pet:build`（产物落 `dist/pet/`，F5 调试时 launcher 会优先使用本地 zip，打包 VSIX 时会被 `.vscodeignore` 排除）。

## 构建系统
### 打包（全平台通用 VSIX）

```bash
npm run compile
npm run package   # 或 ./package-all.sh

# 产出单个全平台通用包：
# sema-vscode-extension-<version>.vsix
```

### .vscodeignore

打包时排除开发相关文件（源码、配置文件等），仅包含 `dist/` 产物和必要资源。

## 调试指南

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

