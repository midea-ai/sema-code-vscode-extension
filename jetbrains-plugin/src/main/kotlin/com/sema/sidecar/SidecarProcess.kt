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
 * 运行时：系统 node 跑打包后的单文件 `server.js`（esbuild 产物，无需 node_modules）。
 * - rg（ripgrep）由 [RipgrepProvisioner] 首启下载后前置进子进程 PATH（sema-core 只认 PATH）。
 * - SEMA_BRIDGE_PORT=0 让系统分配空闲端口，避免多个 IDE 窗口撞端口。
 *
 * boot（含 rg 首启下载）在独立守护线程执行，绝不阻塞 EDT。
 */
class SidecarProcess(
    private val sidecarDir: File,   // 含 server.js 的目录（打包：resources/sidecar；dev：sema-grpc）
    private val workingDir: String, // Agent 操作的目标工程路径
) {
    private val log = logger<SidecarProcess>()
    @Volatile private var process: Process? = null
    private val portFuture = CompletableFuture<Int>()
    private val isWindows = System.getProperty("os.name").lowercase().contains("win")

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
            env["SEMA_WORKING_DIR"] = workingDir

            // 组装子进程 PATH：rg 目录 > 登录 shell 的 PATH > IDE 继承的 PATH。
            // 关键：IDE 从 Finder/图标启动时只继承 launchd 的精简 PATH，读不到 nvm/homebrew 的 node/git。
            // 主动问登录 shell 要真实 PATH（`$SHELL -ilc`），node/git/pdftotext 一并解决。
            val pathKey = env.keys.firstOrNull { it.equals("PATH", ignoreCase = true) } ?: "PATH"
            val parts = ArrayList<String>()
            val rgDir = runCatching { RipgrepProvisioner.ensureRgDir() }.getOrNull()
            if (rgDir != null) parts.add(rgDir.absolutePath)
            else log.warn("[sema] 未能准备 ripgrep，将依赖 PATH 里的 rg（搜索/插件加载可能受影响）")
            (loginShellPath() ?: env[pathKey])?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
            env[pathKey] = parts.joinToString(File.pathSeparator)

            val node = resolveNode(env[pathKey])
            val proc = try {
                pb.command()[0] = node
                pb.start()
            } catch (e: IOException) {
                portFuture.completeExceptionally(
                    IllegalStateException(
                        "无法启动 sidecar：未找到可执行的 node。请安装 Node.js 18+；" +
                            "若已装，通常是 IDE 从 Finder/图标启动读不到终端 PATH——从终端启动 IDE，" +
                            "或设 `SEMA_NODE_PATH` 指向 node 可执行文件。",
                        e
                    )
                )
                return
            }
            process = proc

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

    /**
     * 解析 node 的**绝对路径**。注意：Java 的 ProcessBuilder 用**父进程** PATH 解析命令名，
     * 改子进程 env 的 PATH 不影响命令名解析——所以必须自己在拼好的 PATH 里定位 node 绝对路径。
     */
    private fun resolveNode(path: String?): String {
        (System.getenv("SEMA_NODE_PATH") ?: System.getProperty("sema.node.path"))?.let {
            if (File(it).canExecute()) return it
        }
        val exe = if (isWindows) "node.exe" else "node"
        path?.split(File.pathSeparator)?.forEach { dir ->
            if (dir.isNotBlank()) File(dir, exe).takeIf { it.canExecute() }?.let { return it.absolutePath }
        }
        listOf("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node")
            .firstOrNull { File(it).canExecute() }?.let { return it }
        return "node"
    }

    /** 问登录 shell 要真实 PATH（含 nvm/homebrew/volta），绕开 launchd 精简 PATH。 */
    private fun loginShellPath(): String? {
        if (isWindows) return null
        return try {
            val shell = System.getenv("SHELL") ?: "/bin/zsh"
            val p = ProcessBuilder(shell, "-ilc", "printf '__SEMA_PATH__:%s\\n' \"\$PATH\"")
                .redirectErrorStream(false).start()
            val out = p.inputStream.bufferedReader().readText()
            if (!p.waitFor(5, TimeUnit.SECONDS)) p.destroyForcibly()
            out.lineSequence()
                .firstOrNull { it.startsWith("__SEMA_PATH__:") }
                ?.removePrefix("__SEMA_PATH__:")?.trim()
                ?.takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }
    }

    fun stop() {
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
