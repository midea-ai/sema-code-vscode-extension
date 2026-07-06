package com.sema.jcef

/**
 * JCEF 载入的 HTML 外壳。bundle 通过 file:// 以 <script src> 外链加载（不内联，避免白屏）。
 * 关键：桥函数 __semaHostQuery 内联在 bundle **之前**定义，否则 App 初始发出的命令会丢失。
 */
object HtmlShell {
    /**
     * @param injection 定义 window.__semaHostQuery 的 JS（由 JBCefJSQuery.inject 生成）
     * @param theme     :root{ --vscode-* } 主题变量（Theme.cssVariables()）
     * @param extraCss  页面专属覆盖 CSS（如 chat 的背景对齐 Project），仅对应面板传入；默认空。
     */
    fun page(injection: String, theme: String, bundle: String = "jb-chat.js", extraCss: String = ""): String = """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head><meta charset="UTF-8"><title>Sema Code</title>
        <!-- 主题变量单独成标签：供 Theme.installLiveUpdate 在 IDE 换肤时整体替换 textContent 实时热更新 -->
        <style id="sema-theme">$theme</style>
        <style>html,body{margin:0;height:100%;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);}
        /* JB：全局禁用焦点边框（CEF 的 focus-visible 触发时机与 VSCode 不同，会冒出奇怪的 outline） */
        *:focus,*:focus-visible{outline:none!important;}</style>
        <!-- 页面专属覆盖（chat 背景对齐 Project 等）：置于 bundle 前，用高特指度选择器压过 bundle 的 :root -->
        <style>$extraCss</style>
        </head>
        <!-- spellcheck=false：关掉 JCEF(Chromium) 的拼写检查红波浪线，子元素(input/textarea)继承 -->
        <body spellcheck="false">
          <div id="root"></div>
          <script>$injection</script>
          <script src="$bundle"></script>
        </body>
        </html>
    """.trimIndent()

    fun placeholder(): String = """
        <!DOCTYPE html>
        <html lang="zh-CN"><head><meta charset="UTF-8"></head>
        <body><div style="padding:16px;font-family:sans-serif;color:#888">
          Sema Code：/web/jb-chat.js 未找到。请在主工程运行 npm run compile 后重新构建插件。
        </div></body></html>
    """.trimIndent()
}
