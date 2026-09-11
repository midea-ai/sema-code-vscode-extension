package com.sema.toolwindow

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.sema.config.SemaConfigVirtualFile
import com.sema.config.SemaBundle

/**
 * Sema Code 工具窗口标题栏的「配置」快捷按钮（对齐 VSCode 视图标题栏的 openConfig 命令）。
 * 点击 → 在编辑器主区域打开/聚焦配置 tab（复用聊天页 openConfig 的同一虚拟文件）。
 * 文案在 update() 里按当前语言设置：构造参数定死，切语言后需重启才会变。
 */
class OpenConfigAction : AnAction(AllIcons.General.Settings) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.text = SemaBundle.message("action.openConfig.text")
        e.presentation.description = SemaBundle.message("action.openConfig.description")
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        FileEditorManager.getInstance(project).openFile(SemaConfigVirtualFile.get(project), true)
    }
}
