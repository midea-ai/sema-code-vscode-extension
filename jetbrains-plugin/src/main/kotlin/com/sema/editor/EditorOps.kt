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

    companion object {
        private const val INPUT_HISTORY_KEY = "sema.inputHistory"
        private const val INPUT_HISTORY_MAX = 50

        /** 排除的目录/文件名（对齐 fileExcludePatterns.ts 的 EXCLUDED_NAMES）。 */
        private val EXCLUDED_NAMES = setOf(
            "node_modules", ".git", "dist", "build", ".next", "out", ".vscode",
            ".DS_Store", "__pycache__", ".pytest_cache", "venv", ".venv", ".env", ".idea",
            "target", "ios", "android", ".tmp", "temp", "logs",
            ".gradle", "gradle", ".m2", ".settings",
            ".nuxt", ".output", ".svelte-kit", ".astro",
            ".vuepress", ".vitepress", ".cache", ".parcel-cache",
            "coverage", ".nyc_output", "storybook-static",
            ".docusaurus", ".expo", ".react-email",
        )
    }

    private data class Snapshot(val hash: String, val size: Long, val tempFile: File)

    /** key = 绝对路径 */
    private val snapshots = HashMap<String, Snapshot>()

    /** bash 输出 tab 复用：key(=toolId||command) → 已打开的只读文件（对齐 VSCode 按 uri 复用）。 */
    private val bashOutputFiles = HashMap<String, com.intellij.testFramework.LightVirtualFile>()
    private val tempDir: File = File(System.getProperty("java.io.tmpdir"), "sema-snapshots-jb")

    fun handle(msg: JsonObject) {
        when (val type = str(msg, "type")) {
            "openFile" -> openFile(str(msg, "filePath"), intOr(msg, "line", 0), intOrNull(msg, "endLine"))
            "openExternal" -> openExternal(str(msg, "url"))
            "openConfig" -> openConfig(str(msg, "page"), str(msg, "taskId"))
            "openBashOutput" -> openBashOutput(str(msg, "content"), str(msg, "command") ?: str(msg, "title"), str(msg, "toolId"))
            "verifyFilePath" -> verifyFilePath(str(msg, "filePath"), str(msg, "tempId"), str(msg, "originalCode"), str(msg, "lineInfo"))
            "resolveImagePath" -> resolveImagePath(str(msg, "filePath"), str(msg, "tempId"))
            "requestWorkspaceFiles" -> sendWorkspaceFiles(msg.get("reqId"))
            "searchWorkspaceFiles" -> searchWorkspaceFilesOp(str(msg, "query") ?: "", msg.get("reqId"))
            "searchContentInFiles" -> searchContentInFilesOp(str(msg, "content"))
            "requestClipboardFiles" -> requestClipboardFiles()
            "requestInputHistory" -> sendInputHistory()
            "saveInputHistory" -> saveInputHistory(msg.getAsJsonObject("item"))
            "openAgentDetail" -> openAgentDetail(str(msg, "taskId"), str(msg, "sessionId"))
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

    private fun openFile(path: String?, line: Int, endLine: Int? = null) {
        val full = resolveFullPath(path) ?: return
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(full) ?: return
        ApplicationManager.getApplication().invokeLater {
            val descriptor = OpenFileDescriptor(project, vf, maxOf(0, line), 0)
            // endLine 存在时选中 [line, endLine] 区间（D9 低优先增强；web 侧一直在发 endLine）。
            if (endLine != null && endLine > line) {
                val editor = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
                if (editor != null) {
                    val doc = editor.document
                    val last = maxOf(0, doc.lineCount - 1)
                    val s = doc.getLineStartOffset(maxOf(0, line).coerceAtMost(last))
                    val e = doc.getLineEndOffset(endLine.coerceAtMost(last))
                    editor.selectionModel.setSelection(s, e)
                }
            } else {
                descriptor.navigate(true)
            }
        }
    }

    private fun openExternal(url: String?) {
        if (!url.isNullOrBlank()) BrowserUtil.browse(url)
    }

    /** 打开配置页（编辑器主区域的独立 tab，对齐 VSCode 的 createWebviewPanel(ViewColumn.One)）。 */
    private fun openConfig(page: String? = null, taskId: String? = null) {
        ApplicationManager.getApplication().invokeLater {
            val vf = com.sema.config.SemaConfigVirtualFile.get(project)
            com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFile(vf, true)
            // TODO(JB 待完善)：page/taskId 深链导航尚未接入配置页 React 路由。
            if (page != null || taskId != null) log.info("openConfig page=$page taskId=$taskId（深链导航待完善）")
        }
    }

    /**
     * 打开工具的 bash 输出（只读内存文件）。标题/内容逻辑完全对齐 VSCode openBashOutputAsDocument：
     * - 内容：有 command 时加 "# 命令\n\n" 标头，否则纯内容；
     * - 标题：= key = toolId || command || "bash-output"（对齐 uriForId 的 key，即 tab 名）；
     * - 复用：相同 key 复用同一 tab 并更新内容（对齐 VSCode 按 uri 复用文档）。
     */
    private fun openBashOutput(content: String?, command: String?, toolId: String?) {
        val body = if (!command.isNullOrEmpty()) "# $command\n\n${content ?: ""}" else (content ?: "")
        val key = toolId?.takeIf { it.isNotEmpty() } ?: command?.takeIf { it.isNotEmpty() } ?: "bash-output"
        ApplicationManager.getApplication().invokeLater {
            val existing = bashOutputFiles[key]
            val vf = if (existing != null) {
                runCatching { existing.setContent(this, body, true) } // 同 key 复用并刷新内容
                existing
            } else {
                com.intellij.testFramework.LightVirtualFile(
                    key, com.intellij.openapi.fileTypes.PlainTextFileType.INSTANCE, body,
                ).also { it.isWritable = false; bashOutputFiles[key] = it }
            }
            com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFile(vf, true)
        }
    }

    /** 校验文件是否存在（对齐 VSCode verifyFilePath）→ 经 editor 通路回推 filePathVerified，原样回带 payload。 */
    private fun verifyFilePath(filePath: String?, tempId: String?, originalCode: String?, lineInfo: String?) {
        val full = resolveFullPath(filePath)
        val exists = full != null && File(full).isFile
        val message = JsonObject().apply {
            addProperty("type", "filePathVerified")
            addProperty("tempId", tempId ?: "")
            addProperty("exists", exists)
            addProperty("filePath", filePath ?: "")
            addProperty("originalCode", originalCode ?: "")
            if (lineInfo != null) addProperty("lineInfo", lineInfo)
        }
        pushAppMessage(message)
    }

    /** 读图片转 base64 data URI（对齐 VSCode resolveImageDataUri，用 data: URI 而非 webview URI）→ 回推 imagePathResolved。 */
    private fun resolveImagePath(filePath: String?, tempId: String?) {
        val full = resolveFullPath(filePath)
        val src = full?.let {
            val f = File(it)
            if (!f.isFile) null else runCatching {
                "data:${imageMime(f.extension.lowercase())};base64," +
                    java.util.Base64.getEncoder().encodeToString(f.readBytes())
            }.getOrNull()
        }
        val message = JsonObject().apply {
            addProperty("type", "imagePathResolved")
            addProperty("tempId", tempId ?: "")
            addProperty("exists", src != null)
            if (src != null) addProperty("src", src)
        }
        pushAppMessage(message)
    }

    /** 扩展名 → MIME（对齐 VSCode resolveImageDataUri 的映射）。 */
    private fun imageMime(ext: String): String = when (ext) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "svg" -> "image/svg+xml"
        "bmp" -> "image/bmp"
        "ico" -> "image/x-icon"
        "avif" -> "image/avif"
        else -> "application/octet-stream"
    }

    /** 把一条 UI 消息经 editor 通路回推给 web（与 getFileChangeStats 的回帧方式一致）。 */
    private fun pushAppMessage(message: JsonObject) {
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("message", gson.toJson(message))
        }
        pushToWeb(gson.toJson(frame))
    }

    /** 查看子 agent 详情（D9 最小实现）：先打开配置页；子 agent 详情深链导航待完善。 */
    private fun openAgentDetail(taskId: String?, sessionId: String?) {
        log.info("openAgentDetail taskId=$taskId sessionId=$sessionId（打开配置页，深链待完善）")
        openConfig(page = "tasks", taskId = taskId)
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

    // ─── 工作区文件 / 内容搜索 / 剪贴板 / 输入历史（对齐 VSCode FileOperationManager + workspaceState）───

    /** 列工作区文件：已打开文件（相对路径, isOpen=true）在前 + 根目录条目（过滤排除名），去重排序。对齐 getWorkspaceFiles。 */
    private fun sendWorkspaceFiles(reqId: com.google.gson.JsonElement?) {
        val base = project.basePath
        val items = com.intellij.openapi.application.ReadAction.compute<List<Map<String, Any?>>, RuntimeException> {
            val out = LinkedHashMap<String, Map<String, Any?>>()
            val openPaths = LinkedHashSet<String>()
            for (vf in com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFiles) {
                val rel = relPath(vf.path, base)
                openPaths.add(rel)
                out[rel] = mapOf("path" to rel, "isDirectory" to false, "isOpen" to true)
            }
            val baseVf = base?.let { LocalFileSystem.getInstance().findFileByPath(it) }
            baseVf?.children?.forEach { child ->
                if (child.name in EXCLUDED_NAMES) return@forEach
                if (out.containsKey(child.name)) return@forEach
                out[child.name] = mapOf("path" to child.name, "isDirectory" to child.isDirectory, "isOpen" to openPaths.contains(child.name))
            }
            out.values.sortedBy { (it["path"] as String).lowercase() }
        }
        pushFiles(reqId, items)
    }

    /** 按关键字搜工作区文件（有界 DFS，跳过排除目录），按 精确>前缀>包含、路径长度、字典序 排序取前 100。对齐 searchWorkspaceFiles。 */
    private fun searchWorkspaceFilesOp(query: String, reqId: com.google.gson.JsonElement?) {
        val q = query.trim().trimEnd('/').lowercase().replace(Regex("[*?{}\\[\\]]"), "")
        if (q.isEmpty()) { sendWorkspaceFiles(reqId); return }
        val base = project.basePath
        val items = com.intellij.openapi.application.ReadAction.compute<List<Map<String, Any?>>, RuntimeException> {
            val baseVf = base?.let { LocalFileSystem.getInstance().findFileByPath(it) }
                ?: return@compute emptyList<Map<String, Any?>>()
            val openPaths = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFiles
                .map { relPath(it.path, base) }.toHashSet()
            val matches = ArrayList<com.intellij.openapi.vfs.VirtualFile>()
            val stack = ArrayDeque<com.intellij.openapi.vfs.VirtualFile>()
            baseVf.children?.forEach { stack.addLast(it) }
            var visited = 0
            while (stack.isNotEmpty() && matches.size < 500 && visited < 20000) {
                val vf = stack.removeLast(); visited++
                if (vf.name in EXCLUDED_NAMES) continue
                if (vf.name.lowercase().contains(q)) matches.add(vf)
                if (vf.isDirectory) vf.children?.forEach { stack.addLast(it) }
            }
            matches.map { vf -> Triple(relPath(vf.path, base), vf.isDirectory, openPaths.contains(relPath(vf.path, base))) }
                .sortedWith(compareBy({ nameRank(File(it.first).name.lowercase(), q) }, { it.first.length }, { it.first.lowercase() }))
                .take(100)
                .map { mapOf("path" to it.first, "isDirectory" to it.second, "isOpen" to it.third) }
        }
        pushFiles(reqId, items)
    }

    /** 名称匹配排序权重：精确=0 前缀=1 包含=2。 */
    private fun nameRank(name: String, q: String): Int = when {
        name == q -> 0
        name.startsWith(q) -> 1
        else -> 2
    }

    /** 在已打开编辑器（活动优先）中按内容定位文件与行区间（对齐 searchContentInFiles/searchInDocument，1-based）。 */
    private fun searchContentInFilesOp(content: String?) {
        val clean = content?.trim().orEmpty()
        val base = project.basePath
        val result: Map<String, Any?>? = if (clean.isEmpty()) null else
            com.intellij.openapi.application.ReadAction.compute<Map<String, Any?>?, RuntimeException> {
                val fem = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project)
                val ordered = LinkedHashSet<com.intellij.openapi.vfs.VirtualFile>()
                fem.selectedEditor?.file?.let { ordered.add(it) }
                fem.openFiles.forEach { ordered.add(it) }
                for (vf in ordered) {
                    if (!vf.isInLocalFileSystem) continue
                    val text = com.intellij.openapi.fileEditor.FileDocumentManager.getInstance().getDocument(vf)?.text ?: continue
                    val idx = text.indexOf(clean)
                    if (idx >= 0) {
                        val startLine = text.substring(0, idx).count { it == '\n' } + 1
                        val endLine = startLine + clean.count { it == '\n' }
                        return@compute mapOf("path" to relPath(vf.path, base), "startLine" to startLine, "endLine" to endLine)
                    }
                }
                null
            }
        val message = JsonObject().apply {
            addProperty("type", "contentSearchResult")
            if (result == null) add("result", com.google.gson.JsonNull.INSTANCE) else add("result", gson.toJsonTree(result))
        }
        pushAppMessage(message)
    }

    /** 读系统剪贴板里“复制的文件”路径（AWT javaFileListFlavor），工作区内转相对路径。对齐 readClipboardFiles。 */
    private fun requestClipboardFiles() {
        val base = project.basePath
        val paths: List<String> = runCatching {
            val cb = java.awt.Toolkit.getDefaultToolkit().systemClipboard
            if (cb.isDataFlavorAvailable(java.awt.datatransfer.DataFlavor.javaFileListFlavor)) {
                @Suppress("UNCHECKED_CAST")
                val files = cb.getData(java.awt.datatransfer.DataFlavor.javaFileListFlavor) as List<File>
                files.map { relPath(it.path, base) }
            } else emptyList()
        }.getOrElse { emptyList() }
        val message = JsonObject().apply {
            addProperty("type", "clipboardFilesResult")
            add("paths", gson.toJsonTree(paths))
        }
        pushAppMessage(message)
    }

    /** 输入历史读取（项目级 PropertiesComponent，对齐 VSCode workspaceState 'sema.inputHistory'）。 */
    private fun sendInputHistory() {
        val json = com.intellij.ide.util.PropertiesComponent.getInstance(project).getValue(INPUT_HISTORY_KEY)
        val items = if (json.isNullOrEmpty()) com.google.gson.JsonArray()
            else runCatching { gson.fromJson(json, com.google.gson.JsonArray::class.java) }.getOrNull() ?: com.google.gson.JsonArray()
        val message = JsonObject().apply {
            addProperty("type", "inputHistoryLoaded")
            add("items", items)
        }
        pushAppMessage(message)
    }

    /** 输入历史追加：空文本跳过；仅与末条去重（text + mentions）；上限 50。对齐 appendInputHistory。 */
    private fun saveInputHistory(item: JsonObject?) {
        val text = item?.get("text")?.takeIf { !it.isJsonNull }?.asString
        if (item == null || text.isNullOrBlank()) return
        val props = com.intellij.ide.util.PropertiesComponent.getInstance(project)
        val arr = runCatching { gson.fromJson(props.getValue(INPUT_HISTORY_KEY), com.google.gson.JsonArray::class.java) }.getOrNull()
            ?: com.google.gson.JsonArray()
        val last = if (arr.size() > 0) arr.get(arr.size() - 1).asJsonObject else null
        val dup = last != null &&
            (last.get("text")?.takeIf { !it.isJsonNull }?.asString == text) &&
            gson.toJson(last.get("mentions") ?: com.google.gson.JsonArray()) == gson.toJson(item.get("mentions") ?: com.google.gson.JsonArray())
        if (!dup) arr.add(item)
        while (arr.size() > INPUT_HISTORY_MAX) arr.remove(0)
        props.setValue(INPUT_HISTORY_KEY, gson.toJson(arr))
    }

    private fun pushFiles(reqId: com.google.gson.JsonElement?, files: List<Map<String, Any?>>) {
        val message = JsonObject().apply {
            addProperty("type", "workspaceFiles")
            if (reqId != null && !reqId.isJsonNull) add("reqId", reqId)
            add("files", gson.toJsonTree(files))
        }
        pushAppMessage(message)
    }

    /** 工作区内 → 相对路径；工作区外 → 原样绝对路径（对齐 asRelativePath 行为）。 */
    private fun relPath(path: String, base: String?): String {
        if (base.isNullOrEmpty()) return path
        val b = base.trimEnd('/')
        return if (path.startsWith("$b/")) path.substring(b.length + 1) else path
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
