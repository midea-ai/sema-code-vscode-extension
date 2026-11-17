package com.sema.config

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.StoragePathMacros
import com.intellij.openapi.project.Project
import java.io.File
import java.util.Base64

/**
 * 会话历史本地存储（项目级）——对齐 VSCode 端 SessionHistoryManager（context.workspaceState，项目隔离）。
 *
 * 存储：整个 Session[] 序列化为一段 JSON 字符串放进工作区级 PersistentStateComponent
 * （= workspaceState：按项目、跟随 .idea/workspace.xml）。上限 50，新会话置顶。
 *
 * 与聊天 controller 的分工：controller（webview）负责构造/清洗会话记录并触发 save/list/delete，
 * 本类只管**存/取/排序**。活跃 id 与已打开 id 由聊天 controller 上报到 SemaPanelBus，list 时取用。
 */
@Service(Service.Level.PROJECT)
@State(name = "SemaSessionHistory", storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])
class SessionHistoryManager(private val project: Project) : PersistentStateComponent<SessionHistoryManager.State> {

    class State {
        @JvmField var sessionsJson: String = "[]"
    }

    private var myState = State()
    private val gson = Gson()

    override fun getState(): State = myState
    override fun loadState(state: State) { myState = state }

    companion object {
        private const val MAX_SESSIONS = 50

        /** 附图原图的扩展名 → media_type（core 按文件头识别后落盘为这四种）。 */
        private val ATTACHED_IMAGE_MEDIA_TYPES = mapOf(
            "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "gif" to "image/gif", "webp" to "image/webp",
        )
    }

    private fun read(): MutableList<JsonObject> {
        return runCatching {
            gson.fromJson(myState.sessionsJson, JsonArray::class.java)
                ?.mapNotNull { if (it.isJsonObject) it.asJsonObject else null }
                ?.toMutableList()
        }.getOrNull() ?: mutableListOf()
    }

    private fun write(list: List<JsonObject>) {
        val arr = JsonArray()
        list.forEach { arr.add(it) }
        myState.sessionsJson = gson.toJson(arr)
    }

    /** 取一条会话用于重放：存档里只留了路径的附图在这里读回原图（read() 每次新解析，改的是副本不是存档）。 */
    fun get(id: String): JsonObject? = read().firstOrNull { it.str("id") == id }?.also { restoreAttachments(it) }

    /** 用户消息里的附图数组；不是用户消息或没有附图时为 null。 */
    private fun userAttachments(message: JsonElement): JsonArray? {
        val obj = message.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        if (obj.str("type") != "user") return null
        return obj.get("attachments")?.takeIf { it.isJsonArray }?.asJsonArray
    }

    /** 存档前：附图有原图路径（core input:processing 带回）的不存 base64，加载时按路径读回，见 restoreAttachments。 */
    private fun stripAttachmentData(content: JsonArray) {
        for (message in content) {
            val attachments = userAttachments(message) ?: continue
            for (a in attachments) {
                val obj = a.takeIf { it.isJsonObject }?.asJsonObject ?: continue
                if (obj.str("path").isNotEmpty()) obj.remove("data")
            }
        }
    }

    /**
     * 存档里只留了原图路径的附图：读回原图补上 base64，气泡显示、回退回填与存档前一致。
     * media_type 按原图扩展名取（存档里记的是压缩后的类型，可能与原图不同）；
     * 原图已被清理的图去掉；旧存档自带 base64 的不动。
     */
    private fun restoreAttachments(session: JsonObject) {
        val content = session.get("content")?.takeIf { it.isJsonArray }?.asJsonArray ?: return
        for (message in content) {
            val attachments = userAttachments(message) ?: continue
            val restored = JsonArray()
            for (a in attachments) {
                val obj = a.takeIf { it.isJsonObject }?.asJsonObject
                val path = obj?.str("path").orEmpty()
                if (obj == null || path.isEmpty() || obj.str("data").isNotEmpty()) {
                    restored.add(a)
                    continue
                }
                val file = File(path)
                val bytes = runCatching { file.readBytes() }.getOrNull() ?: continue
                obj.addProperty("data", Base64.getEncoder().encodeToString(bytes))
                ATTACHED_IMAGE_MEDIA_TYPES[file.extension.lowercase()]?.let { obj.addProperty("media_type", it) }
                restored.add(obj)
            }
            val messageObj = message.asJsonObject
            if (restored.size() > 0) messageObj.add("attachments", restored) else messageObj.remove("attachments")
        }
    }

    /** upsert：更新保留 createdAt；新会话置顶，超上限截尾（对齐 VSCode saveSession）。 */
    fun save(session: JsonObject?) {
        if (session == null) return
        val id = session.str("id")
        val title = session.str("title")
        if (id.isEmpty() || title.isEmpty()) return
        val content = session.getAsJsonArray("content") ?: return
        if (content.size() == 0) return
        stripAttachmentData(content)

        val list = read()
        val now = System.currentTimeMillis()
        val idx = list.indexOfFirst { it.str("id") == id }
        val record = JsonObject().apply {
            addProperty("id", id)
            addProperty("title", title)
            add("content", content)
            addProperty("projectPath", project.basePath ?: "")
            session.get("agentMode")?.let { if (!it.isJsonNull) add("agentMode", it) }
        }
        if (idx >= 0) {
            val createdAt = list[idx].get("createdAt")?.takeIf { !it.isJsonNull }?.asLong ?: now
            record.addProperty("createdAt", createdAt)
            record.addProperty("updatedAt", now)
            list[idx] = record
        } else {
            record.addProperty("createdAt", now)
            record.addProperty("updatedAt", now)
            list.add(0, record)
            while (list.size > MAX_SESSIONS) list.removeAt(list.size - 1)
        }
        write(list)
    }

    fun delete(id: String) {
        val list = read()
        val filtered = list.filter { it.str("id") != id }
        if (filtered.size < list.size) write(filtered)
    }

    /** 列表 + 徽标源。排序：活跃(0) > 已打开(1) > 其余(2)，同级按 updatedAt 倒序（对齐 getAllSessions）。 */
    fun list(openIds: List<String>, activeId: String?): Map<String, Any?> {
        val openSet = openIds.toHashSet()
        fun rank(s: JsonObject): Int = when {
            s.str("id") == activeId -> 0
            openSet.contains(s.str("id")) -> 1
            else -> 2
        }
        val sorted = read().sortedWith(
            compareBy<JsonObject> { rank(it) }
                .thenByDescending { it.get("updatedAt")?.takeIf { e -> !e.isJsonNull }?.asLong ?: 0L }
        )
        return linkedMapOf(
            "sessions" to sorted,
            "currentSessionId" to activeId,
            "openSessionIds" to openIds,
        )
    }

    private fun JsonObject.str(key: String): String =
        get(key)?.takeIf { !it.isJsonNull }?.asString ?: ""
}
