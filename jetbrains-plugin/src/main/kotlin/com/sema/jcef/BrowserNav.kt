package com.sema.jcef

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.network.CefRequest

/**
 * 拦截 JCEF 内的外链导航。
 *
 * 欢迎页 / 消息里的 <a href> 或 window.open 若被内嵌浏览器当作页面导航执行，会把整个
 * React 应用整页替换成目标网页，且没有后退入口——用户表现为「点了链接就出不来、关不掉」。
 * 这里把所有**非 file:// 的顶层导航**一律取消，改用系统浏览器打开；只放行应用自身
 * 的 file:// / about: 页面（即 bundle 载入的 index.html）。
 *
 * 注意：onBeforeBrowse 只在顶层/子框架**导航**时触发，不影响页面内子资源（脚本/图片，走
 * onBeforeResourceLoad）的加载，因此不会拦到 bundle 本身。
 */
object BrowserNav {
    private val log = logger<BrowserNav>()

    fun install(browser: JBCefBrowser) {
        // 页内点链接 / location 跳转
        browser.jbCefClient.addRequestHandler(object : CefRequestHandlerAdapter() {
            override fun onBeforeBrowse(
                b: CefBrowser?, frame: CefFrame?, request: CefRequest?,
                userGesture: Boolean, isRedirect: Boolean,
            ): Boolean {
                val url = request?.url
                if (!isExternal(url)) return false // 放行应用自身页面
                openExternal(url)
                return true // 取消本次内嵌导航
            }
        }, browser.cefBrowser)

        // target=_blank / window.open：一律不在 JCEF 里开新窗口；外链转系统浏览器
        browser.jbCefClient.addLifeSpanHandler(object : CefLifeSpanHandlerAdapter() {
            override fun onBeforePopup(
                b: CefBrowser?, frame: CefFrame?, targetUrl: String?, targetFrameName: String?,
            ): Boolean {
                if (isExternal(targetUrl)) openExternal(targetUrl)
                return true // 阻止弹窗
            }
        }, browser.cefBrowser)
    }

    /** file:// 与 about: 视为应用自身页面；其余（http/https/mailto…）视为外链。 */
    private fun isExternal(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        return !(u.startsWith("file:") || u.startsWith("about:"))
    }

    private fun openExternal(url: String?) {
        if (url.isNullOrBlank()) return
        try {
            BrowserUtil.browse(url)
        } catch (e: Exception) {
            log.warn("[sema] 打开外链失败: $url", e)
        }
    }
}
