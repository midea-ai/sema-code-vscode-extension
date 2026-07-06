package com.sema.sidecar

import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * 按统一分发范式准备 ripgrep：**本地优先 → 缓存命中 → 按需下载**（对齐 [BinaryProvisioner]）。
 *
 * sema-core 只通过 **PATH** 定位 rg（无 env/config 注入点），故这里只负责解析出要用的 rg
 * 所在目录，返回给 [SidecarProcess] 前置进 sidecar 子进程的 PATH。
 *
 * - 本地优先：登录 shell 真实 PATH 里探到能跑的系统 rg 就直接用（不再无脑下载自带版）。
 * - 缓存 / 下载：`~/.sema/rg/$RG_VERSION/$triple/rg`；内网用 `SEMA_RG_BASE_URL` 指镜像、
 *   `SEMA_RG_PATH` 直接指现成 rg。版本对齐 package-all.sh 的 RG_VERSION=14.1.0。
 */
object RipgrepProvisioner {
    private val log = logger<RipgrepProvisioner>()

    private const val RG_VERSION = "14.1.0" // 对齐 package-all.sh
    private const val DEFAULT_BASE = "https://github.com/BurntSushi/ripgrep/releases/download"
    private val rgName = if (BinaryProvisioner.isWindows) "rg.exe" else "rg"

    /** ripgrep Release 资产：triple 对应文件名，zip=true 为 .zip（win），否则 .tar.gz。 */
    private data class Asset(val triple: String, val zip: Boolean)

    private fun assetFor(): Asset? = when {
        BinaryProvisioner.isMac -> when {
            BinaryProvisioner.isArm -> Asset("aarch64-apple-darwin", false)
            BinaryProvisioner.isX64 -> Asset("x86_64-apple-darwin", false)
            else -> null
        }
        // win arm64 走 x64 仿真
        BinaryProvisioner.isWindows ->
            if (BinaryProvisioner.isX64 || BinaryProvisioner.isArm) Asset("x86_64-pc-windows-msvc", true) else null
        BinaryProvisioner.isLinux -> when {
            BinaryProvisioner.isArm -> Asset("aarch64-unknown-linux-gnu", false)
            BinaryProvisioner.isX64 -> Asset("x86_64-unknown-linux-musl", false)
            else -> null
        }
        else -> null
    }

    /**
     * 解析要用的 rg **所在目录**（供前置进 PATH）；无法提供时返回 null（sidecar 仍会靠继承 PATH
     * 里的 rg，只是没兜底）。
     * 优先级：SEMA_RG_PATH 显式 → searchPath 里的本地 rg（能跑就用）→ 缓存命中 → 下载。
     * @param searchPath 供本地优先探测的 PATH（通常是登录 shell 真实 PATH）
     */
    @Synchronized
    fun ensureRgDir(searchPath: String?): File? {
        // 1) 显式指定（内网/离线）
        val override = System.getenv("SEMA_RG_PATH") ?: System.getProperty("sema.rg.path")
        if (override != null) {
            val f = File(override)
            val dir = if (f.isDirectory) f else f.parentFile
            if (dir != null && File(dir, rgName).exists()) return dir
            log.warn("[sema] SEMA_RG_PATH 指定但未找到 $rgName: $override")
        }

        // 2) 本地优先：登录 shell 真实 PATH 里探到系统 rg 且能跑，直接用其所在目录
        BinaryProvisioner.whichIn(searchPath, rgName)?.let { local ->
            if (BinaryProvisioner.runCapture(local.absolutePath, "--version") != null) {
                log.info("[sema] 复用系统 ripgrep: ${local.absolutePath}")
                return local.parentFile
            }
        }

        // 3) 缓存命中
        val cacheDir = cacheDir() ?: return null
        val cached = File(cacheDir, rgName)
        if (cached.exists() && (BinaryProvisioner.isWindows || cached.canExecute())) return cacheDir

        // 4) 按需下载
        return runCatching { download(cacheDir) }.getOrElse {
            log.warn("[sema] ripgrep 准备失败：${it.message}", it)
            null
        }
    }

    private fun cacheDir(): File? {
        val asset = assetFor()
        if (asset == null) {
            log.warn("[sema] 不支持的平台，无法准备 ripgrep: ${BinaryProvisioner.osName}/${System.getProperty("os.arch")}")
            return null
        }
        val home = BinaryProvisioner.semaHome() ?: return null
        return File(home, "rg/$RG_VERSION/${asset.triple}")
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
            BinaryProvisioner.httpDownload(url, archive)

            val extractDir = File(tmp, "x").apply { mkdirs() }
            if (asset.zip) BinaryProvisioner.unzip(archive, extractDir) else BinaryProvisioner.untarGz(archive, extractDir)

            val rg = extractDir.walkTopDown().firstOrNull { it.isFile && it.name == rgName }
                ?: throw IllegalStateException("解压后未找到 $rgName")

            cacheDir.mkdirs()
            val dest = File(cacheDir, rgName)
            Files.copy(rg.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
            if (!BinaryProvisioner.isWindows) {
                dest.setExecutable(true, false)
                BinaryProvisioner.dequarantine(dest)
            }
            log.info("[sema] ripgrep 就绪: ${dest.absolutePath}")
            return cacheDir
        } finally {
            tmp.deleteRecursively()
        }
    }
}
