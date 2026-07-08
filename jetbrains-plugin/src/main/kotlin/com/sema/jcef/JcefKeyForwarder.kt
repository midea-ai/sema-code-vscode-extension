package com.sema.jcef

import com.intellij.ide.IdeEventQueue
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.KeyboardFocusManager
import java.awt.event.KeyEvent
import javax.swing.SwingUtilities

/** 把输入框专用快捷键在 IDE keymap 之前抢回给网页：拦到白名单键就往聚焦元素注入合成 keydown，交给 React 处理。 */
object JcefKeyForwarder {
    private val log = logger<JcefKeyForwarder>()

    fun install(browser: JBCefBrowser, parent: Disposable) {
        val component = browser.component
        IdeEventQueue.getInstance().addDispatcher(IdeEventQueue.EventDispatcher { e ->
            if (e !is KeyEvent || !isForwardable(e)) return@EventDispatcher false
            // 限定焦点在本面板内，避免误伤 IDE 其它区域
            val focusOwner = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
            if (focusOwner == null || !SwingUtilities.isDescendingFrom(focusOwner, component)) {
                return@EventDispatcher false
            }
            if (e.id == KeyEvent.KEY_PRESSED) injectKeydown(browser, e)
            e.consume()
            true
        }, parent)
    }

    // sendKeyEvent 在 mac 上对 Ctrl+字母 无效，改用纯 JS 派发合成事件，三平台一致。
    private fun injectKeydown(browser: JBCefBrowser, e: KeyEvent) {
        val ch = e.keyCode.toChar()
        val key = if (e.isShiftDown) ch.uppercaseChar() else ch.lowercaseChar()
        val js = "(function(){var el=document.activeElement||document.body;" +
            "el.dispatchEvent(new KeyboardEvent('keydown',{" +
            "key:'$key',code:'Key${ch.uppercaseChar()}'," +
            "ctrlKey:${e.isControlDown},metaKey:${e.isMetaDown}," +
            "shiftKey:${e.isShiftDown},altKey:${e.isAltDown}," +
            "bubbles:true,cancelable:true}));})();"
        runCatching { browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0) }
            .onFailure { log.warn("[sema][key] 注入合成 keydown 失败", it) }
    }

    // 只抢有现成 React 处理器、跨平台语义无歧义的键；Ctrl 系要求「有 Ctrl 且无 Cmd」避免误吞 Cmd+C。
    // 刻意不含 Ctrl+A/E：无处理器，且 win/linux 下 Ctrl+A 惯例是全选，与 mac 行首冲突。
    private fun isForwardable(e: KeyEvent): Boolean {
        if (e.id != KeyEvent.KEY_PRESSED && e.id != KeyEvent.KEY_RELEASED) return false
        val m = e.modifiersEx
        if (m and KeyEvent.ALT_DOWN_MASK != 0) return false
        val ctrl = m and KeyEvent.CTRL_DOWN_MASK != 0
        val meta = m and KeyEvent.META_DOWN_MASK != 0
        val ctrlOnly = ctrl && !meta
        return when (e.keyCode) {
            KeyEvent.VK_Z -> ctrl || meta                          // 撤销 / 重做
            KeyEvent.VK_Y -> ctrlOnly                              // 重做（win/linux）
            KeyEvent.VK_C, KeyEvent.VK_W, KeyEvent.VK_U -> ctrlOnly // 停止 / 删词 / 删到行首
            else -> false
        }
    }
}
