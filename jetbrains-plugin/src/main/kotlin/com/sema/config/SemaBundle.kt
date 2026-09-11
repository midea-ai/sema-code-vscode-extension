package com.sema.config

import java.util.Locale
import java.util.MissingResourceException
import java.util.ResourceBundle

/**
 * Kotlin 原生 UI 文案（编辑器 tab 标题、Action 文案、原生弹窗、diff 标题），webview 内文案由 i18n 字典负责。
 *
 * 按 Sema 自己的界面语言（SystemConfigManager.lang()）加载 messages/SemaBundle_<lang>.properties，
 * 不跟随 IDE 语言，所以不用 DynamicBundle。NoFallbackControl 让缺失语言直接回退基础包（英文），
 * 不会先落到 JVM 默认 locale（中文系统下德语用户会误拿到中文）。
 */
object SemaBundle {
    private const val BUNDLE = "messages.SemaBundle"
    private val control = ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES)

    fun message(key: String): String {
        val locale = Locale.forLanguageTag(SystemConfigManager.instance().lang())
        return try {
            ResourceBundle.getBundle(BUNDLE, locale, SemaBundle::class.java.classLoader, control).getString(key)
        } catch (e: MissingResourceException) {
            key
        }
    }
}
