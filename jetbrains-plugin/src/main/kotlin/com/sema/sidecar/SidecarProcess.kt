package com.sema.sidecar

import com.intellij.openapi.diagnostic.logger
import java.io.BufferedReader
import java.io.File
import java.io.IOException
import java.io.InputStreamReader
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * 拉起 sema-grpc sidecar（Node 进程），读取其 stdout 打印的实际端口。
 *
 * 运行时：node 跑打包后的单文件 `server.js`（esbuild 产物，无需 node_modules）。
 * - node / rg 均按统一范式解析：本地优先 → 缓存 → 按需下载（[NodeProvisioner] / [RipgrepProvisioner]），
 *   解析出的目录前置进子进程 PATH（sema-core 只认 PATH）。
 * - SEMA_BRIDGE_PORT=0 让系统分配空闲端口，避免多个 IDE 窗口撞端口。
 *
 * boot（含 node/rg 首启下载）在独立守护线程执行，绝不阻塞 EDT。
 */
class SidecarProcess(
    private val sidecarDir: File,   // 含 server.js 的目录（打包：resources/sidecar；dev：sema-grpc）
    private val workingDir: String, // Agent 操作的目标工程路径
) {
    private val log = logger<SidecarProcess>()
    @Volatile private var process: Process? = null
    @Volatile private var stopped = false
    private val portFuture = CompletableFuture<Int>()

    fun start(): CompletableFuture<Int> {
        Thread({ boot() }, "sema-sidecar-boot").apply { isDaemon = true }.start()
        return portFuture
    }

    private fun boot() {
        try {
            val serverJs = resolveServerJs()
            if (serverJs == null) {
                portFuture.completeExceptionally(
                    IllegalStateException("sidecar 未找到 server.js（查找目录: ${sidecarDir.absolutePath}）")
                )
                return
            }

            val pb = ProcessBuilder("node", serverJs.absolutePath)
                .directory(serverJs.parentFile)
                .redirectErrorStream(true)
            val env = pb.environment()
            env["SEMA_BRIDGE_PORT"] = "0"
            // 对齐 VSCode 的 uri.fsPath（原生分隔符、已验证可跑）；basePath 是正斜杠，Unix 上 no-op。
            env["SEMA_WORKING_DIR"] = com.intellij.openapi.util.io.FileUtil.toSystemDependentName(workingDir)

            // 搜索用 PATH：登录 shell 真实 PATH（含 nvm/homebrew/volta）> IDE 继承的精简 PATH。
            // 关键：IDE 从 Finder/图标启动时只继承 launchd 精简 PATH，读不到 nvm/homebrew 的 node/git；
            // 本地优先探测 rg/node 都基于它。
            val pathKey = env.keys.firstOrNull { it.equals("PATH", ignoreCase = true) } ?: "PATH"
            val searchPath = (BinaryProvisioner.loginShellPath() ?: env[pathKey])?.takeIf { it.isNotBlank() }

            // 组装子进程 PATH：rg 目录 + node 目录（供 sema-core 再 spawn 的 npx/node/git 命中）> searchPath。
            val parts = ArrayList<String>()
            val rgDir = runCatching { RipgrepProvisioner.ensureRgDir(searchPath) }.getOrNull()
            if (rgDir != null) parts.add(rgDir.absolutePath)
            else log.warn("[sema] 未能准备 ripgrep，将依赖 PATH 里的 rg（搜索/插件加载可能受影响）")

            val node = runCatching { NodeProvisioner.ensureNode(searchPath) }.getOrNull()
            if (node == null) {
                portFuture.completeExceptionally(
                    IllegalStateException(
                        "无法启动 sidecar：未找到可用的 node（需 ≥18），且按需下载失败。" +
                            "请安装 Node.js 18+，或设 `SEMA_NODE_PATH` 指向 node 可执行文件；" +
                            "内网可设 `SEMA_NODE_BASE_URL` 指向 node 镜像。"
                    )
                )
                return
            }
            File(node).parentFile?.let { parts.add(it.absolutePath) }
            searchPath?.let { parts.add(it) }
            env[pathKey] = parts.joinToString(File.pathSeparator)

            val proc = try {
                pb.command()[0] = node
                pb.start()
            } catch (e: IOException) {
                portFuture.completeExceptionally(
                    IllegalStateException("无法启动 sidecar：node 启动失败（$node）", e)
                )
                return
            }
            process = proc
            // 竞态兜底：boot 期间（如首启下载 node）项目已关闭、stop() 先行 → 进程刚起就回收，不留孤儿。
            if (stopped) {
                proc.destroy()
                return
            }

            // 本线程直接读 stdout（阻塞本 boot 线程即可，无需再开线程）。
            BufferedReader(InputStreamReader(proc.inputStream)).useLines { lines ->
                for (line in lines) {
                    log.info("[sidecar] $line")
                    val m = PORT_REGEX.find(line)
                    if (m != null && !portFuture.isDone) {
                        portFuture.complete(m.groupValues[1].toInt())
                    }
                }
            }
            // stdout 结束（进程退出）后若仍未拿到端口，视为启动失败。
            if (!portFuture.isDone) {
                portFuture.completeExceptionally(IllegalStateException("sidecar 进程退出前未上报端口"))
            }
        } catch (t: Throwable) {
            if (!portFuture.isDone) portFuture.completeExceptionally(t)
        }
    }

    /** 兼容三种布局：打包(resources/sidecar/server.js)、dev(sema-grpc/dist/server.js)、旧 tsc(dist/src/server.js)。 */
    private fun resolveServerJs(): File? = listOf(
        File(sidecarDir, "server.js"),
        File(sidecarDir, "dist/server.js"),
        File(sidecarDir, "dist/src/server.js"),
    ).firstOrNull { it.exists() }

    fun stop() {
        stopped = true
        process?.let {
            it.destroy()
            if (!it.waitFor(3, TimeUnit.SECONDS)) it.destroyForcibly()
        }
        process = null
    }

    companion object {
        private val PORT_REGEX = Regex("""SEMA_BRIDGE_PORT_ACTUAL=(\d+)""")
    }
}
