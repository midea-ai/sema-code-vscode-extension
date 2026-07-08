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
 * 配置页面板：JCEF 承载 config 的 React UI（jb-config.js）。
 *
 * 与 ChatPanel 同构，只换 bundle 与消息控制器（config-controller）。承载于编辑器主区域的
 * 独立 tab（SemaConfigFileEditor），与聊天 ToolWindow 共享同一 sidecar 进程但各开一条 gRPC 连接。
 */
class ConfigPanel(project: Project) : Disposable {
    private val log = logger<ConfigPanel>()
    private val browser = JBCefBrowser()
    private val hostQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val bridge = MessageBridge(project, ::pushToWeb, com.sema.bridge.PanelKind.CONFIG)
    private var tempDir: File? = null
    // 注册进面板总线：让聊天页「打开配置/任务」深链能把 navigateTo 推进本配置 webview。
    // 存成 val 以保证 register/unregister 用同一引用（方法引用 ::pushToWeb 每次是新对象，无法按 === 注销）。
    private val bus = project.getService(com.sema.bridge.SemaPanelBus::class.java)
    private val pushRef: (String) -> Unit = ::pushToWeb

    val component: JComponent get() = browser.component

    init {
        bus.registerConfig(pushRef)
        hostQuery.addHandler { req ->
            bridge.onWebMessage(req)
            null
        }
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                log.warn("[sema] config onLoadEnd status=$httpStatusCode url=${b?.url}")
                bridge.startSidecar()
                if (!System.getenv("SEMA_JCEF_DEVTOOLS").isNullOrBlank()) {
                    com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater { openDevtools() }
                }
            }

            override fun onLoadError(
                b: CefBrowser?, frame: CefFrame?,
                errorCode: CefLoadHandler.ErrorCode?, errorText: String?, failedUrl: String?
            ) {
                log.warn("[sema] config onLoadError code=$errorCode text=$errorText url=$failedUrl")
            }
        }, browser.cefBrowser)

        loadUi()
        // 订阅 IDE 换肤，随主题实时刷新页面主题变量（无需重开面板）。
        Theme.installLiveUpdate(browser, this)
        // JCEF 不渲染原生 title 提示，接管 onTooltip 转 Swing tooltip。
        Tooltips.install(browser)
        // 拦截外链导航：链接改用系统浏览器打开，避免整页替换 React 应用后关不掉。
        BrowserNav.install(browser)
    }

    private fun loadUi() {
        val stream = javaClass.getResourceAsStream("/web/jb-config.js")
        if (stream == null) {
            log.warn("[sema] 资源 /web/jb-config.js 未找到 → 显示占位")
            browser.loadHTML(HtmlShell.placeholder())
            return
        }
        val dir = FileUtil.createTempDirectory("sema-jcef-config", null)
        tempDir = dir
        val js = File(dir, "jb-config.js")
        stream.use { input -> js.outputStream().use { input.copyTo(it) } }
        val html = File(dir, "index.html")
        html.writeText(HtmlShell.page(buildInjection(), Theme.cssVariables(), "jb-config.js", extraCss = Theme.configPageOverrideCss()))
        log.warn("[sema] config bundle=${js.length()} bytes 载入 ${html.toURI()}")
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
        bus.unregisterConfig(pushRef)
        bridge.dispose()
        hostQuery.dispose()
        browser.dispose()
        tempDir?.let { runCatching { it.deleteRecursively() } }
    }
}
