package com.sema.bridge

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.sema.config.SessionHistoryManager
import com.sema.config.SystemConfigManager
import com.sema.editor.EditorOps
import com.sema.grpc.BridgeEvent
import com.sema.sidecar.SidecarService
import java.io.File

/**
 * 哑转发桥：连接单个 JCEF 面板与共享 sidecar。
 * - channel=grpc  → 转发给 sidecar（sema-core 透明镜像，桥不解释内容）；仅 init 会合并本地持久化配置做 seed
 * - channel=editor → 本地编辑器操作（VFS / diff / 打开文件），或 systemConfig 本地持久化（请求/应答）
 *
 * 协议逻辑全在 webview JS（复用 semaSessionWrapper / config-controller），这里只搬运。
 * 每个面板一个 MessageBridge → 一条独立 gRPC 连接（Conn）。
 */
class MessageBridge(
    private val project: Project,
    private val pushToWeb: (String) -> Unit,
) {
    private val log = logger<MessageBridge>()
    private val gson = Gson()
    private val sidecar = project.getService(SidecarService::class.java)
    private val editorOps = EditorOps(project, pushToWeb)
    private val sysConfig = ApplicationManager.getApplication().getService(SystemConfigManager::class.java)
    private val history = project.getService(SessionHistoryManager::class.java)
    private val bus = project.getService(SemaPanelBus::class.java)
    // 构造即注册连接：命令先入缓冲队列，避免 web 的命令早于 onLoadEnd（startSidecar）时被丢弃。
    private val conn: SidecarService.Conn = sidecar.connect { ev -> pushGrpcEvent(ev) }

    fun startSidecar() {
        val dir = resolveSidecarDir()
        if (dir == null) {
            log.error("未找到 sema-grpc sidecar 目录；请设置 JVM 参数 -Dsema.sidecar.dir=<绝对路径>")
            return
        }
        sidecar.startProcess(dir)
    }

    /** 来自 webview 的消息（JSON 字符串）。 */
    fun onWebMessage(json: String) {
        val obj = runCatching { gson.fromJson(json, JsonObject::class.java) }.getOrNull() ?: run {
            log.warn("无法解析 web 消息: $json")
            return
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
                    "history" -> handleHistory(obj)
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
            replyEditorError(reqId, e.message ?: "systemConfig 操作失败")
            return
        }
        replyEditor(reqId, data)
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
                    if (bus.openIds.contains(id)) throw IllegalStateException("无法删除已打开的会话")
                    history.delete(id); emptyMap<String, Any?>()
                }
                "load" -> { handleHistoryLoad(payload.str("sessionId")); emptyMap<String, Any?>() }
                else -> emptyMap<String, Any?>()
            }
        } catch (e: Exception) {
            if (reqId.isNotEmpty()) replyEditorError(reqId, e.message ?: "history 操作失败")
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

    private fun pushGrpcEvent(ev: BridgeEvent) {
        val frame = JsonObject().apply {
            addProperty("channel", "grpc")
            addProperty("event", ev.event)
            addProperty("data", ev.data)
            addProperty("cmdId", ev.cmdId)
            addProperty("sessionId", ev.sessionId)
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

    /**
     * 定位 sidecar 目录（含可执行的 server.js + proto）。
     * - dev：环境变量 SEMA_SIDECAR_DIR（沙箱 IDE 子进程继承）/ 系统属性 -Dsema.sidecar.dir，指向 sema-grpc。
     * - 打包：sidecar 资源在插件 jar 内，node 无法直接执行 → 从 classpath 释放到 ~/.sema/jb-sidecar 再用。
     */
    private fun resolveSidecarDir(): File? {
        val candidate = System.getenv("SEMA_SIDECAR_DIR") ?: System.getProperty("sema.sidecar.dir")
        candidate?.let { File(it) }?.takeIf { it.exists() }?.let { return it }
        return extractBundledSidecar()
    }

    /** 把插件 jar 里的 sidecar/server.js(+proto) 释放到用户缓存目录，返回该目录。 */
    private fun extractBundledSidecar(): File? {
        val loader = javaClass.classLoader
        val home = System.getProperty("user.home") ?: return null
        val dir = File(home, ".sema/jb-sidecar").apply { mkdirs() }
        val serverOut = File(dir, "server.js")
        return try {
            val input = loader.getResourceAsStream("sidecar/server.js")
            if (input == null) {
                if (serverOut.exists()) return dir // 释放不到但有旧的，凑合用
                log.error("插件内未找到 sidecar/server.js（打包缺失？）")
                return null
            }
            input.use { i -> serverOut.outputStream().use { i.copyTo(it) } }
            loader.getResourceAsStream("sidecar/proto/sema.proto")?.use { i ->
                val protoDir = File(dir, "proto").apply { mkdirs() }
                File(protoDir, "sema.proto").outputStream().use { i.copyTo(it) }
            }
            dir
        } catch (e: Exception) {
            log.warn("释放 sidecar 失败：${e.message}", e)
            if (serverOut.exists()) dir else null
        }
    }

    private fun JsonObject.str(key: String): String = get(key)?.takeIf { !it.isJsonNull }?.asString ?: ""
}
