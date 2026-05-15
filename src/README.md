```sh
# 1. 安装依赖
npm install

# 2. 打桌宠 zip（首次必跑；改桌宠源码后重跑。详细说明见 pet/README.md）
npm run pet:build
# 产物：
#   pet/macos/.build/arm64-apple-macosx/release/sema-pet-darwin-arm64.zip
#   pet/macos/.build/x86_64-apple-macosx/release/sema-pet-darwin-x64.zip

# 3. 编译（webpack + 自动 cp 桌宠 zip → dist/pet/）
npm run compile

# 4. 按 F5 启动调试

# 5. 打包（平台专属包）
./package-all.sh
# 输出到 sema-vscode-extension-darwin-x64-<version>.vsix 等文件
```