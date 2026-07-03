# Sema Code JetBrains 插件 开发文档

## 前置

JDK 17 · Node.js 18.x+（复用系统 node）
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

# 弹前端 DevTools
# SEMA_SIDECAR_DIR="$(cd sema-grpc && pwd)" SEMA_JCEF_DEVTOOLS=1 ./gradlew --no-daemon runIde

# 指定平台 例：起 PyCharm 社区版沙箱
# SEMA_SIDECAR_DIR="$(cd sema-grpc && pwd)" ./gradlew --no-daemon runIde -PplatformType=PC  
# 平台代码：IC=IDEA社区(默认) IU=IDEA旗舰 PC=PyCharm社区 PY=PyCharm专业 GO=GoLand WS=WebStorm CL=CLion
```

## 改代码后重跑

改完对应部分，重跑上面的沙箱命令即可：

- 改 Kotlin（`src/main/kotlin/**`）：无需手动，`runIde` 自动重编
- 改前端（`../src/webview/**`，含 `jb/`）：主工程根 `npm run compile`
- 改 sema-grpc（`sema-grpc/src/**`）：`sema-grpc/` 下 `npm run build`

## 打包安装

打插件 zip：

```bash
# cd jetbrains-plugin/
./gradlew buildPlugin  # → jetbrains-plugin/*.zip
```

- 装：`Settings → Plugins → ⚙️ → Install Plugin from Disk` → 选 zip → 重启
- 运行时：系统 node 跑 sidecar；rg 首启按平台下载到 `~/.sema/rg/`（内网用 `SEMA_RG_BASE_URL` 指镜像 / `SEMA_RG_PATH` 指现成 rg）

## 发布 Marketplace

本地打包+签名+上传（需 `CERTIFICATE_CHAIN` / `PRIVATE_KEY` / `PUBLISH_TOKEN` 环境变量）：

```bash
# cd jetbrains-plugin/
CERTIFICATE_CHAIN=... PRIVATE_KEY=... PRIVATE_KEY_PASSWORD=... PUBLISH_TOKEN=... ./gradlew publishPlugin
```