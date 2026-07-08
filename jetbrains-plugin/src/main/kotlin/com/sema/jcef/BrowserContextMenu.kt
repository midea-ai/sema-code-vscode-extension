package com.sema.jcef

import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefContextMenuParams
import org.cef.callback.CefMenuModel
import org.cef.handler.CefContextMenuHandlerAdapter

/**
 * 收敛 JCEF 默认右键菜单，对齐 VSCode webview：只保留文本编辑项
 * （撤销/重做/剪切/复制/粘贴/删除/全选），移除导航类（后退/前进/重新加载/
 * 打印/查看源码/查找）。
 *
 * 导航项是危险来源——点「重新加载」会重载 file://index.html、bundle 重跑，SPA 会话
 * 状态全丢并二次触发 sidecar 引导；点「后退」可能跳 about:blank 白屏。编辑项无害且
 * 常用（输入框剪切/复制/粘贴），故保留而非全清空。
 *
 * 用白名单逐项过滤（而非 remove(id) 黑名单），顺带清掉分隔符：这样页面空白处右键
 * 变成空菜单（不弹），输入框里自然只剩 剪切/复制/粘贴 等编辑项，不会残留孤立分隔符。
 */
object BrowserContextMenu {
    /** 保留的编辑组 command id；其余（导航/查看源码/打印/分隔符…）一律移除。 */
    private val KEEP = setOf(
        CefMenuModel.MenuId.MENU_ID_UNDO,
        CefMenuModel.MenuId.MENU_ID_REDO,
        CefMenuModel.MenuId.MENU_ID_CUT,
        CefMenuModel.MenuId.MENU_ID_COPY,
        CefMenuModel.MenuId.MENU_ID_PASTE,
        CefMenuModel.MenuId.MENU_ID_DELETE,
        CefMenuModel.MenuId.MENU_ID_SELECT_ALL,
    )

    fun install(browser: JBCefBrowser) {
        browser.jbCefClient.addContextMenuHandler(object : CefContextMenuHandlerAdapter() {
            override fun onBeforeContextMenu(
                b: CefBrowser?, frame: CefFrame?,
                params: CefContextMenuParams?, model: CefMenuModel?,
            ) {
                model ?: return
                // 从后往前删，removeAt 不影响更小的索引
                for (i in model.count - 1 downTo 0) {
                    if (model.getCommandIdAt(i) !in KEEP) model.removeAt(i)
                }
            }

            override fun onContextMenuCommand(
                b: CefBrowser?, frame: CefFrame?,
                params: CefContextMenuParams?, commandId: Int, eventFlags: Int,
            ): Boolean = false // 保留项走 JCEF 默认行为（剪切/复制/粘贴生效）
        }, browser.cefBrowser)
    }
}
