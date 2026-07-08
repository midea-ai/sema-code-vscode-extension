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
 * ToolWindow 内的聊天面板：JCEF 承载 React UI。
 *
 * bundle（jb-chat.js）从插件资源释放到临时文件，用 file:// 外链加载（避免内联白屏）。
 * Kotlin 只暴露两个低层桥函数，协议逻辑全在 JS bootstrap（复用 semaSessionWrapper）：
 *   window.__semaHostQuery(jsonString)  —— web → 宿主
 *   window.__semaHostToWeb(jsonString)  —— 宿主 → web
 */
class ChatPanel(project: Project) : Disposable {
    private val log = logger<ChatPanel>()
    private val browser = JBCefBrowser()
    private val hostQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val bridge = MessageBridge(project, ::pushToWeb)
    private var tempDir: File? = null
    // 注册进面板总线：让标题栏「新建会话」Action / 历史面板能向本聊天 webview 推消息。
    // 存成 val 以保证 register/unregister 用同一引用（方法引用 ::pushToWeb 每次是新对象，无法按 === 注销）。
    private val bus = project.getService(com.sema.bridge.SemaPanelBus::class.java)
    private val pushRef: (String) -> Unit = ::pushToWeb

    val component: JComponent get() = browser.component

    init {
        bus.registerChat(pushRef)
        hostQuery.addHandler { req ->
            bridge.onWebMessage(req)
            null
        }
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                log.warn("[sema] onLoadEnd status=$httpStatusCode url=${b?.url}")
                // __semaHostQuery 已内联在页面里（bundle 之前），此处只需启动 sidecar
                bridge.startSidecar()
                // 设了 SEMA_JCEF_DEVTOOLS 就自动弹出 JCEF DevTools（排查前端用，CEF 原生窗口，不依赖调试端口）
                if (!System.getenv("SEMA_JCEF_DEVTOOLS").isNullOrBlank()) {
                    com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater { openDevtools() }
                }
            }

            override fun onLoadError(
                b: CefBrowser?, frame: CefFrame?,
                errorCode: CefLoadHandler.ErrorCode?, errorText: String?, failedUrl: String?
            ) {
                log.warn("[sema] onLoadError code=$errorCode text=$errorText url=$failedUrl")
            }
        }, browser.cefBrowser)

        loadUi()
        // 订阅 IDE 换肤，随主题实时刷新页面主题变量（无需重开面板）。
        Theme.installLiveUpdate(browser, this)
        // JCEF 不渲染原生 title 提示，接管 onTooltip 转 Swing tooltip。
        Tooltips.install(browser)
        // 拦截外链导航：欢迎页/消息里的链接改用系统浏览器打开，避免整页替换 React 应用后关不掉。
        BrowserNav.install(browser)
        // 收敛原生右键菜单：只留编辑项，移除「重新加载/后退」等会毁掉 SPA 会话状态的导航项。
        BrowserContextMenu.install(browser)
    }

    private fun loadUi() {
        val stream = javaClass.getResourceAsStream("/web/jb-chat.js")
        if (stream == null) {
            log.warn("[sema] 资源 /web/jb-chat.js 未找到 → 显示占位")
            browser.loadHTML(HtmlShell.placeholder())
            return
        }
        val dir = FileUtil.createTempDirectory("sema-jcef", null)
        tempDir = dir
        val js = File(dir, "jb-chat.js")
        stream.use { input -> js.outputStream().use { input.copyTo(it) } }
        val html = File(dir, "index.html")
        html.writeText(HtmlShell.page(buildInjection(), Theme.cssVariables(), extraCss = Theme.chatPageBgOverrideCss()))
        log.warn("[sema] bundle=${js.length()} bytes 载入 ${html.toURI()}")
        browser.loadURL(html.toURI().toString())
    }

    /** 生成定义 window.__semaHostQuery 的 JS（内联到页面，早于 bundle 执行）。 */
    private fun buildInjection(): String =
        "window.__semaHostQuery = function(payload) { ${hostQuery.inject("payload")} };"

    /** 需要排查前端时手动调用：打开 JCEF DevTools。 */
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
        bus.unregisterChat(pushRef)
        bridge.dispose()
        hostQuery.dispose()
        browser.dispose()
        tempDir?.let { runCatching { it.deleteRecursively() } }
    }
}
