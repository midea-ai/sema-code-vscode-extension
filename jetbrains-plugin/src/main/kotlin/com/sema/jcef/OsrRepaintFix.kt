package com.sema.jcef

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.event.HierarchyEvent
import javax.swing.Timer

/**
 * OSR 重挂载 scale 修复：混合 DPI 多屏下，组件摘除期间 CEF 自行改用主屏 scale（JBR-7335），
 * 重开时平台见自身缓存未变而跳过 notifyScreenInfoChanged，错误 dpr 滞留 → 整页放大；
 * 若重挂载瞬间拿到错误 gc，错误值还会污染 JBCefOsrHandler 缓存，此时裸 notify 无法自愈。
 * 修复（不碰页面 DOM）：显示当帧先反射调平台 onGraphicsConfigurationChanged() 用当前 gc
 * 重算缓存，再无条件 notifyScreenInfoChanged() 让 CEF 重读；1.3s 复查兜底收起期间屏幕
 * 配置真实变化的场景。一切正常时两步均为 no-op，无视觉副作用。
 */
object OsrRepaintFix {
    private val log = logger<OsrRepaintFix>()
    private const val OSR_COMPONENT_CLASS = "com.intellij.ui.jcef.JBCefOsrComponent"

    @Suppress("UNUSED_PARAMETER")
    fun install(browser: JBCefBrowser, parent: Disposable) {
        // SHOWING_CHANGED：无论收起是「摘除组件」还是「父级 setVisible(false)」，重新可见都能收到。
        browser.component.addHierarchyListener { e ->
            if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() != 0L && browser.component.isShowing) {
                resync(browser, "show")
                schedule(500) { reportPageDpr(browser) }
                schedule(1300) { if (browser.component.isShowing) resync(browser, "recheck") }
            }
        }
    }

    private fun schedule(delayMs: Int, action: () -> Unit) {
        Timer(delayMs) { action() }.apply { isRepeats = false }.start()
    }

    private fun resync(browser: JBCefBrowser, stage: String) {
        val resynced = resyncHostScreenInfo(browser)
        runCatching { browser.cefBrowser.notifyScreenInfoChanged() }
            .onFailure { log.warn("[sema][osr][$stage] notifyScreenInfoChanged 失败", it) }
        logHostState(browser, stage, resynced)
    }

    /** 反射触发平台 scale 重算，对齐 JBCefOsrHandler 缓存；平台类结构变化时降级为仅裸 notify。 */
    private fun resyncHostScreenInfo(browser: JBCefBrowser): Boolean {
        return runCatching {
            val comp = browser.cefBrowser.uiComponent ?: return false
            if (comp.javaClass.name != OSR_COMPONENT_CLASS) return false
            val m = comp.javaClass.getDeclaredMethod("onGraphicsConfigurationChanged")
            m.isAccessible = true
            m.invoke(comp)
            true
        }.onFailure { log.warn("[sema][osr] 宿主 scale 重同步失败，降级为仅 notify", it) }
            .getOrDefault(false)
    }

    private fun logHostState(browser: JBCefBrowser, stage: String, resynced: Boolean) {
        runCatching {
            val c = browser.component
            val gc = c.graphicsConfiguration
            log.warn(
                "[sema][osr][$stage] comp=${c.width}x${c.height} showing=${c.isShowing} " +
                    "gcScale=${gc?.defaultTransform?.scaleX} device=${gc?.device?.iDstring} resynced=$resynced"
            )
        }.onFailure { log.warn("[sema][osr][$stage] 宿主状态采集失败", it) }
    }

    /** 页面侧 dpr 上报（channel=osrDiag，MessageBridge 识别后短路打日志，不触发就绪等副作用），仅取证用。 */
    private fun reportPageDpr(browser: JBCefBrowser) {
        runCatching {
            val js = "(function(){try{window.__semaHostQuery&&window.__semaHostQuery(JSON.stringify(" +
                "{channel:'osrDiag',dpr:window.devicePixelRatio,iw:window.innerWidth}));}catch(e){}})();"
            browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
        }.onFailure { log.warn("[sema][osr] 页面指标采集失败", it) }
    }
}
