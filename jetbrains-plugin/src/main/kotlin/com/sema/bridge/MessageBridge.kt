package com.sema.bridge

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.sema.config.SemaBundle
import com.sema.config.SemaConfigVirtualFile
import com.sema.config.SessionHistoryManager
import com.sema.config.SystemConfigManager
import com.sema.editor.EditorOps
import com.sema.sidecar.SidecarService
import semacore.transport.BridgeConnection
import semacore.transport.SemaEvent

/**
 * 哑转发桥：连接单个 JCEF 面板与共享 sidecar。
 * - channel=grpc  → 转发给 sidecar（sema-core 透明镜像，桥不解释内容）；仅 init 会合并本地持久化配置做 seed
 * - channel=editor → 本地编辑器操作（VFS / diff / 打开文件），或 systemConfig 本地持久化（请求/应答）
 *
 * 协议逻辑全在 webview JS（复用 semaSessionWrapper / config-controller），这里只搬运。
 * 每个面板一个 MessageBridge → 一条独立 gRPC 连接（Conn）。
 */
/** 面板类型：让桥区分自己承载的是哪个 webview（当前仅用于配置页的就绪信号）。 */
enum class PanelKind { CHAT, CONFIG, HISTORY, OTHER }

// 浏览器控制资产（由 build.gradle.kts 的 syncChromeAssets 从主工程 assets/chrome 同步进插件资源）
private const val BROWSER_ASSETS_DIR = "assets/chrome"
private const val BROWSER_SKILL_NAME = "chrome-use"
private const val BROWSER_MCP_NAME = "chrome"
private val BROWSER_SKILL_FILES = listOf("SKILL.md")

class MessageBridge(
    private val project: Project,
    private val pushToWeb: (String) -> Unit,
    private val panel: PanelKind = PanelKind.OTHER,
) {
    private val log = logger<MessageBridge>()
    /** 配置页首帧入站即上报就绪，让缓冲的深链 navigateTo flush（只标记一次）。 */
    private var configReadyMarked = false
    private val gson = Gson()
    private val sidecar = project.getService(SidecarService::class.java)
    private val editorOps = EditorOps(project, pushToWeb)
    private val sysConfig = ApplicationManager.getApplication().getService(SystemConfigManager::class.java)
    private val history = project.getService(SessionHistoryManager::class.java)
    private val bus = project.getService(SemaPanelBus::class.java)
    // 构造即注册连接并异步引导 sidecar：就绪前命令由 SDK 连接缓冲，避免 web 的命令早于进程就绪时被丢弃。
    private val conn: BridgeConnection = sidecar.connect { ev -> pushGrpcEvent(ev) }

    /** 来自 webview 的消息（JSON 字符串）。 */
    fun onWebMessage(json: String) {
        val obj = runCatching { gson.fromJson(json, JsonObject::class.java) }.getOrNull() ?: run {
            log.warn("无法解析 web 消息: $json")
            return
        }
        // OSR 取证上报是宿主注入 JS 发出的，页面 shell 一解析就可能到达，不代表 React 已挂载：
        // 必须在就绪判定之前短路，否则会提前 flush 深链导航到还没接监听的页面上（导航丢失）。
        if (obj.str("channel") == "osrDiag") { log.warn("[sema][osr][page] $json"); return }
        // 配置页收到首条 web 消息 → React 已挂载并接好 message 监听 → 就绪，flush 缓冲的深链导航。
        if (panel == PanelKind.CONFIG && !configReadyMarked) {
            configReadyMarked = true
            bus.setConfigReady()
        }
        when (obj.str("channel")) {
            "grpc" -> {
                val action = obj.str("action")
                // init 时把本地持久化的系统配置（core 子集）+ 禁用工具合并进 payload，
                // 让 sema-core 用持久化配置启动（对齐 VSCode 的 SystemConfigManager → SemaCore 构造）。
                val payload = if (action == "init") mergeInitConfig(obj.str("payload")) else obj.str("payload")
                conn.send(obj.str("id"), action, payload, obj.str("sessionId"))
            }
            "editor" -> {
                when (obj.str("type")) {
                    "systemConfig" -> handleSystemConfig(obj)
                    "browserControl" -> handleBrowserControl(obj)
                    "fileOps" -> handleFileOps(obj)
                    "history" -> handleHistory(obj)
                    "confirm" -> handleConfirm(obj)
                    // 跨面板深链（页面各持独立连接，pushToWeb 只能推自己面板，必须经总线）：
                    "openConfig" -> handleOpenConfig(obj)          // 聊天页 → 配置页定位子页
                    "openAgentDetail" -> handleOpenAgentDetail(obj) // 配置页任务详情 → 聊天页弹子代理详情
                    else -> editorOps.handle(obj)
                }
            }
            else -> log.warn("未知 channel: $json")
        }
    }

    /** 配置页系统配置的本地读写（channel=editor, type=systemConfig）；带 reqId 回帧供 callEditor resolve。 */
    private fun handleSystemConfig(obj: JsonObject) {
        val reqId = obj.str("reqId")
        val payload = runCatching { gson.fromJson(obj.str("payload"), JsonObject::class.java) }.getOrNull() ?: JsonObject()
        val op = payload.str("op")
        val data: Any = try {
            when (op) {
                "get" -> mapOf("config" to sysConfig.getConfig(), "platform" to platform())
                "save" -> { sysConfig.saveConfig(toMap(payload.get("config"))); emptyMap<String, Any?>() }
                "saveByKey" -> { sysConfig.saveByKey(payload.str("key"), jsonToAny(payload.get("value"))); emptyMap<String, Any?>() }
                "saveDisabledTools" -> {
                    val tools = payload.get("disabledTools")
                    sysConfig.saveDisabledTools(if (tools == null || tools.isJsonNull) null else gson.fromJson(tools, Array<String>::class.java).toList())
                    emptyMap<String, Any?>()
                }
                else -> emptyMap<String, Any?>()
            }
        } catch (e: Exception) {
            replyEditorError(reqId, e.message ?: SemaBundle.message("error.systemConfig"))
            return
        }
        // 配置页改系统配置后，主动把聊天页关心的开关 + 界面语言推给聊天 webview，并把语言推给历史面板
        // （对齐 VSCode setOnSystemConfigChanged → chat.postMessage systemConfigUpdate / history.postLangUpdate；
        //  跨 JCEF 面板只能经总线，配置页那条 gRPC 连接推不到聊天页）。
        if (op == "save" || op == "saveByKey") {
            pushSystemConfigToChat()
        }
        val savedKey = payload.str("key")
        if (op == "save" || (op == "saveByKey" && savedKey == "lang")) {
            pushLangToHistory()
            pushLangToConfig()
        }
        // 聊天页切语言时 lang 与 customRules 分两次 saveByKey 落盘，customRules 落盘后再推一次，配置页才能拿到新默认规则
        if (op == "saveByKey" && savedKey == "customRules") {
            pushLangToConfig()
        }
        replyEditor(reqId, data)
    }

    /** 把聊天页关心的三个系统配置开关 + 界面语言推给聊天 webview（systemConfigUpdate，走 editor message 帧）。
     *  取值口径与聊天 controller.sendSystemConfig 一致，避免两端漂移。 */
    private fun pushSystemConfigToChat() {
        val c = sysConfig.getConfig()
        val uiMsg = linkedMapOf<String, Any?>(
            "type" to "systemConfigUpdate",
            "skipFileEditPermission" to (c["skipFileEditPermission"] == true),
            "thinking" to (c["thinking"] != false),
            "showThinkingText" to (c["showThinkingText"] != false),
            "lang" to sysConfig.lang(),
        )
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("message", gson.toJson(uiMsg))
        }
        bus.pushToChat(gson.toJson(frame))
    }

    /** 界面语言推给已打开的历史面板（langUpdate，走 editor message 帧；对齐 VSCode sessionHistoryWebview.postLangUpdate）。 */
    private fun pushLangToHistory() {
        if (!bus.hasHistory()) return
        val uiMsg = linkedMapOf<String, Any?>("type" to "langUpdate", "lang" to sysConfig.lang())
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("message", gson.toJson(uiMsg))
        }
        bus.pushToHistory(gson.toJson(frame))
    }

    /** 聊天页切换语言后，同步已打开（或正在初始化）的配置 webview；customRules 带当前落盘值，供页面在仍为默认规则时跟着切换。 */
    private fun pushLangToConfig() {
        val uiMsg = linkedMapOf<String, Any?>(
            "command" to "langUpdate",
            "lang" to sysConfig.lang(),
            "customRules" to sysConfig.getConfig()["customRules"],
        )
        bus.pushToConfig(editorFrame(uiMsg))
    }

    /** 破坏性操作确认弹窗（channel=editor, type=confirm；带 reqId 回帧供 callEditor resolve）。对齐 VSCode configWebview.confirm 的 modal 警告。 */
    /**
     * 浏览器控制的宿主侧准备（webview 无 fs，此两步下沉到 Kotlin；其余 skill 刷新 / MCP 增删走 gRPC，见 config-controller）：
     * op=prepare → 用户级 chrome-use skill 目录缺失时从插件资源拷贝；读取 mcp.json 模板，回传 chrome 项。
     * 资源在 jar 内无法列目录，skill 文件按已知清单逐个拷贝：assets/chrome/skills/chrome-use 新增文件时需同步更新 BROWSER_SKILL_FILES。
     */
    private fun handleBrowserControl(obj: JsonObject) {
        val reqId = obj.str("reqId")
        val payload = runCatching { gson.fromJson(obj.str("payload"), JsonObject::class.java) }.getOrNull() ?: JsonObject()
        try {
            when (payload.str("op")) {
                "prepare" -> {
                    val skillDir = java.io.File(System.getProperty("user.home"), ".sema/skills/$BROWSER_SKILL_NAME")
                    if (!java.io.File(skillDir, "SKILL.md").exists()) {
                        skillDir.mkdirs()
                        for (name in BROWSER_SKILL_FILES) {
                            val bytes = readResource("$BROWSER_ASSETS_DIR/skills/$BROWSER_SKILL_NAME/$name")
                                ?: throw IllegalStateException("插件资源缺少 $BROWSER_ASSETS_DIR/skills/$BROWSER_SKILL_NAME/$name")
                            java.io.File(skillDir, name).writeBytes(bytes)
                        }
                    }
                    val template = readResource("$BROWSER_ASSETS_DIR/mcp.json")?.toString(Charsets.UTF_8)
                        ?: throw IllegalStateException("插件资源缺少 $BROWSER_ASSETS_DIR/mcp.json")
                    val entry = gson.fromJson(template, JsonObject::class.java)
                        ?.getAsJsonObject("mcpServers")?.getAsJsonObject(BROWSER_MCP_NAME)
                        ?: throw IllegalStateException("$BROWSER_ASSETS_DIR/mcp.json 缺少 mcpServers.$BROWSER_MCP_NAME")
                    replyEditor(reqId, mapOf("mcp" to toMap(entry)))
                }
                else -> replyEditorError(reqId, "未知 browserControl op: ${payload.str("op")}")
            }
        } catch (e: Exception) {
            replyEditorError(reqId, e.message ?: e.toString())
        }
    }

    /**
     * 配置页「导入」的通用文件操作（channel=editor, type=fileOps）：webview 无 fs，读三家配置、拷 skill / Agent / Command / 规则文件、
     * 合并写 hooks.json 都下沉到这里；只有 MCP 写入走 RemoteCore 公开 API。
     * 路径一律绝对路径（由 roots 给出 home / project 后在 webview 拼接），读写都直走 java.io.File 不经 VFS。
     * 大文件读取 / 目录递归拷贝可能较慢，放到池线程执行，避免占住 JCEF 查询线程拖住同面板其他 editor 请求。
     */
    private fun handleFileOps(obj: JsonObject) {
        val reqId = obj.str("reqId")
        val payload = runCatching { gson.fromJson(obj.str("payload"), JsonObject::class.java) }.getOrNull() ?: JsonObject()
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val data: Any = when (val op = payload.str("op")) {
                    "roots" -> mapOf(
                        "home" to System.getProperty("user.home"),
                        "project" to (project.basePath ?: ""),
                        "sep" to java.io.File.separator,
                    )
                    "exists" -> mapOf("exists" to java.io.File(payload.str("path")).exists())
                    "readFile" -> mapOf("content" to java.io.File(payload.str("path")).readText(Charsets.UTF_8))
                    "readDir" -> {
                        val dir = java.io.File(payload.str("path"))
                        val entries = if (dir.isDirectory) (dir.listFiles() ?: emptyArray()).map {
                            mapOf("name" to it.name, "isDir" to it.isDirectory)
                        } else emptyList()
                        mapOf("entries" to entries)
                    }
                    "writeFile" -> {
                        val f = java.io.File(payload.str("path"))
                        f.parentFile?.mkdirs()
                        f.writeText(payload.str("content"), Charsets.UTF_8)
                        refreshVfs(f)
                        emptyMap<String, Any?>()
                    }
                    "copyDir" -> {
                        val src = java.io.File(payload.str("src"))
                        val dst = java.io.File(payload.str("dst"))
                        if (!src.isDirectory) throw IllegalStateException("源目录不存在: ${src.path}")
                        dst.parentFile?.mkdirs()
                        src.copyRecursively(dst, overwrite = false)
                        refreshVfs(dst)
                        emptyMap<String, Any?>()
                    }
                    else -> throw IllegalStateException("未知 fileOps op: $op")
                }
                replyEditor(reqId, data)
            } catch (e: Exception) {
                replyEditorError(reqId, e.message ?: e.toString())
            }
        }
    }

    /** 外部写盘后让 IDE 的 VFS 感知（异步，不阻塞回帧）；写在项目目录之外时无害。 */
    private fun refreshVfs(file: java.io.File) {
        runCatching { LocalFileSystem.getInstance().refreshIoFiles(listOf(file), true, true, null) }
    }

    private fun readResource(path: String): ByteArray? =
        MessageBridge::class.java.classLoader.getResourceAsStream(path)?.use { it.readBytes() }

    private fun handleConfirm(obj: JsonObject) {
        val reqId = obj.str("reqId")
        val payload = runCatching { gson.fromJson(obj.str("payload"), JsonObject::class.java) }.getOrNull() ?: JsonObject()
        val message = payload.str("message")
        // 按钮文案按当前界面语言取值（webview 未传 confirmLabel 时的缺省，以及取消按钮）
        val confirmLabel = payload.str("confirmLabel").ifEmpty { SemaBundle.message("dialog.ok") }
        val cancelLabel = SemaBundle.message("dialog.cancel")
        ApplicationManager.getApplication().invokeLater {
            val ok = com.intellij.openapi.ui.Messages.showYesNoDialog(
                project, message, "Sema Code", confirmLabel, cancelLabel,
                com.intellij.openapi.ui.Messages.getWarningIcon(),
            ) == com.intellij.openapi.ui.Messages.YES
            replyEditor(reqId, mapOf("confirmed" to ok))
        }
    }

    /**
     * 聊天页深链打开配置子页（对齐 VSCode openConfig → configWebview.show → navigateTo）。
     * 打开/聚焦配置 tab（复用 SemaConfigVirtualFile，等价 VSCode panel.reveal），再把 navigateTo
     * 经总线推给配置 webview——配置页那条 gRPC 连接推不到，只能走 SemaPanelBus。空 page 默认模型配置。
     */
    private fun handleOpenConfig(obj: JsonObject) {
        val page = obj.str("page").ifEmpty { "models" } // 对齐 VSCode 的 page || 'models'
        val taskId = obj.str("taskId")
        ApplicationManager.getApplication().invokeLater {
            FileEditorManager.getInstance(project).openFile(SemaConfigVirtualFile.get(project), true)
        }
        val uiMsg = linkedMapOf<String, Any?>("command" to "navigateTo", "page" to page)
        if (taskId.isNotEmpty()) uiMsg["taskId"] = taskId
        bus.pushToConfig(editorFrame(uiMsg))
    }

    /**
     * 配置页任务面板「任务详情」→ 聊天页弹子代理详情（对齐 VSCode openAgentDetail → 聊天页 openAgentDetail 弹窗）。
     * 跨面板走总线推聊天 webview；任务归属会话非当前活跃时先切会话（React 按 sessionId 渲染对应消息列表，
     * 弹窗才能命中），并激活聊天 ToolWindow 让其可见。
     */
    private fun handleOpenAgentDetail(obj: JsonObject) {
        val taskId = obj.str("taskId")
        if (taskId.isEmpty()) return
        val sessionId = obj.str("sessionId")
        if (sessionId.isNotEmpty() && sessionId != bus.activeId) {
            bus.pushToChat(editorFrame(linkedMapOf("type" to "switchToSession", "sessionId" to sessionId)))
        }
        val detail = linkedMapOf<String, Any?>("type" to "openAgentDetail", "taskId" to taskId)
        if (sessionId.isNotEmpty()) detail["sessionId"] = sessionId
        bus.pushToChat(editorFrame(detail))
        ApplicationManager.getApplication().invokeLater {
            com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("Sema Code")?.activate(null)
        }
    }

    /** 包一条 UI 消息为 editor message 帧（transport 会以 window.message 灌给 React App）。 */
    private fun editorFrame(uiMsg: Map<String, Any?>): String {
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("message", gson.toJson(uiMsg))
        }
        return gson.toJson(frame)
    }

    /**
     * 会话历史本地读写（channel=editor, type=history）。
     * - reportState（无 reqId，即发即忘）：聊天 controller 上报打开/活跃会话 → 更新徽标源并刷新历史面板。
     * - list / save / delete（带 reqId 应答）：历史面板 / 聊天存档流。
     * - load（即发即忘）：读会话 → 经总线推给聊天 webview 重放，并聚焦聊天 ToolWindow。
     */
    private fun handleHistory(obj: JsonObject) {
        val reqId = obj.str("reqId")
        val payload = runCatching { gson.fromJson(obj.str("payload"), JsonObject::class.java) }.getOrNull() ?: JsonObject()
        val op = payload.str("op")

        if (op == "reportState") {
            val openIds = payload.get("openIds")
                ?.takeIf { it.isJsonArray }
                ?.let { gson.fromJson(it, Array<String>::class.java).toList() } ?: emptyList()
            val activeId = payload.get("activeId")?.takeIf { !it.isJsonNull }?.asString
            bus.setOpenState(openIds, activeId)
            pushHistoryList()
            return
        }

        val data: Any = try {
            when (op) {
                "list" -> history.list(bus.openIds, bus.activeId)
                "save" -> { history.save(payload.getAsJsonObject("session")); emptyMap<String, Any?>() }
                "delete" -> {
                    val id = payload.str("sessionId")
                    if (bus.openIds.contains(id)) {
                        // 对齐 VSCode：拒删已打开会话并提示（VSCode 为 showWarningMessage 提示条，JB 用模态提示替代）
                        val msg = SemaBundle.message("history.cannotDeleteOpen")
                        ApplicationManager.getApplication().invokeLater {
                            com.intellij.openapi.ui.Messages.showWarningDialog(project, msg, "Sema Code")
                        }
                        throw IllegalStateException(msg)
                    }
                    history.delete(id); emptyMap<String, Any?>()
                }
                "load" -> { handleHistoryLoad(payload.str("sessionId")); emptyMap<String, Any?>() }
                else -> emptyMap<String, Any?>()
            }
        } catch (e: Exception) {
            if (reqId.isNotEmpty()) replyEditorError(reqId, e.message ?: SemaBundle.message("error.history"))
            return
        }
        // 增删后主动刷新已打开的历史面板
        if (op == "save" || op == "delete") pushHistoryList()
        if (reqId.isNotEmpty()) replyEditor(reqId, data)
    }

    /** 读会话 → 推给聊天 webview 重放（走 host 通路），并聚焦聊天 ToolWindow。 */
    private fun handleHistoryLoad(sessionId: String) {
        val session = history.get(sessionId) ?: return
        val uiMsg = JsonObject().apply {
            addProperty("type", "loadHistorySession")
            add("session", session)
        }
        val frame = JsonObject().apply {
            addProperty("channel", "host")
            addProperty("message", gson.toJson(uiMsg))
        }
        bus.pushToChat(gson.toJson(frame))
        ApplicationManager.getApplication().invokeLater {
            com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("Sema Code")?.activate(null)
        }
    }

    /** 会话历史变化时，主动把最新列表推给已打开的历史面板（updateSessions，走 editor message 帧）。 */
    private fun pushHistoryList() {
        if (!bus.hasHistory()) return
        val uiMsg = LinkedHashMap<String, Any?>(history.list(bus.openIds, bus.activeId))
        uiMsg["type"] = "updateSessions"
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("message", gson.toJson(uiMsg))
        }
        bus.pushToHistory(gson.toJson(frame))
    }

    private fun mergeInitConfig(payloadJson: String): String {
        val payload = runCatching { gson.fromJson(payloadJson, JsonObject::class.java) }.getOrNull() ?: JsonObject()
        val merged = LinkedHashMap<String, Any?>(sysConfig.coreSubset())
        merged["disabledTools"] = sysConfig.getDisabledTools()
        // webview 传入的 init 覆盖项优先级更高（当前为空对象，预留）
        for ((k, v) in payload.entrySet()) merged[k] = jsonToAny(v)
        return gson.toJson(merged)
    }

    private fun pushGrpcEvent(ev: SemaEvent) {
        val frame = JsonObject().apply {
            addProperty("channel", "grpc")
            addProperty("event", ev.event())
            addProperty("data", ev.data())
            addProperty("cmdId", ev.cmdId())
            addProperty("sessionId", ev.sessionId())
        }
        pushToWeb(gson.toJson(frame))
    }

    private fun replyEditor(reqId: String, data: Any) {
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("reqId", reqId)
            addProperty("data", gson.toJson(data))
        }
        pushToWeb(gson.toJson(frame))
    }

    private fun replyEditorError(reqId: String, message: String) {
        val frame = JsonObject().apply {
            addProperty("channel", "editor")
            addProperty("reqId", reqId)
            addProperty("error", message)
        }
        pushToWeb(gson.toJson(frame))
    }

    fun dispose() {
        sidecar.disconnect(conn)
    }

    private fun platform(): String {
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.contains("mac") || os.contains("darwin") -> "darwin"
            os.contains("win") -> "win32"
            else -> "linux"
        }
    }

    private fun toMap(el: com.google.gson.JsonElement?): Map<String, Any?> {
        if (el == null || !el.isJsonObject) return emptyMap()
        val out = LinkedHashMap<String, Any?>()
        for ((k, v) in el.asJsonObject.entrySet()) out[k] = jsonToAny(v)
        return out
    }

    private fun jsonToAny(el: com.google.gson.JsonElement?): Any? {
        if (el == null || el.isJsonNull) return null
        if (el.isJsonPrimitive) {
            val p = el.asJsonPrimitive
            return when {
                p.isBoolean -> p.asBoolean
                p.isNumber -> { val d = p.asDouble; if (d == d.toLong().toDouble()) d.toLong() else d }
                else -> p.asString
            }
        }
        if (el.isJsonArray) return el.asJsonArray.map { jsonToAny(it) }
        if (el.isJsonObject) return toMap(el)
        return null
    }

    private fun JsonObject.str(key: String): String = get(key)?.takeIf { !it.isJsonNull }?.asString ?: ""
}
