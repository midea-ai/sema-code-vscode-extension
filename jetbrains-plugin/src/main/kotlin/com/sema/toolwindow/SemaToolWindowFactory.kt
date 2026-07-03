package com.sema.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.sema.jcef.ChatPanel

class SemaToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ChatPanel(project)
        val content = ContentFactory.getInstance().createContent(panel.component, "", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
        // 标题栏右上角三按钮（对齐 VSCode 视图标题栏：新建会话 / 历史 / 配置）
        toolWindow.setTitleActions(listOf(NewSessionAction(), OpenHistoryAction(), OpenConfigAction()))
    }
}
