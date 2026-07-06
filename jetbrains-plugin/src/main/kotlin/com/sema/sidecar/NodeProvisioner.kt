package com.sema.sidecar

import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.nio.file.Files

/**
 * 按统一分发范式准备 node：**本地优先 → 缓存命中 → 按需下载**（对齐 [BinaryProvisioner]）。
 *
 * sidecar 产物 `server.js` 已由 esbuild 打成零 node_modules 单文件，运行只差一个 node 可执行文件：
 * - 本地优先：登录 shell 真实 PATH 里探到 **≥18** 的系统 node 就直接用（很多开发者本就装了，省下载）。
 * - 缓存 / 下载：从 nodejs.org 官方 Release 按平台下到 `~/.sema/node/$NODE_VERSION/$triple/`；
 *   内网用 `SEMA_NODE_BASE_URL` 指镜像、`SEMA_NODE_PATH` 直接指现成 node。
 *
 * 全程只写私有缓存、只前置进 sidecar 子进程 PATH，不影响用户在插件之外安装或使用 node。
 */
object NodeProvisioner {
    private val log = logger<NodeProvisioner>()

    private const val NODE_VERSION = "20.18.0" // LTS；满足 sema-core 的 node18 目标（前向兼容）
    private const val MIN_MAJOR = 18
    private const val DEFAULT_BASE = "https://nodejs.org/dist"
    private val nodeExe = if (BinaryProvisioner.isWindows) "node.exe" else "node"

    /** nodejs.org 资产：triple 对应文件名片段，zip=true 为 .zip（win），否则 .tar.gz。 */
    private data class Asset(val triple: String, val zip: Boolean)

    private fun assetFor(): Asset? = when {
        BinaryProvisioner.isMac -> when {
            BinaryProvisioner.isArm -> Asset("darwin-arm64", false)
            BinaryProvisioner.isX64 -> Asset("darwin-x64", false)
            else -> null
        }
        BinaryProvisioner.isWindows -> when {
            BinaryProvisioner.isX64 -> Asset("win-x64", true)
            BinaryProvisioner.isArm -> Asset("win-arm64", true)
            else -> null
        }
        BinaryProvisioner.isLinux -> when {
            BinaryProvisioner.isArm -> Asset("linux-arm64", false)
            BinaryProvisioner.isX64 -> Asset("linux-x64", false)
            else -> null
        }
        else -> null
    }

    /**
     * 解析要用的 node 可执行文件**绝对路径**；无法提供时返回 null（调用方据此报错引导）。
     * 优先级：SEMA_NODE_PATH 显式 → searchPath 里 ≥18 的本地 node → 常见绝对路径 → 缓存 → 下载。
     * @param searchPath 供本地优先探测的 PATH（通常是登录 shell 真实 PATH）
     */
    @Synchronized
    fun ensureNode(searchPath: String?): String? {
        // 1) 显式指定
        (System.getenv("SEMA_NODE_PATH") ?: System.getProperty("sema.node.path"))?.let {
            val f = File(it)
            if (f.canExecute()) return f.absolutePath
            log.warn("[sema] SEMA_NODE_PATH 指定但不可执行: $it")
        }

        // 2) 本地优先：登录 shell 真实 PATH 里的 node，版本 ≥ MIN_MAJOR 就用
        BinaryProvisioner.whichIn(searchPath, nodeExe)?.let { local ->
            if (majorOf(BinaryProvisioner.runCapture(local.absolutePath, "--version")) >= MIN_MAJOR) {
                log.info("[sema] 复用系统 node: ${local.absolutePath}")
                return local.absolutePath
            }
            log.info("[sema] 系统 node 版本过低（<$MIN_MAJOR），改用缓存/下载")
        }
        // 兜底再看几个常见绝对路径（登录 shell PATH 拿不到时）
        listOf("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node").forEach { p ->
            val f = File(p)
            if (f.canExecute() && majorOf(BinaryProvisioner.runCapture(p, "--version")) >= MIN_MAJOR) {
                log.info("[sema] 复用系统 node: $p")
                return p
            }
        }

        // 3) 缓存命中
        val cacheDir = cacheDir() ?: return null
        cachedNodeExec(cacheDir)?.let { return it.absolutePath }

        // 4) 按需下载
        return runCatching { download(cacheDir).absolutePath }.getOrElse {
            log.warn("[sema] node 准备失败：${it.message}", it)
            null
        }
    }

    /** 从 `node --version`（形如 "v20.18.0"）解析主版本号，失败给 -1。 */
    private fun majorOf(version: String?): Int {
        val v = version?.trim()?.removePrefix("v") ?: return -1
        return v.substringBefore('.').toIntOrNull() ?: -1
    }

    private fun cacheDir(): File? {
        val asset = assetFor()
        if (asset == null) {
            log.warn("[sema] 不支持的平台，无法准备 node: ${BinaryProvisioner.osName}/${System.getProperty("os.arch")}")
            return null
        }
        val home = BinaryProvisioner.semaHome() ?: return null
        return File(home, "node/$NODE_VERSION/${asset.triple}")
    }

    /** 缓存目录里的 node 可执行文件（unix：strip 后固定 bin/node；win：未 strip，递归找 node.exe）。 */
    private fun cachedNodeExec(cacheDir: File): File? {
        if (!cacheDir.exists()) return null
        return if (BinaryProvisioner.isWindows) {
            cacheDir.walkTopDown().firstOrNull { it.isFile && it.name == nodeExe }
        } else {
            File(cacheDir, "bin/node").takeIf { it.canExecute() }
        }
    }

    private fun download(cacheDir: File): File {
        val asset = assetFor() ?: throw IllegalStateException("不支持的平台")
        val base = (System.getenv("SEMA_NODE_BASE_URL") ?: System.getProperty("sema.node.baseUrl") ?: DEFAULT_BASE).trimEnd('/')
        val ext = if (asset.zip) "zip" else "tar.gz"
        val fileName = "node-v$NODE_VERSION-${asset.triple}.$ext"
        val url = "$base/v$NODE_VERSION/$fileName"
        log.info("[sema] 首启下载 node: $url")

        val tmp = Files.createTempDirectory("sema-node").toFile()
        try {
            val archive = File(tmp, fileName)
            BinaryProvisioner.httpDownload(url, archive)
            cacheDir.mkdirs()
            if (asset.zip) {
                // win：解到 cacheDir，node.exe 在 cacheDir/<stem>/ 下（由 cachedNodeExec 递归定位）
                BinaryProvisioner.unzip(archive, cacheDir)
            } else {
                // unix：--strip-components=1 把 bin/ lib/ 直接落到 cacheDir，node 固定在 bin/node
                BinaryProvisioner.untarGz(archive, cacheDir, strip = 1)
            }
            val exec = cachedNodeExec(cacheDir) ?: throw IllegalStateException("解压后未找到 $nodeExe")
            if (!BinaryProvisioner.isWindows) {
                exec.setExecutable(true, false)
                BinaryProvisioner.dequarantine(exec)
            }
            log.info("[sema] node 就绪: ${exec.absolutePath}")
            return exec
        } catch (t: Throwable) {
            cacheDir.deleteRecursively() // 半成品清掉，避免下次误命中
            throw t
        } finally {
            tmp.deleteRecursively()
        }
    }
}
