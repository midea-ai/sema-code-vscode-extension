package com.sema.toolwindow

import com.google.gson.JsonObject
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.sema.bridge.SemaPanelBus
import com.sema.config.SemaBundle

/**
 * 工具窗口标题栏的「新建会话」按钮（对齐 VSCode 视图标题栏的 newSession 命令）。
 * 点击 → 经面板总线向聊天 webview 下发 createSession（controller 建新会话 tab 并激活）。
 * 文案在 update() 里按当前语言设置：构造参数定死，切语言后需重启才会变。
 */
class NewSessionAction : AnAction(AllIcons.General.Add) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.text = SemaBundle.message("action.newSession.text")
        e.presentation.description = SemaBundle.message("action.newSession.description")
    }

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
