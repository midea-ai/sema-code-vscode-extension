```sh
# 1. 安装依赖
npm install

# 2. 准备桌宠 zip（→ dist/pet/）—— 二选一
npm run pet:fetch     # 从 pet-assets Release 拉全平台最新 zip（发布扩展用）
npm run pet:build     # 现场编译当前平台桌宠（改了桌宠源码 / F5 调试用）
#   详细说明见 pet/README.md
#   准备好的 zip 落在 dist/pet/，各平台对应：
#     dist/pet/sema-pet-darwin-arm64.zip   # macOS Apple Silicon
#     dist/pet/sema-pet-darwin-x64.zip     # macOS Intel
#     dist/pet/sema-pet-win32-x64.zip      # Windows x64
#   （pet:build 只产出当前平台那一份；pet:fetch 三份齐全）

# 3. 编译（纯 webpack）
npm run compile

# 4. 按 F5 启动调试

# 5. 打包（平台专属包）
./package-all.sh
# 输出到 sema-vscode-extension-darwin-x64-<version>.vsix 等文件
# package-all.sh 给每个平台 vsix 只塞它自己那一份桌宠 zip（linux 无桌宠），
# dist/pet/ 在打包结束后恢复成全部 zip。
```

> 发布扩展走 `npm run pet:fetch`：桌宠 zip 以 `pet-assets` Release 上的为准，三平台齐全。
> `npm run pet:build` 只编译当前平台（Mac 上出不了 Windows 桌宠），用于改桌宠源码后本地验证。
> 两者落点都是 `dist/pet/`，别在同一次发布里混用。
