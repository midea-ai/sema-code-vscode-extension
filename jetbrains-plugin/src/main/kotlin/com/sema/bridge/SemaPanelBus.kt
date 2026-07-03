package com.sema.bridge

import com.intellij.openapi.components.Service
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * 项目级面板总线：让标题栏 Action / 历史面板 能向「聊天面板 webview」推消息（宿主 → controller 入站）。
 *
 * 背景：ChatPanel 是 ToolWindowFactory 里用完即弃的局部对象，没有任何 project 级单例持有它，
 * 而阶段 4 的「新建会话」按钮、「历史 → 聊天加载」都必须向已存在的聊天 webview 发消息。
 * 本总线补齐这条通路：ChatPanel/HistoryPanel 构造时把各自的 pushToWeb 注册进来。
 *
 * 就绪时序：pushToChat 若在聊天 webview 未就绪时调用（面板刚建、bundle 未加载），先缓冲；
 * 聊天 controller 首次 reportState（此时 webview 必已就绪）视为就绪信号 → flush。
 */
@Service(Service.Level.PROJECT)
class SemaPanelBus {
    @Volatile private var chatPush: ((String) -> Unit)? = null
    @Volatile private var chatReady = false
    private val pendingChat = ConcurrentLinkedQueue<String>()

    @Volatile private var historyPush: ((String) -> Unit)? = null

    /** 聊天 controller 上报的打开会话 id 列表与活跃 id（历史列表徽标/排序用）。 */
    @Volatile var openIds: List<String> = emptyList()
        private set
    @Volatile var activeId: String? = null
        private set

    // ── 聊天面板 ──────────────────────────────────────────────────────────────

    @Synchronized
    fun registerChat(push: (String) -> Unit) {
        chatPush = push
        chatReady = false // 新面板/新 webview：等 controller 上报状态再视为就绪
    }

    @Synchronized
    fun unregisterChat(push: (String) -> Unit) {
        if (chatPush === push) {
            chatPush = null
            chatReady = false
        }
    }

    /** 聊天 controller 上报状态：更新徽标源；首次上报视为 webview 就绪 → flush 缓冲的入站命令。 */
    @Synchronized
    fun setOpenState(openIds: List<String>, activeId: String?) {
        this.openIds = openIds
        this.activeId = activeId
        val p = chatPush
        if (!chatReady && p != null) {
            chatReady = true
            while (true) { val m = pendingChat.poll() ?: break; p(m) }
        }
    }

    /** 向聊天 webview 推一帧（未就绪则缓冲）。 */
    @Synchronized
    fun pushToChat(json: String) {
        val p = chatPush
        if (p != null && chatReady) p(json) else pendingChat.add(json)
    }

    // ── 历史面板 ──────────────────────────────────────────────────────────────

    fun registerHistory(push: (String) -> Unit) { historyPush = push }

    fun unregisterHistory(push: (String) -> Unit) { if (historyPush === push) historyPush = null }

    fun hasHistory(): Boolean = historyPush != null

    fun pushToHistory(json: String) { historyPush?.invoke(json) }
}
