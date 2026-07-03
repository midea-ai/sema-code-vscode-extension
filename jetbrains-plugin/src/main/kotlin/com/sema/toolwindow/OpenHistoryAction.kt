package com.sema.toolwindow

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.sema.config.SemaHistoryVirtualFile

/**
 * 工具窗口标题栏的「历史会话」按钮（对齐 VSCode 视图标题栏的 openHistory 命令）。
 * 点击 → 在编辑器主区域打开/聚焦历史会话 tab（编辑器区独立 tab，同配置页）。
 */
class OpenHistoryAction : AnAction("历史会话", "查看历史会话", AllIcons.Vcs.History) {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        FileEditorManager.getInstance(project).openFile(SemaHistoryVirtualFile.get(project), true)
    }
}
