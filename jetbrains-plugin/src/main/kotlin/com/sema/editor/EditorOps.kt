package com.sema.editor

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.chains.SimpleDiffRequestChain
import com.intellij.diff.comparison.ComparisonManager
import com.intellij.diff.comparison.ComparisonPolicy
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.editor.ChainDiffVirtualFile
import com.intellij.diff.editor.DiffEditorTabFilesManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.diff.tools.fragmented.UnifiedDiffTool
import com.intellij.diff.tools.util.base.HighlightPolicy
import com.intellij.diff.tools.util.base.TextDiffSettingsHolder.TextDiffSettings
import com.intellij.diff.util.DiffUserDataKeys
import com.intellij.diff.util.DiffUserDataKeysEx
import com.intellij.diff.util.Side
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.progress.DumbProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Pair
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import java.io.File
import java.security.MessageDigest

/**
 * 编辑器侧操作（VFS / diff / 打开文件 / 快照回滚）。
 *
 * 对标 VSCode 端 FileStateDiffManager：sema-core 子进程直接写盘，宿主只做两件事——
 * (a) 读文件时（会话就绪补历史、view_file、@ 引用）回读磁盘存改动前原版快照（幂等）；(b) 用户点「拒绝」时用快照写回或删除。
 * 「决定给哪个文件拍快照」的编排在 webview 的 controller.ts，这里只做实际 fs + diff。
 *
 * 跨进程坑（VSCode 同进程没有，JB 必须绕）：
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

    /** sessionId -> (绝对路径 -> 快照)：按会话隔离，避免多会话共享一份基线导致统计错乱、清空互相波及。 */
    private val sessionSnapshots = HashMap<String, HashMap<String, Snapshot>>()
    private fun snapshotsOf(sessionId: String): HashMap<String, Snapshot> =
        sessionSnapshots.getOrPut(sessionId) { HashMap() }

    /** bash 输出 tab 复用：key(=toolId||command) → 已打开的只读文件（对齐 VSCode 按 uri 复用）。 */
    private val bashOutputFiles = HashMap<String, com.intellij.testFramework.LightVirtualFile>()

    /** diff tab 复用：key(=路径) → 已打开的 diff 文件（平台不按路径自动复用，需自持实例，对齐 VSCode 单窗口）。 */
    private val openDiffFiles = HashMap<String, ChainDiffVirtualFile>()
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
            "addFileToSnapshotIfNew" -> addFileToSnapshotIfNew(str(msg, "sessionId") ?: "", str(msg, "filePath"))
            "pinEmptySnapshotIfNew" -> pinEmptySnapshotIfNew(str(msg, "sessionId") ?: "", str(msg, "filePath"))
            "resetSnapshots" -> resetSnapshots(str(msg, "sessionId") ?: "")
            "showFileDiff" -> showFileDiff(str(msg, "sessionId") ?: "", str(msg, "filePath"), intOrNull(msg, "minLine"))
            "showPermissionDiff" -> showPermissionDiff(str(msg, "sessionId") ?: "", str(msg, "filePath"), msg.getAsJsonObject("diffContent"))
            "revertFiles" -> revertFiles(str(msg, "sessionId") ?: "", strList(msg, "filePaths"))
            "revertFile" -> revertFiles(str(msg, "sessionId") ?: "", listOfNotNull(str(msg, "filePath")))
            "getFileChangeStats" -> getFileChangeStats(str(msg, "sessionId") ?: "", str(msg, "filePath"))
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

    /** 某会话的临时文件目录。 */
    private fun sessionTempDir(sessionId: String): File = File(tempDir, sessionId)

    /** 读文件时打快照（对齐 VSCode addFileToSnapshotIfNew）：回读当前磁盘内容存为"原版"，按会话隔离、幂等只在首次存。 */
    private fun addFileToSnapshotIfNew(sessionId: String, filePath: String?) {
        val full = resolveFullPath(filePath) ?: return
        val snaps = snapshotsOf(sessionId)
        if (snaps.containsKey(full)) return
        val src = File(full)
        if (!src.isFile) return
        val original = runCatching { src.readText() }.getOrNull() ?: return
        try {
            val dir = sessionTempDir(sessionId)
            dir.mkdirs()
            val tempFile = File(dir, md5(full))
            tempFile.writeText(original)
            snaps[full] = Snapshot(md5(original), original.length.toLong(), tempFile)
        } catch (e: Exception) {
            log.warn("addFileToSnapshotIfNew 写快照失败: $full", e)
        }
    }

    /** 新建文件时钉一条空基线并锁定（对齐 VSCode pinEmptySnapshotIfNew）：避免 fork 后重读把已改内容误当基线；已在快照中则不动。 */
    private fun pinEmptySnapshotIfNew(sessionId: String, filePath: String?) {
        val full = resolveFullPath(filePath) ?: return
        val snaps = snapshotsOf(sessionId)
        if (snaps.containsKey(full)) return
        try {
            val dir = sessionTempDir(sessionId)
            dir.mkdirs()
            val tempFile = File(dir, md5(full))
            tempFile.writeText("")
            snaps[full] = Snapshot(md5(""), 0L, tempFile)
        } catch (e: Exception) {
            log.warn("pinEmptySnapshotIfNew 写空快照失败: $full", e)
        }
    }

    /** 只重置指定会话的快照与临时文件（对齐 VSCode createSnapshot(sessionId)），不波及其他会话。 */
    private fun resetSnapshots(sessionId: String) {
        sessionSnapshots.remove(sessionId)
        runCatching { sessionTempDir(sessionId).deleteRecursively() }
    }

    private fun readSnapshotContent(sessionId: String, fullPath: String): String? =
        snapshotsOf(sessionId)[fullPath]?.tempFile?.let { runCatching { it.readText() }.getOrNull() }

    // ─── diff 预览 ────────────────────────────────────────────────────────────

    private fun showFileDiff(sessionId: String, filePath: String?, minLine: Int?) {
        val full = resolveFullPath(filePath) ?: return
        val fileName = File(full).name
        val original = readSnapshotContent(sessionId, full) ?: ""
        // 直读磁盘：VFS 缓存陈旧会拿到编辑前内容，diff 就看不到改动
        val current = runCatching { File(full).readText() }.getOrNull() ?: ""

        if (original == current) {
            openFile(filePath, (minLine ?: 1) - 1)
            return
        }
        // diff tab 复用 key 带 sessionId，避免多会话对同一文件的 diff 互相覆盖。
        openDiff("$sessionId:$full", fileName, original, current, "快照", "当前", maxOf(0, (minLine ?: 1) - 1))
    }

    private fun showPermissionDiff(sessionId: String, filePath: String?, diffContent: JsonObject?) {
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
        // VSCode 顺序：左=当前，右=proposed；滚动到首个 hunk 的 newStart（1-based，对齐 VSCode）。
        val minLine = patch?.firstOrNull()?.asJsonObject?.get("newStart")?.asInt ?: 1
        openDiff("permission:$sessionId:$full", fileName, current, proposed, "当前", "提议修改", maxOf(0, minLine - 1))
    }

    /**
     * @param pathKey  复用同一 tab 的依据（用绝对路径；权限预览另加前缀以与快照 diff 区分）。
     * @param scrollLine0  滚动定位到的行，0-based，作用在 RIGHT（新/当前）侧。
     */
    private fun openDiff(pathKey: String, fileName: String, leftText: String, rightText: String, leftTitle: String, rightTitle: String, scrollLine0: Int) {
        ApplicationManager.getApplication().invokeLater {
            try {
                val factory = DiffContentFactory.getInstance()
                val fileType = FileTypeManager.getInstance().getFileTypeByFileName(fileName)
                val left: DiffContent = factory.create(project, leftText, fileType)
                val right: DiffContent = factory.create(project, rightText, fileType)
                val request = SimpleDiffRequest(fileName, left, right, leftTitle, rightTitle)
                // 默认一栏 unified + split-changes 高亮（均保留工具栏可切）；new 隔离实例，不污染用户全局设置。
                request.putUserData(DiffUserDataKeysEx.FORCE_DIFF_TOOL, UnifiedDiffTool.INSTANCE)
                request.putUserData(TextDiffSettings.KEY, TextDiffSettings().apply { highlightPolicy = HighlightPolicy.BY_WORD_SPLIT })
                // 滚动到首个变更行（RIGHT=新/当前侧，0-based）。
                request.putUserData(DiffUserDataKeys.SCROLL_TO_LINE, Pair.create(Side.RIGHT, scrollLine0))
                // 单窗口复用（对齐 VSCode）：关掉该文件已开的 diff tab 再以编辑器 tab 重开——顺带刷新内容
                // （ChainDiffVirtualFile 的 processor 只在首次创建时跑一次，复用旧实例会显示旧 diff）。
                val fem = FileEditorManager.getInstance(project)
                openDiffFiles.remove(pathKey)?.let { fem.closeFile(it) }
                val diffFile = ChainDiffVirtualFile(SimpleDiffRequestChain(request), fileName)
                openDiffFiles[pathKey] = diffFile
                DiffEditorTabFilesManager.getInstance(project).showDiffFile(diffFile, true)
            } catch (e: Exception) {
                log.warn("openDiff 失败: $fileName", e)
            }
        }
    }

    // ─── 拒绝 / 回滚 ──────────────────────────────────────────────────────────

    /** 有快照＝写回原内容；无快照但文件存在＝新建文件，删除。都走 VFS 保证编辑器同步。 */
    private fun revertFiles(sessionId: String, filePaths: List<String>) {
        for (raw in filePaths) {
            val full = resolveFullPath(raw) ?: continue
            val snapshotContent = readSnapshotContent(sessionId, full)
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

    private fun getFileChangeStats(sessionId: String, filePath: String?) {
        val originalPath = filePath ?: return
        val full = resolveFullPath(originalPath) ?: return
        val original = readSnapshotContent(sessionId, full) ?: ""
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
