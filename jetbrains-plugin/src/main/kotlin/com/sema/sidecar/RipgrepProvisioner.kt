package com.sema.sidecar

import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * 首启按平台准备 ripgrep 二进制（对齐 VSCode package-all.sh / pet 的分发范式）。
 *
 * sema-core 只通过 **PATH** 定位 rg（无 env/config 注入点），故这里只负责把对应平台的 rg
 * 落到 `~/.sema/rg` 缓存，返回其所在目录，由 [SidecarProcess] 前置进 sidecar 子进程的 PATH。
 *
 * 分发策略（方案「丙」）：插件包不含 rg，首次运行从 ripgrep 官方 Release 下载并缓存。
 * - 内网/离线：`SEMA_RG_BASE_URL` / `-Dsema.rg.baseUrl` 指镜像；或 `SEMA_RG_PATH` 直接指定现成 rg。
 * - 版本对齐 package-all.sh 的 RG_VERSION=14.1.0（CLI 与 sema-core 内置 13.x 兼容）。
 *
 * 说明：始终提供自带的 rg 并前置进 PATH（而非依赖系统 rg），可绕开「IDE 从图标/Finder 启动时
 * 读不到登录 shell PATH」这一经典问题，行为可预测。
 */
object RipgrepProvisioner {
    private val log = logger<RipgrepProvisioner>()

    private const val RG_VERSION = "14.1.0" // 对齐 package-all.sh
    private const val DEFAULT_BASE = "https://github.com/BurntSushi/ripgrep/releases/download"

    private val osName = System.getProperty("os.name").lowercase()
    private val isWindows = osName.contains("win")
    private val isMac = osName.contains("mac") || osName.contains("darwin")
    private val rgName = if (isWindows) "rg.exe" else "rg"

    /** ripgrep Release 资产：triple 对应文件名，zip=true 为 .zip（win），否则 .tar.gz。 */
    private data class Asset(val triple: String, val zip: Boolean)

    private fun assetFor(): Asset? {
        val arch = System.getProperty("os.arch").lowercase()
        val isArm = arch.contains("aarch64") || arch.contains("arm64")
        val isX64 = arch.contains("amd64") || arch.contains("x86_64") || arch == "x64"
        return when {
            isMac -> when {
                isArm -> Asset("aarch64-apple-darwin", false)
                isX64 -> Asset("x86_64-apple-darwin", false)
                else -> null
            }
            isWindows -> if (isX64 || isArm) Asset("x86_64-pc-windows-msvc", true) else null // win arm64 走 x64 仿真
            osName.contains("nux") -> when {
                isArm -> Asset("aarch64-unknown-linux-gnu", false)
                isX64 -> Asset("x86_64-unknown-linux-musl", false)
                else -> null
            }
            else -> null
        }
    }

    /**
     * 确保 rg 可用，返回其**所在目录**（供前置进 PATH）；无法提供时返回 null（sidecar 仍会尝试
     * 用继承的 PATH 里的 rg，只是没有兜底）。
     * 优先级：SEMA_RG_PATH 显式指定 → 缓存命中 → 下载。
     */
    @Synchronized
    fun ensureRgDir(): File? {
        // 1) 显式指定（内网/离线）
        val override = System.getenv("SEMA_RG_PATH") ?: System.getProperty("sema.rg.path")
        if (override != null) {
            val f = File(override)
            val dir = if (f.isDirectory) f else f.parentFile
            if (dir != null && File(dir, rgName).exists()) return dir
            log.warn("[sema] SEMA_RG_PATH 指定但未找到 $rgName: $override")
        }

        val cacheDir = cacheDir() ?: return null
        val cached = File(cacheDir, rgName)
        if (cached.exists() && (isWindows || cached.canExecute())) return cacheDir

        return runCatching { download(cacheDir) }.getOrElse {
            log.warn("[sema] ripgrep 准备失败：${it.message}", it)
            null
        }
    }

    private fun cacheDir(): File? {
        val asset = assetFor()
        if (asset == null) {
            log.warn("[sema] 不支持的平台，无法准备 ripgrep: $osName/${System.getProperty("os.arch")}")
            return null
        }
        val home = System.getProperty("user.home") ?: return null
        return File(home, ".sema/rg/$RG_VERSION/${asset.triple}")
    }

    private fun download(cacheDir: File): File {
        val asset = assetFor() ?: throw IllegalStateException("不支持的平台")
        val base = (System.getenv("SEMA_RG_BASE_URL") ?: System.getProperty("sema.rg.baseUrl") ?: DEFAULT_BASE).trimEnd('/')
        val ext = if (asset.zip) "zip" else "tar.gz"
        val fileName = "ripgrep-$RG_VERSION-${asset.triple}.$ext"
        val url = "$base/$RG_VERSION/$fileName"
        log.info("[sema] 首启下载 ripgrep: $url")

        val tmp = Files.createTempDirectory("sema-rg").toFile()
        try {
            val archive = File(tmp, fileName)
            httpDownload(url, archive)

            val extractDir = File(tmp, "x").apply { mkdirs() }
            if (asset.zip) unzip(archive, extractDir) else untarGz(archive, extractDir)

            val rg = extractDir.walkTopDown().firstOrNull { it.isFile && it.name == rgName }
                ?: throw IllegalStateException("解压后未找到 $rgName")

            cacheDir.mkdirs()
            val dest = File(cacheDir, rgName)
            Files.copy(rg.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
            if (!isWindows) {
                dest.setExecutable(true, false)
                if (isMac) {
                    // 去隔离，避免 Gatekeeper 拦截
                    runCatching {
                        ProcessBuilder("xattr", "-dr", "com.apple.quarantine", dest.absolutePath)
                            .start().waitFor(10, TimeUnit.SECONDS)
                    }
                }
            }
            log.info("[sema] ripgrep 就绪: ${dest.absolutePath}")
            return cacheDir
        } finally {
            tmp.deleteRecursively()
        }
    }

    /** 手动跟随重定向（github → CDN 302），HttpURLConnection 默认不跨主机跟随。 */
    private fun httpDownload(urlStr: String, dest: File, redirects: Int = 6) {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15000
        conn.readTimeout = 120000
        conn.setRequestProperty("User-Agent", "sema-jetbrains-plugin")
        try {
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location") ?: throw IllegalStateException("重定向缺 Location")
                if (redirects <= 0) throw IllegalStateException("重定向过多")
                conn.disconnect()
                httpDownload(loc, dest, redirects - 1)
                return
            }
            if (code != 200) throw IOException("HTTP $code: $urlStr")
            conn.inputStream.use { input -> dest.outputStream().use { input.copyTo(it) } }
        } finally {
            conn.disconnect()
        }
    }

    private fun untarGz(archive: File, destDir: File) {
        // 用系统 tar（mac/linux 均自带），保留可执行位
        val p = ProcessBuilder("tar", "xzf", archive.absolutePath, "-C", destDir.absolutePath)
            .redirectErrorStream(true).start()
        if (!p.waitFor(120, TimeUnit.SECONDS)) {
            p.destroyForcibly()
            throw IllegalStateException("tar 解压超时")
        }
        if (p.exitValue() != 0) throw IllegalStateException("tar 解压失败（exit ${p.exitValue()}）")
    }

    private fun unzip(archive: File, destDir: File) {
        ZipInputStream(archive.inputStream().buffered()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val out = File(destDir, entry.name)
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zis.copyTo(it) }
                }
                entry = zis.nextEntry
            }
        }
    }
}
