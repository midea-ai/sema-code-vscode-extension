package com.sema.jcef

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.FileUtil
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.sema.bridge.MessageBridge
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandler
import org.cef.handler.CefLoadHandlerAdapter
import java.io.File
import javax.swing.JComponent

/**
 * 历史会话面板：JCEF 承载 sessionHistory 的 React UI（jb-sessionHistory.js）。
 *
 * 与 ChatPanel/ConfigPanel 同构，只换 bundle 与消息控制器（history-controller）。承载于编辑器主区域的
 * 独立 tab（SemaHistoryFileEditor）。会话历史读写走 MessageBridge 的 channel=editor,type=history。
 * 构造时把 pushToWeb 注册进 SemaPanelBus，让「会话变化 → 主动刷新列表」能推到本面板。
 */
class HistoryPanel(project: Project) : Disposable {
    private val log = logger<HistoryPanel>()
    private val browser = JBCefBrowser()
    private val hostQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val bridge = MessageBridge(project, ::pushToWeb)
    private var tempDir: File? = null
    private val bus = project.getService(com.sema.bridge.SemaPanelBus::class.java)
    private val pushRef: (String) -> Unit = ::pushToWeb

    val component: JComponent get() = browser.component

    init {
        bus.registerHistory(pushRef)
        hostQuery.addHandler { req ->
            bridge.onWebMessage(req)
            null
        }
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                log.warn("[sema] history onLoadEnd status=$httpStatusCode url=${b?.url}")
                bridge.startSidecar()
                if (!System.getenv("SEMA_JCEF_DEVTOOLS").isNullOrBlank()) {
                    com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater { openDevtools() }
                }
            }

            override fun onLoadError(
                b: CefBrowser?, frame: CefFrame?,
                errorCode: CefLoadHandler.ErrorCode?, errorText: String?, failedUrl: String?
            ) {
                log.warn("[sema] history onLoadError code=$errorCode text=$errorText url=$failedUrl")
            }
        }, browser.cefBrowser)

        loadUi()
        // 订阅 IDE 换肤，随主题实时刷新页面主题变量（无需重开面板）。
        Theme.installLiveUpdate(browser, this)
        // JCEF 不渲染原生 title 提示，接管 onTooltip 转 Swing tooltip。
        Tooltips.install(browser)
        // 拦截外链导航：链接改用系统浏览器打开，避免整页替换 React 应用后关不掉。
        BrowserNav.install(browser)
        // 收敛原生右键菜单：只留编辑项，移除「重新加载/后退」等会毁掉 SPA 状态的导航项。
        BrowserContextMenu.install(browser)
    }

    private fun loadUi() {
        val stream = javaClass.getResourceAsStream("/web/jb-sessionHistory.js")
        if (stream == null) {
            log.warn("[sema] 资源 /web/jb-sessionHistory.js 未找到 → 显示占位")
            browser.loadHTML(HtmlShell.placeholder())
            return
        }
        val dir = FileUtil.createTempDirectory("sema-jcef-history", null)
        tempDir = dir
        val js = File(dir, "jb-sessionHistory.js")
        stream.use { input -> js.outputStream().use { input.copyTo(it) } }
        val html = File(dir, "index.html")
        html.writeText(HtmlShell.page(buildInjection(), Theme.cssVariables(), "jb-sessionHistory.js"))
        log.warn("[sema] history bundle=${js.length()} bytes 载入 ${html.toURI()}")
        browser.loadURL(html.toURI().toString())
    }

    private fun buildInjection(): String =
        "window.__semaHostQuery = function(payload) { ${hostQuery.inject("payload")} };"

    fun openDevtools() {
        try { browser.openDevtools() } catch (e: Exception) { log.warn("[sema] openDevtools 失败", e) }
    }

    private fun pushToWeb(json: String) {
        val js = "window.__semaHostToWeb && window.__semaHostToWeb(${jsLiteral(json)});"
        browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
    }

    private fun jsLiteral(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\""

    override fun dispose() {
        bus.unregisterHistory(pushRef)
        bridge.dispose()
        hostQuery.dispose()
        browser.dispose()
        tempDir?.let { runCatching { it.deleteRecursively() } }
    }
}
