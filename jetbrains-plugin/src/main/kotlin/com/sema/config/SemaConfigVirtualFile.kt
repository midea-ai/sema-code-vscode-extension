package com.sema.config

import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.testFramework.LightVirtualFile

/**
 * 配置页的标记性虚拟文件——承载于编辑器主区域的 tab。
 * 每个 project 复用同一实例，保证 FileEditorManager.openFile 能聚焦已打开的 tab（= VSCode 的 panel.reveal）。
 */
class SemaConfigVirtualFile private constructor() : LightVirtualFile(title()) {
    override fun getPath(): String = "sema://config"

    /** 编辑器 tab 标题取 presentableName：按当前语言动态返回（name 在构造时已定死）。 */
    override fun getPresentableName(): String = title()

    companion object {
        private val KEY = Key.create<SemaConfigVirtualFile>("sema.config.virtualFile")

        private fun title(): String = SemaBundle.message("config.title")

        fun get(project: Project): SemaConfigVirtualFile {
            project.getUserData(KEY)?.let { return it }
            val f = SemaConfigVirtualFile()
            project.putUserData(KEY, f)
            return f
        }
    }
}
