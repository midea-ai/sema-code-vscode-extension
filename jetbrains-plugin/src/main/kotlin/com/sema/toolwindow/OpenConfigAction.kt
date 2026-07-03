package com.sema.toolwindow

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.sema.config.SemaConfigVirtualFile

/**
 * Sema Code 工具窗口标题栏的「配置」快捷按钮（对齐 VSCode 视图标题栏的 openConfig 命令）。
 * 点击 → 在编辑器主区域打开/聚焦配置 tab（复用聊天页 openConfig 的同一虚拟文件）。
 */
class OpenConfigAction : AnAction("配置", "打开 Code Agent 配置", AllIcons.General.Settings) {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        FileEditorManager.getInstance(project).openFile(SemaConfigVirtualFile.get(project), true)
    }
}
