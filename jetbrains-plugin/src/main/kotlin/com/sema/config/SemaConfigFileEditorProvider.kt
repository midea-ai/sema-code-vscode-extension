package com.sema.config

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/** 只接受 SemaConfigVirtualFile → 用 JCEF 配置页承载；隐藏默认文本编辑器。 */
class SemaConfigFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is SemaConfigVirtualFile
    override fun createEditor(project: Project, file: VirtualFile): FileEditor = SemaConfigFileEditor(project, file)
    override fun getEditorTypeId(): String = "sema-config-editor"
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
