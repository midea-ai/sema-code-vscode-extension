package com.sema.jcef

import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.handler.CefDisplayHandlerAdapter
import java.awt.MouseInfo
import javax.swing.BorderFactory
import javax.swing.JLabel
import javax.swing.Popup
import javax.swing.PopupFactory

/**
 * JCEF 默认不渲染 HTML `title` 悬浮提示。设 Swing toolTipText 无效——原生浏览器吞掉鼠标事件，
 * ToolTipManager 收不到。这里接管 CEF onTooltip：有文本时在鼠标处弹一个 Popup，文本为空时收起。
 */
object Tooltips {
    fun install(browser: JBCefBrowser) {
        val holder = arrayOfNulls<Popup>(1)
        val shownText = arrayOfNulls<String>(1)
        browser.jbCefClient.addDisplayHandler(object : CefDisplayHandlerAdapter() {
            override fun onTooltip(cefBrowser: CefBrowser?, text: String?): Boolean {
                ApplicationManager.getApplication().invokeLater {
                    val t = text?.takeIf { it.isNotBlank() }
                    // CEF 在同一元素内鼠标移动会反复回调（文本不变）；文本没变则保持原 popup 原位，避免闪动/跟随。
                    if (t == shownText[0]) return@invokeLater
                    holder[0]?.hide()
                    holder[0] = null
                    shownText[0] = t
                    if (t == null) return@invokeLater
                    val loc = MouseInfo.getPointerInfo()?.location ?: return@invokeLater
                    val popup = PopupFactory.getSharedInstance()
                        .getPopup(browser.component, buildLabel(t), loc.x + 12, loc.y + 18)
                    holder[0] = popup
                    popup.show()
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
