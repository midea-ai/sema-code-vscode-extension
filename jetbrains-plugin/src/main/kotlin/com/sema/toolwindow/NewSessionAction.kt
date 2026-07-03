package com.sema.toolwindow

import com.google.gson.JsonObject
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.sema.bridge.SemaPanelBus

/**
 * 工具窗口标题栏的「新建会话」按钮（对齐 VSCode 视图标题栏的 newSession 命令）。
 * 点击 → 经面板总线向聊天 webview 下发 createSession（controller 建新会话 tab 并激活）。
 */
class NewSessionAction : AnAction("新建会话", "开始新的会话", AllIcons.General.Add) {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val bus = project.getService(SemaPanelBus::class.java)
        val uiMsg = JsonObject().apply { addProperty("type", "createSession") }
        val frame = JsonObject().apply {
            addProperty("channel", "host")
            addProperty("message", uiMsg.toString())
        }
        bus.pushToChat(frame.toString())
    }
}
