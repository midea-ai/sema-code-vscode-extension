package com.sema.sidecar

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * rg / node 等外部依赖 provisioner 的公共设施：平台探测、登录 shell 真实 PATH、
 * PATH 内可执行文件查找、版本探测、下载 / 解压 / 去隔离。
 *
 * 统一分发范式（三条要求）：
 *   本地优先（登录 shell 真实 PATH 里探到就用）→ ~/.sema 私有缓存命中 → 按需下载到私有缓存。
 *
 * 全程只写 `~/.sema` 私有缓存、只被前置进 sidecar **子进程** 的 PATH；绝不改系统 PATH、
 * 系统目录（/usr/local/bin、/opt/homebrew…）或 shell 配置，复用系统二进制时只读执行——
 * 因此不会影响用户在插件之外安装或使用 node / rg。
 */
object BinaryProvisioner {
    val osName: String = System.getProperty("os.name").lowercase()
    val isWindows = osName.contains("win")
    val isMac = osName.contains("mac") || osName.contains("darwin")
    val isLinux = osName.contains("nux")
    private val arch = System.getProperty("os.arch").lowercase()
    val isArm = arch.contains("aarch64") || arch.contains("arm64")
    val isX64 = arch.contains("amd64") || arch.contains("x86_64") || arch == "x64"

    /** `~/.sema` 私有缓存根。 */
    fun semaHome(): File? = System.getProperty("user.home")?.let { File(it, ".sema") }

    // 登录 shell 真实 PATH 只解析一次（含 nvm/homebrew/volta），绕开 launchd 精简 PATH。
    @Volatile private var loginPathResolved = false
    @Volatile private var loginPathCached: String? = null

    /**
     * 问登录 shell 要真实 PATH（`$SHELL -ilc`），绕开 IDE 从 Finder/图标启动时只继承的 launchd
     * 精简 PATH。本地优先探测 rg/node 都基于它，否则装了也探不到。结果缓存，进程内只解析一次。
     */
    @Synchronized
    fun loginShellPath(): String? {
        if (loginPathResolved) return loginPathCached
        loginPathResolved = true
        loginPathCached = if (isWindows) null else runCatching {
            val shell = System.getenv("SHELL") ?: "/bin/zsh"
            val p = ProcessBuilder(shell, "-ilc", "printf '__SEMA_PATH__:%s\\n' \"\$PATH\"")
                .redirectErrorStream(false).start()
            val out = p.inputStream.bufferedReader().readText()
            if (!p.waitFor(5, TimeUnit.SECONDS)) p.destroyForcibly()
            out.lineSequence()
                .firstOrNull { it.startsWith("__SEMA_PATH__:") }
                ?.removePrefix("__SEMA_PATH__:")?.trim()
                ?.takeIf { it.isNotEmpty() }
        }.getOrNull()
        return loginPathCached
    }

    /** 在给定 PATH 串里查找可执行文件（本地优先探测用）；找不到返回 null。 */
    fun whichIn(path: String?, exe: String): File? {
        path?.split(File.pathSeparator)?.forEach { dir ->
            if (dir.isNotBlank()) {
                val f = File(dir, exe)
                if (f.canExecute()) return f
            }
        }
        return null
    }

    /** 跑 `exe args...` 取 stdout（trim 后），非 0 退出或超时返回 null。用于 `--version` 探测。 */
    fun runCapture(exe: String, vararg args: String, timeoutSec: Long = 5): String? = runCatching {
        val p = ProcessBuilder(listOf(exe) + args).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        if (!p.waitFor(timeoutSec, TimeUnit.SECONDS)) { p.destroyForcibly(); return null }
        if (p.exitValue() != 0) null else out.trim()
    }.getOrNull()

    /** 手动跟随重定向（github/nodejs → CDN 302，HttpURLConnection 默认不跨主机跟随）下载到 dest。 */
    fun httpDownload(urlStr: String, dest: File, redirects: Int = 6) {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15000
        conn.readTimeout = 180000
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

    /** 用系统 tar 解压 .tar.gz（mac/linux 自带），保留可执行位与符号链接。strip=剥离的顶层目录层数。 */
    fun untarGz(archive: File, destDir: File, strip: Int = 0) {
        destDir.mkdirs()
        val cmd = arrayListOf("tar", "xzf", archive.absolutePath, "-C", destDir.absolutePath)
        if (strip > 0) cmd.add("--strip-components=$strip")
        val p = ProcessBuilder(cmd).redirectErrorStream(true).start()
        if (!p.waitFor(180, TimeUnit.SECONDS)) { p.destroyForcibly(); throw IllegalStateException("tar 解压超时") }
        if (p.exitValue() != 0) throw IllegalStateException("tar 解压失败（exit ${p.exitValue()}）")
    }

    /** 纯 JVM 解压 zip（Windows 无 tar 兜底）。 */
    fun unzip(archive: File, destDir: File) {
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

    /** macOS 去隔离，避免 Gatekeeper 拦下载来的二进制（只对我们下载的那份做，绝不碰系统二进制）。 */
    fun dequarantine(file: File) {
        if (!isMac) return
        runCatching {
            ProcessBuilder("xattr", "-dr", "com.apple.quarantine", file.absolutePath)
                .start().waitFor(10, TimeUnit.SECONDS)
        }
    }
}
