package com.sema.config

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorStateLevel
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.sema.jcef.HistoryPanel
import java.beans.PropertyChangeListener
import javax.swing.JComponent

/** 历史会话页编辑器：把 HistoryPanel（JCEF）包成一个编辑器 tab。 */
class SemaHistoryFileEditor(project: Project, private val file: VirtualFile) : UserDataHolderBase(), FileEditor {
    private val panel = HistoryPanel(project)

    init {
        Disposer.register(this, panel)
    }

    override fun getComponent(): JComponent = panel.component
    override fun getPreferredFocusedComponent(): JComponent = panel.component
    override fun getName(): String = "历史会话"
    override fun getFile(): VirtualFile = file

    override fun setState(state: FileEditorState) {}
    override fun getState(level: FileEditorStateLevel): FileEditorState = FileEditorState.INSTANCE
    override fun isModified(): Boolean = false
    override fun isValid(): Boolean = true
    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}
    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun dispose() {}
}
