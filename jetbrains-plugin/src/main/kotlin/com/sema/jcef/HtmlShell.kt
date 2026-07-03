package com.sema.jcef

/**
 * JCEF 载入的 HTML 外壳。bundle 通过 file:// 以 <script src> 外链加载（不内联，避免白屏）。
 * 关键：桥函数 __semaHostQuery 内联在 bundle **之前**定义，否则 App 初始发出的命令会丢失。
 */
object HtmlShell {
    /**
     * @param injection 定义 window.__semaHostQuery 的 JS（由 JBCefJSQuery.inject 生成）
     * @param theme     :root{ --vscode-* } 主题变量（Theme.cssVariables()）
     */
    fun page(injection: String, theme: String, bundle: String = "jb-chat.js"): String = """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head><meta charset="UTF-8"><title>Sema Code</title>
        <style>$theme html,body{margin:0;height:100%;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);}</style>
        </head>
        <body>
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
