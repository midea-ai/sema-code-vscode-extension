package com.sema.jcef

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.UIUtil
import java.awt.Color

/** 把当前 IDE 主题色映射成 React UI（原为 VSCode 设计）所需的 --vscode-* CSS 变量，自动适配明/暗主题。 */
object Theme {
    fun cssVariables(): String {
        val scheme = EditorColorsManager.getInstance().globalScheme
        val fg = UIUtil.getLabelForeground()
        val bg = UIUtil.getPanelBackground()
        val editorBg = scheme.defaultBackground
        val editorFg = scheme.defaultForeground ?: fg
        val desc = UIUtil.getContextHelpForeground()
        val inputBg = UIUtil.getTextFieldBackground()
        val inputFg = UIUtil.getTextFieldForeground()
        val selBg = UIUtil.getListSelectionBackground(true)
        val selFg = UIUtil.getListSelectionForeground(true)
        val hoverBg = UIUtil.getListSelectionBackground(false)
        val border = JBColor.border()
        val tipBg = UIUtil.getToolTipBackground()
        val tipFg = UIUtil.getToolTipForeground()
        val link = if (JBColor.isBright()) Color(0x00, 0x66, 0xCC) else Color(0x37, 0x94, 0xFF)
        // chat 内 React diff 配色对齐 IDE 原生 diff 的词级模式（TextDiffTypeFactory）：
        // 词级块 = DIFF_INSERTED/DIFF_DELETED 的背景主色；整行 = "ignored" 浅色 ——
        // 配色方案在前景色字段显式定义了就用它，否则按 IDE 同款算法向编辑器背景混 60%。
        val diffInsAttr = scheme.getAttributes(com.intellij.openapi.diff.DiffColors.DIFF_INSERTED)
        val diffDelAttr = scheme.getAttributes(com.intellij.openapi.diff.DiffColors.DIFF_DELETED)
        val diffInsBg = diffInsAttr?.backgroundColor
        val diffDelBg = diffDelAttr?.backgroundColor
        val diffInsLineBg = diffInsAttr?.foregroundColor ?: diffInsBg?.let { mix(it, editorBg, 0.6) }
        val diffDelLineBg = diffDelAttr?.foregroundColor ?: diffDelBg?.let { mix(it, editorBg, 0.6) }

        val sb = StringBuilder(":root{")
        fun v(name: String, value: String) { sb.append("--vscode-").append(name).append(':').append(value).append(';') }

        v("foreground", hex(fg))
        v("descriptionForeground", hex(desc))
        v("editor-foreground", hex(editorFg))
        v("editor-background", hex(editorBg))
        v("sideBar-background", hex(bg))
        // chat 页 body 底色专用：取树背景与 Project 工具窗一致（Light 下 panel 灰≠tree 白）。
        v("sema-chatPageBg", hex(UIUtil.getTreeBackground()))
        v("panel-sectionHeader-background", hex(bg))
        v("input-background", hex(inputBg))
        v("input-foreground", hex(inputFg))
        v("input-placeholderForeground", hex(desc))
        v("input-border", hex(border))
        v("button-background", hex(selBg))
        v("button-foreground", hex(selFg))
        v("button-hoverBackground", hex(shade(selBg)))
        v("button-secondaryBackground", hex(hoverBg))
        v("button-secondaryForeground", hex(fg))
        v("button-secondaryHoverBackground", hex(hoverBg))
        // badge 是低调标签（工具标签 / NPX / mcp 描述等），不用明亮 selBg，改用前景色低透明叠加 + 正常前景文字。
        v("badge-background", rgba(fg, 0.12))
        v("badge-foreground", hex(fg))
        v("list-hoverBackground", hex(hoverBg))
        v("list-activeSelectionBackground", hex(selBg))
        v("list-activeSelectionForeground", hex(selFg))
        v("panel-border", hex(border))
        v("focusBorder", hex(border))
        v("contrastBorder", hex(border))
        v("dropdown-border", hex(border))
        v("editorGroup-border", hex(border))
        v("editorGutter-background", hex(editorBg))
        v("editorLineNumber-foreground", hex(desc))
        v("textLink-foreground", hex(link))
        v("textLink-activeForeground", hex(link))
        v("editorHoverWidget-background", hex(tipBg))
        v("editorHoverWidget-foreground", hex(tipFg))
        v("editorHoverWidget-border", hex(border))
        v("notifications-background", hex(tipBg))
        v("notifications-foreground", hex(tipFg))
        v("notifications-border", hex(border))
        v("scrollbarSlider-background", rgba(fg, 0.25))
        v("scrollbarSlider-hoverBackground", rgba(fg, 0.40))
        v("symbolIcon-variableForeground", hex(fg))
        v("toolbar-hoverBackground", hex(hoverBg))

        // 强调 / 状态色（静态，主题无关）
        v("terminal-ansiGreen", "#4ec9b0")
        v("terminal-ansiBrightCyan", "#29b8db")
        v("charts-green", "#4ec9b0")
        v("charts-purple", "#9575ff")
        // 与原生 diff 词级模式同源；配色方案缺省时回退到原写死值。
        v("diffEditor-insertedLineBackground", diffInsLineBg?.let { hex(it) } ?: "rgba(78,201,176,0.15)")
        v("diffEditor-removedLineBackground", diffDelLineBg?.let { hex(it) } ?: "rgba(244,135,113,0.15)")
        v("diffEditor-insertedTextBackground", diffInsBg?.let { hex(it) } ?: "rgba(78,201,176,0.35)")
        v("diffEditor-removedTextBackground", diffDelBg?.let { hex(it) } ?: "rgba(244,135,113,0.35)")
        v("notificationsWarningIcon-foreground", "#ffba49")
        v("inputValidation-warningBackground", "rgba(255,186,73,0.15)")
        v("inputValidation-warningForeground", hex(fg))
        v("inputValidation-warningBorder", "#ffba49")

        v("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
        v("editor-font-family", "'JetBrains Mono', Menlo, Consolas, monospace")

        sb.append("}")
        return sb.toString()
    }

    /**
     * VSCode webview 宿主会按主题在 body 挂 vscode-light / vscode-dark 类，共享样式
     * （如 highlight.css 的 light 语法配色）依赖它选择配色，JB 侧按 IDE 明暗补齐同名类。
     */
    fun themeClass(): String = if (JBColor.isBright()) "vscode-light" else "vscode-dark"

    /** chat 页覆盖 CSS：把背景 token 重指到 Project 树背景，使整个 chat 底色与 Project 一致（html:root 压过 bundle）。 */
    fun chatPageBgOverrideCss(): String =
        "html:root{--chat-bg-primary:var(--vscode-sema-chatPageBg);--chat-page-bg:var(--vscode-sema-chatPageBg);}"

    /**
     * config 页覆盖 CSS：选中标签（.tab-item.active）文字原用 button-background，JB 下它与
     * 背景 list-activeSelectionBackground 同色而看不见；改用配套的 list-activeSelectionForeground。
     */
    fun configPageOverrideCss(): String =
        "html:root .tab-item.active{color:var(--vscode-list-activeSelectionForeground);}"

    /** 订阅 IDE 换肤/配色变化，重算变量写回 <style id="sema-theme">，面板无需重载即随主题刷新（绑 parent，随面板注销）。 */
    fun installLiveUpdate(browser: JBCefBrowser, parent: Disposable) {
        val conn = ApplicationManager.getApplication().messageBus.connect(parent)
        // 关键：换肤事件（LafManagerListener）是在换肤过程中同步触发的，此刻 JBColor/UIUtil 的颜色缓存
        // 与 EditorColorsManager 的编辑器配色都可能还没刷完 —— 直接读会得到新旧混合的颜色，导致样式割裂。
        // 因此推迟到下一个 EDT 周期再读（善后已跑完），并用 pending 合并 LAF + 编辑器配色两个事件为最终一次稳定读取。
        val pending = java.util.concurrent.atomic.AtomicBoolean(false)
        val refresh = Runnable {
            if (!pending.compareAndSet(false, true)) return@Runnable
            ApplicationManager.getApplication().invokeLater {
                pending.set(false)
                if (Disposer.isDisposed(parent)) return@invokeLater
                val js = "var s=document.getElementById('sema-theme'); if(s) s.textContent=${jsLiteral(cssVariables())};" +
                    "var b=document.body; if(b){b.classList.remove('vscode-light','vscode-dark');b.classList.add('${themeClass()}');}"
                browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
            }
        }
        conn.subscribe(LafManagerListener.TOPIC, LafManagerListener { refresh.run() })
        conn.subscribe(EditorColorsManager.TOPIC, EditorColorsListener { refresh.run() })
    }

    /** 把 CSS 文本转成安全的 JS 字符串字面量（供 executeJavaScript 内联）。 */
    private fun jsLiteral(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\""

    private fun hex(c: Color) = String.format("#%02x%02x%02x", c.red, c.green, c.blue)
    /** c1 向 c2 线性混合 ratio（0=纯 c1，1=纯 c2），同 ColorUtil.mix。 */
    private fun mix(c1: Color, c2: Color, ratio: Double): Color = Color(
        (c1.red + (c2.red - c1.red) * ratio).toInt().coerceIn(0, 255),
        (c1.green + (c2.green - c1.green) * ratio).toInt().coerceIn(0, 255),
        (c1.blue + (c2.blue - c1.blue) * ratio).toInt().coerceIn(0, 255)
    )
    private fun rgba(c: Color, a: Double) = "rgba(${c.red},${c.green},${c.blue},$a)"
    private fun shade(c: Color): Color = if (JBColor.isBright()) c.darker() else c.brighter()
}
