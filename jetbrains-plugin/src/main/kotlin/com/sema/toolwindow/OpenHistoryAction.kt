package com.sema.toolwindow

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.sema.config.SemaHistoryVirtualFile
import com.sema.config.SemaBundle

/**
 * 工具窗口标题栏的「历史会话」按钮（对齐 VSCode 视图标题栏的 openHistory 命令）。
 * 点击 → 在编辑器主区域打开/聚焦历史会话 tab（编辑器区独立 tab，同配置页）。
 * 文案在 update() 里按当前语言设置：构造参数定死，切语言后需重启才会变。
 */
class OpenHistoryAction : AnAction(AllIcons.Vcs.History) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.text = SemaBundle.message("action.openHistory.text")
        e.presentation.description = SemaBundle.message("action.openHistory.description")
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        FileEditorManager.getInstance(project).openFile(SemaHistoryVirtualFile.get(project), true)
    }
}
