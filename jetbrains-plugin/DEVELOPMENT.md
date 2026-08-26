# Sema Code JetBrains 插件 开发文档

## 前置

JDK 17 · Node.js 18+（本地有则复用，无则首启按平台自动下载）
主工程 `npm run compile` 默认已执行

通信层与 sidecar 托管来自 sema-core Java SDK（maven 依赖 `io.github.midea-ai:sema-core`，
桥产物内嵌其 jar，运行时自动释放），gradle 自动从 Maven Central 拉取
`gradle.properties` 里 `semaCoreSdkVersion` 指定的版本，无需本地构建。

## 沙箱调试

起沙箱 IDE：

```bash
cd jetbrains-plugin
./gradlew --no-daemon runIde

# SEMA_JCEF_DEVTOOLS=1 ./gradlew --no-daemon runIde  # 弹前端 DevTools
# ./gradlew --no-daemon runIde -PplatformType=PC  # 指定PyCharm社区平台
# 平台代码：IC=IDEA社区(默认) IU=IDEA旗舰 PC=PyCharm社区 PY=PyCharm专业 GO=GoLand WS=WebStorm CL=CLion
```

### 用本地 sema-core 验证（未发版时）

sidecar 是「桥 + core」的 esbuild 单文件，Java SDK 只是透明传输层——换 core 只需重打桥产物，不用动 `semaCoreSdkVersion`：

```bash
# sema-core 打包
cd <sema-core>
npm run build && npm pack              # 本地 core 打成 tgz
cd sdks/shared/bridge && npm install --no-save ../../../sema-core-*.tgz && npm run build

# 本项目重新编译
rm -rf ~/.sema/java-sdk-sidecar                          # 清掉 jar 释放的旧缓存
cd jetbrains-plugin
SEMA_SIDECAR_DIR=$PWD/../../sema-core/sdks/shared/bridge/dist ./gradlew --no-daemon runIde
```

## 打包安装

打插件 zip：

```bash
cd jetbrains-plugin
./gradlew buildPlugin  # sema-jetbrains-plugin-0.1.0.zip
```

- 运行时依赖（node / rg）统一范式：**本地有就用本地 → 没有按平台下载到 `~/.sema/{node,rg}/`**（node 由 SDK 供应、rg 由桥进程供应；私有缓存，不写系统目录 / 不改 shell 配置，不影响插件外的 node/rg）。
  - node：需 ≥18；`SEMA_NODE_PATH` 指现成 node、`SEMA_NODE_BASE_URL` 指镜像（默认 nodejs.org）。
  - rg：`SEMA_RG_PATH` 指现成 rg、`SEMA_RG_BASE_URL` 指镜像（默认 GitHub Release）。
