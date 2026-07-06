# Sema Code JetBrains 插件 开发文档

## 前置

JDK 17 · Node.js 18+（本地有则复用，无则首启按平台自动下载）
主工程 `npm run compile` 默认已执行

## 沙箱调试

构建 sidecar（把 sema-grpc + sema-core 打成单文件）：

```bash
# cd jetbrains-plugin/sema-grpc/
npm install           
npm run build         
```

起沙箱 IDE（SEMA_SIDECAR_DIR 指向 sema-grpc）：

```bash
# cd jetbrains-plugin/
SEMA_SIDECAR_DIR="$(cd sema-grpc && pwd)" ./gradlew --no-daemon runIde

# SEMA_SIDECAR_DIR="$(cd sema-grpc && pwd)" SEMA_JCEF_DEVTOOLS=1 ./gradlew --no-daemon runIde  # 弹前端 DevTools
# SEMA_SIDECAR_DIR="$(cd sema-grpc && pwd)" ./gradlew --no-daemon runIde -PplatformType=PC  # 指定PyCharm社区平台
# 平台代码：IC=IDEA社区(默认) IU=IDEA旗舰 PC=PyCharm社区 PY=PyCharm专业 GO=GoLand WS=WebStorm CL=CLion
```

## 打包安装

打插件 zip：

```bash
# cd jetbrains-plugin/
./gradlew buildPlugin  # sema-jetbrains-plugin-0.1.0.zip
```

- 运行时依赖（node / rg）统一范式：**本地有就用本地 → 没有按平台下载到 `~/.sema/{node,rg}/`**（插件私有缓存，不写系统目录 / 不改 shell 配置，不影响插件外的 node/rg）。
  - node：需 ≥18；`SEMA_NODE_PATH` 指现成 node、`SEMA_NODE_BASE_URL` 指镜像（默认 nodejs.org）。
  - rg：`SEMA_RG_PATH` 指现成 rg、`SEMA_RG_BASE_URL` 指镜像（默认 GitHub Release）。
