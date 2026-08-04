package com.sema.jcef

import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.handler.CefDisplayHandlerAdapter
import java.awt.AWTEvent
import java.awt.MouseInfo
import java.awt.Toolkit
import java.awt.event.AWTEventListener
import java.awt.event.HierarchyEvent
import java.awt.event.MouseEvent
import java.awt.event.WindowEvent
import javax.swing.BorderFactory
import javax.swing.JLabel
import javax.swing.Popup
import javax.swing.PopupFactory
import javax.swing.SwingUtilities

/**
 * JCEF 默认不渲染 HTML `title` 悬浮提示。设 Swing toolTipText 无效——原生浏览器吞掉鼠标事件，
 * ToolTipManager 收不到。这里接管 CEF onTooltip：有文本时在鼠标处弹一个 Popup，文本为空时收起。
 *
 * 收起不能只依赖 CEF 的下一次 onTooltip 回调：悬浮时点击跳转（openFile 顶替编辑器 tab）后
 * 浏览器组件被隐藏，CEF 不再回调，popup 会永久残留。故另加两类兜底（对齐原生浏览器行为）：
 * 组件不可见即收起；popup 弹出期间任意鼠标按下 / 宿主窗口失活即收起（全局 AWT 监听随弹随注册，收起即注销，无常驻）。
 */
object Tooltips {
    fun install(browser: JBCefBrowser) {
        var popup: Popup? = null
        var shownText: String? = null
        var awtListener: AWTEventListener? = null

        // 所有调用均在 EDT（invokeLater / AWT 事件派发线程）
        fun hide() {
            popup?.hide()
            popup = null
            shownText = null
            awtListener?.let { Toolkit.getDefaultToolkit().removeAWTEventListener(it) }
            awtListener = null
        }

        // 跳转/切 tab 后组件不可见，CEF 不会再发 onTooltip("") → 以可见性变化兜底收起
        browser.component.addHierarchyListener { e ->
            if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() != 0L && !browser.component.isShowing) hide()
        }

        browser.jbCefClient.addDisplayHandler(object : CefDisplayHandlerAdapter() {
            override fun onTooltip(cefBrowser: CefBrowser?, text: String?): Boolean {
                ApplicationManager.getApplication().invokeLater {
                    val t = text?.takeIf { it.isNotBlank() }
                    // CEF 在同一元素内鼠标移动会反复回调（文本不变）；文本没变则保持原 popup 原位，避免闪动/跟随。
                    if (t == shownText) return@invokeLater
                    hide()
                    shownText = t
                    if (t == null) return@invokeLater
                    val loc = MouseInfo.getPointerInfo()?.location ?: return@invokeLater
                    val p = PopupFactory.getSharedInstance()
                        .getPopup(browser.component, buildLabel(t), loc.x + 12, loc.y + 18)
                    popup = p
                    p.show()
                    // OSR 模式下页面内的鼠标按下也走 Swing 事件通道，全局监听可见；
                    // popup 自身是非聚焦窗口，不会反过来触发宿主窗口失活。
                    val listener = AWTEventListener { ev ->
                        when {
                            ev is MouseEvent && ev.id == MouseEvent.MOUSE_PRESSED -> hide()
                            ev is WindowEvent && ev.id == WindowEvent.WINDOW_DEACTIVATED &&
                                ev.window === SwingUtilities.getWindowAncestor(browser.component) -> hide()
                        }
                    }
                    Toolkit.getDefaultToolkit().addAWTEventListener(listener, AWTEvent.MOUSE_EVENT_MASK or AWTEvent.WINDOW_EVENT_MASK)
                    awtListener = listener
                }
                return true
            }
        }, browser.cefBrowser)
    }

    /** 构造一个仿 IDE tooltip 外观的标签；长文本用固定宽度 html 换行，短文本单行。 */
    private fun buildLabel(text: String): JLabel {
        val safe = escapeHtml(text)
        val body = if (text.length > 30) "<div style='width:260px'>$safe</div>" else safe
        return JLabel("<html>$body</html>").apply {
            isOpaque = true
            background = UIUtil.getToolTipBackground()
            foreground = UIUtil.getToolTipForeground()
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(JBColor.border()),
                JBUI.Borders.empty(4, 8),
            )
        }
    }

    private fun escapeHtml(s: String): String =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
}
