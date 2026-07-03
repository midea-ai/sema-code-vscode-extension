package com.sema.editor

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.comparison.ComparisonManager
import com.intellij.diff.comparison.ComparisonPolicy
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.progress.DumbProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import java.io.File
import java.security.MessageDigest

/**
 * 编辑器侧操作（VFS / diff / 打开文件 / 快照回滚）。
 *
 * 对标 VSCode 端 FileStateDiffManager：sema-core 子进程直接写盘，宿主只做两件事——
 * (a) write/edit 完成后用 patch 反推出改动前的原始内容存快照；(b) 用户点「拒绝」时用快照写回或删除。
 * 「决定给哪个文件拍快照」的编排在 webview 的 controller.ts，这里只做实际 fs + diff。
 *
 * 两个跨进程坑（VSCode 同进程没有，JB 必须绕）：
 * - 快照不能靠「读文件时抓」：sidecar 独立进程写盘，异步桥抓快照有竞态会抓到写后内容。
 *   改为从「写后磁盘内容 + 反向套用 patch」反推原始内容 → race-free。
 * - 读「当前内容」一律直读磁盘（File.readText），不走 VFS：VFS 不知道外部进程的写入，会返回陈旧内容。
 */
class EditorOps(
    private val project: Project,
    private val pushToWeb: (String) -> Unit,
) {
    private val log = logger<EditorOps>()
    private val gson = Gson()

    private data class Snapshot(val hash: String, val size: Long, val tempFile: File)

    /** key = 绝对路径 */
    private val snapshots = HashMap<String, Snapshot>()
    private val tempDir: File = File(System.getProperty("java.io.tmpdir"), "sema-snapshots-jb")

    fun handle(msg: JsonObject) {
        when (val type = str(msg, "type")) {
            "openFile" -> openFile(str(msg, "filePath"), intOr(msg, "line", 0))
            "openExternal" -> openExternal(str(msg, "url"))
            "openConfig" -> openConfig()
            "snapshotFromPatch" -> snapshotFromPatch(str(msg, "filePath"), str(msg, "patchType"), msg.getAsJsonArray("patch"))
            "resetSnapshots" -> resetSnapshots()
            "showFileDiff" -> showFileDiff(str(msg, "filePath"), intOrNull(msg, "minLine"))
            "showPermissionDiff" -> showPermissionDiff(str(msg, "filePath"), msg.getAsJsonObject("diffContent"))
            "revertFiles" -> revertFiles(strList(msg, "filePaths"))
            "revertFile" -> revertFiles(listOfNotNull(str(msg, "filePath")))
            "getFileChangeStats" -> getFileChangeStats(str(msg, "filePath"), str(msg, "sessionId") ?: "")
            else -> log.info("editor op 尚未实现: $type")
        }
    }

    // ─── 打开 ────────────────────────────────────────────────────────────────

    private fun openFile(path: String?, line: Int) {
        val full = resolveFullPath(path) ?: return
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(full) ?: return
        ApplicationManager.getApplication().invokeLater {
            OpenFileDescriptor(project, vf, maxOf(0, line), 0).navigate(true)
        }
    }

    private fun openExternal(url: String?) {
        if (!url.isNullOrBlank()) BrowserUtil.browse(url)
    }

    /** 打开配置页（编辑器主区域的独立 tab，对齐 VSCode 的 createWebviewPanel(ViewColumn.One)）。 */
    private fun openConfig() {
        ApplicationManager.getApplication().invokeLater {
            val vf = com.sema.config.SemaConfigVirtualFile.get(project)
            com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFile(vf, true)
        }
    }

    // ─── 快照 ────────────────────────────────────────────────────────────────

    /**
     * write/edit 完成后，用 patch 反推出改动前的原始内容存快照（幂等）。
     * 关键：不依赖"读文件时抓快照"（那有跨进程竞态会抓到写后内容）。这里从"当前磁盘内容 + 反向套用 patch"
     * 得到原始内容——无论何时执行，当前磁盘都是写后稳定态，反推结果确定，因此 race-free。
     * type='new'（新建文件）无原始内容 → 不存快照（回滚＝删除）。多次编辑只在首次存（保留真正的原始）。
     */
    private fun snapshotFromPatch(filePath: String?, patchType: String?, patch: com.google.gson.JsonArray?) {
        val full = resolveFullPath(filePath) ?: return
        if (snapshots.containsKey(full)) return
        if (patchType == "new" || patch == null) return
        val src = File(full)
        if (!src.isFile) return
        val current = runCatching { src.readText() }.getOrNull() ?: return
        val original = reverseApplyPatch(current, patch) ?: run {
            log.warn("[sema] snapshotFromPatch 反推失败（patch 位置对不上）: $full")
            return
        }
        try {
            tempDir.mkdirs()
            val tempFile = File(tempDir, md5(full))
            tempFile.writeText(original)
            snapshots[full] = Snapshot(md5(original), original.length.toLong(), tempFile)
        } catch (e: Exception) {
            log.warn("snapshotFromPatch 写快照失败: $full", e)
        }
    }

    /** 用 patch(原始→当前) 反推：current + 反向 patch → original。位置对不上返回 null。 */
    private fun reverseApplyPatch(current: String, patch: com.google.gson.JsonArray): String? {
        val curLines = current.split("\n")
        val result = ArrayList<String>()
        var idx = 0
        for (h in patch) {
            val hunk = h.asJsonObject
            val newStart = (hunk.get("newStart")?.asInt ?: return null) - 1 // 当前内容里的 0-based 起点
            if (newStart < idx || newStart > curLines.size) return null
            while (idx < newStart) { result.add(curLines[idx]); idx++ }
            for (l in hunk.getAsJsonArray("lines")) {
                val line = l.asString
                when {
                    line.startsWith("+") -> { if (idx >= curLines.size) return null; idx++ }        // 当前有、原始无 → 跳过
                    line.startsWith("-") -> result.add(line.substring(1))                            // 原始有、当前无 → 补回
                    else -> { if (idx >= curLines.size) return null; result.add(curLines[idx]); idx++ } // 上下文，两边都有
                }
            }
        }
        while (idx < curLines.size) { result.add(curLines[idx]); idx++ }
        return result.joinToString("\n")
    }

    private fun resetSnapshots() {
        snapshots.clear()
        runCatching { tempDir.deleteRecursively() }
    }

    private fun readSnapshotContent(fullPath: String): String? =
        snapshots[fullPath]?.tempFile?.let { runCatching { it.readText() }.getOrNull() }

    // ─── diff 预览 ────────────────────────────────────────────────────────────

    private fun showFileDiff(filePath: String?, minLine: Int?) {
        val full = resolveFullPath(filePath) ?: return
        val fileName = File(full).name
        val original = readSnapshotContent(full) ?: ""
        // 直读磁盘：VFS 缓存陈旧会拿到编辑前内容，diff 就看不到改动
        val current = runCatching { File(full).readText() }.getOrNull() ?: ""

        if (original == current) {
            openFile(filePath, (minLine ?: 1) - 1)
            return
        }
        openDiff(fileName, original, current, "快照", "当前")
    }

    private fun showPermissionDiff(filePath: String?, diffContent: JsonObject?) {
        val full = resolveFullPath(filePath) ?: return
        if (diffContent == null) { openFile(filePath, 0); return }
        val fileName = File(full).name

        val src = File(full)
        val fileExists = src.isFile
        val current = if (fileExists) runCatching { src.readText() }.getOrNull() ?: "" else ""

        val type = str(diffContent, "type")
        val patch = diffContent.getAsJsonArray("patch")
        val proposed = if (type == "new") buildContentFromNewPatch(patch) else applyPatchHunks(current, patch)

        if (proposed == null || proposed == current) {
            openFile(filePath, 0)
            return
        }
        // VSCode 顺序：左=当前，右=proposed
        openDiff(fileName, current, proposed, "当前", "提议修改")
    }

    private fun openDiff(fileName: String, leftText: String, rightText: String, leftTitle: String, rightTitle: String) {
        ApplicationManager.getApplication().invokeLater {
            try {
                val factory = DiffContentFactory.getInstance()
                val fileType = FileTypeManager.getInstance().getFileTypeByFileName(fileName)
                val left: DiffContent = factory.create(project, leftText, fileType)
                val right: DiffContent = factory.create(project, rightText, fileType)
                val request = SimpleDiffRequest(fileName, left, right, leftTitle, rightTitle)
                DiffManager.getInstance().showDiff(project, request)
            } catch (e: Exception) {
                log.warn("openDiff 失败: $fileName", e)
            }
        }
    }

    // ─── 拒绝 / 回滚 ──────────────────────────────────────────────────────────

    /** 有快照＝写回原内容；无快照但文件存在＝新建文件，删除。都走 VFS 保证编辑器同步。 */
    private fun revertFiles(filePaths: List<String>) {
        for (raw in filePaths) {
            val full = resolveFullPath(raw) ?: continue
            val snapshotContent = readSnapshotContent(full)
            ApplicationManager.getApplication().invokeLater {
                WriteCommandAction.runWriteCommandAction(project) {
                    try {
                        val lfs = LocalFileSystem.getInstance()
                        if (snapshotContent != null) {
                            val vf = lfs.refreshAndFindFileByPath(full)
                            if (vf != null) VfsUtil.saveText(vf, snapshotContent)
                            else File(full).writeText(snapshotContent).also { lfs.refreshAndFindFileByPath(full) }
                        } else {
                            lfs.refreshAndFindFileByPath(full)?.delete(this)
                        }
                    } catch (e: Exception) {
                        log.warn("回滚失败: $full", e)
                    }
                }
            }
        }
    }

    // ─── 变更统计 ─────────────────────────────────────────────────────────────

    private fun getFileChangeStats(filePath: String?, sessionId: String) {
        val originalPath = filePath ?: return
        val full = resolveFullPath(originalPath) ?: return
        val original = readSnapshotContent(full) ?: ""
        // 直读磁盘：sema-core 在 IDE 外写盘，VFS 缓存陈旧，contentsToByteArray 会拿到编辑前内容
        val current = runCatching { File(full).readText() }.getOrNull() ?: ""

        var additions = 0
        var removals = 0
        var minLine = Int.MAX_VALUE
        if (original != current) {
            try {
                val fragments = ComparisonManager.getInstance()
                    .compareLines(original, current, ComparisonPolicy.DEFAULT, DumbProgressIndicator.INSTANCE)
                for (f in fragments) {
                    additions += f.endLine2 - f.startLine2
                    removals += f.endLine1 - f.startLine1
                    minLine = minOf(minLine, f.startLine2 + 1)
                }
            } catch (e: Throwable) {
                log.warn("计算变更统计失败: $full", e)
            }
        }

        val resolvedMinLine = if (minLine == Int.MAX_VALUE) 1 else minLine
        val stats = JsonObject().apply {
            addProperty("additions", additions)
            addProperty("removals", removals)
            addProperty("minLine", resolvedMinLine)
        }
        val message = JsonObject().apply {
            addProperty("type", "fileChangeStats")
            addProperty("sessionId", sessionId)
            addProperty("fullPath", originalPath) // 回传 UI 原样发来的路径，供 App 按 fullPath 匹配
            add("stats", stats)
        }
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("message", gson.toJson(message))
        }
        pushToWeb(gson.toJson(frame))
    }

    // ─── patch 重建（对齐 FileStateDiffManager）─────────────────────────────────

    private fun buildContentFromNewPatch(patch: com.google.gson.JsonArray?): String {
        if (patch == null) return ""
        val out = StringBuilder()
        var first = true
        for (h in patch) {
            for (l in h.asJsonObject.getAsJsonArray("lines")) {
                val line = l.asString
                if (line.startsWith("-")) continue
                val text = if (line.startsWith("+")) line.substring(1) else line
                if (!first) out.append('\n')
                out.append(text)
                first = false
            }
        }
        return out.toString()
    }

    /** 将 patch hunks 应用到当前内容；位置对不上返回 null（兜底打开文件）。 */
    private fun applyPatchHunks(currentContent: String, patch: com.google.gson.JsonArray?): String? {
        if (patch == null) return null
        val currentLines = currentContent.split("\n")
        val result = ArrayList<String>()
        var idx = 0

        for (h in patch) {
            val hunk = h.asJsonObject
            val hunkStart = hunk.get("oldStart").asInt - 1 // 转 0-based
            if (hunkStart < idx || hunkStart > currentLines.size) return null

            while (idx < hunkStart) { result.add(currentLines[idx]); idx++ }

            for (l in hunk.getAsJsonArray("lines")) {
                val line = l.asString
                when {
                    line.startsWith("+") -> result.add(line.substring(1))
                    line.startsWith("-") -> idx++
                    else -> { result.add(if (line.startsWith(" ")) line.substring(1) else line); idx++ }
                }
            }
        }
        while (idx < currentLines.size) { result.add(currentLines[idx]); idx++ }
        return result.joinToString("\n")
    }

    // ─── 工具 ────────────────────────────────────────────────────────────────

    private fun resolveFullPath(filePath: String?): String? {
        if (filePath.isNullOrBlank()) return null
        val f = File(filePath)
        if (f.isAbsolute) return f.path
        val base = project.basePath ?: return f.path
        return File(base, filePath).path
    }

    private fun md5(s: String): String =
        MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun str(o: JsonObject, key: String): String? =
        o.get(key)?.takeIf { !it.isJsonNull }?.asString

    private fun intOr(o: JsonObject, key: String, def: Int): Int =
        o.get(key)?.takeIf { !it.isJsonNull }?.asInt ?: def

    private fun intOrNull(o: JsonObject, key: String): Int? =
        o.get(key)?.takeIf { !it.isJsonNull }?.asInt

    private fun strList(o: JsonObject, key: String): List<String> =
        o.getAsJsonArray(key)?.mapNotNull { it.takeIf { e -> !e.isJsonNull }?.asString } ?: emptyList()
}
