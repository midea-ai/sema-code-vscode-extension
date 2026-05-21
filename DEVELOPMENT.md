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

# 3. 准备桌宠 zip（→ dist/pet/）—— 二选一
npm run pet:fetch     # 从 pet-assets Release 拉全平台最新 zip（发布扩展用）
npm run pet:build     # 现场编译当前平台桌宠（改了桌宠源码 / F5 调试用）
#   详细说明见 pet/README.md
#   准备好的 zip 落在 dist/pet/，各平台对应：
#     dist/pet/sema-pet-darwin-arm64.zip   # macOS Apple Silicon
#     dist/pet/sema-pet-darwin-x64.zip     # macOS Intel
#     dist/pet/sema-pet-win32-x64.zip      # Windows x64
#   （pet:build 只产出当前平台那一份；pet:fetch 三份齐全）

# 4. 编译项目
npm run compile

# 5. 在 VSCode 中按 F5 启动调试
#    这将打开一个新的 Extension Development Host 窗口
```

> 发布扩展走 `npm run pet:fetch`：桌宠 zip 以 `pet-assets` Release 上的为准，三平台齐全。
> `npm run pet:build` 只编译当前平台（Mac 上出不了 Windows 桌宠），用于改桌宠源码后本地验证。

## 构建系统
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

> package-all.sh 给每个平台 vsix 只塞它自己那一份桌宠 zip（linux 无桌宠），`dist/pet/` 在打包结束后恢复成全部 zip。

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

