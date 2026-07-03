package com.sema.config

import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.testFramework.LightVirtualFile

/**
 * 历史会话页的标记性虚拟文件——承载于编辑器主区域的 tab（对齐 VSCode createWebviewPanel(ViewColumn.One)）。
 * 每个 project 复用同一实例，保证 FileEditorManager.openFile 能聚焦已打开的 tab（= VSCode panel.reveal）。
 */
class SemaHistoryVirtualFile private constructor() : LightVirtualFile("历史会话") {
    override fun getPath(): String = "sema://history"

    companion object {
        private val KEY = Key.create<SemaHistoryVirtualFile>("sema.history.virtualFile")

        fun get(project: Project): SemaHistoryVirtualFile {
            project.getUserData(KEY)?.let { return it }
            val f = SemaHistoryVirtualFile()
            project.putUserData(KEY, f)
            return f
        }
    }
}
