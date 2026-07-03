package com.sema.config

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/** 只接受 SemaHistoryVirtualFile → 用 JCEF 历史会话页承载；隐藏默认文本编辑器。 */
class SemaHistoryFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is SemaHistoryVirtualFile
    override fun createEditor(project: Project, file: VirtualFile): FileEditor = SemaHistoryFileEditor(project, file)
    override fun getEditorTypeId(): String = "sema-history-editor"
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
