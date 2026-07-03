package com.sema.config

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.components.Service

/**
 * 系统配置本地持久化（应用级）——对齐 VSCode 端 SystemConfigManager（context.globalState）。
 *
 * sema-core **不持久化** core 配置，宿主负责存。用应用级 PropertiesComponent（= globalState：
 * 按用户、跨项目、跨窗口），存两份 JSON：sema.systemConfig（UpdatableCoreConfig + 本地字段）
 * 与 sema.disabledTools（禁用工具黑名单）。
 *
 * 与 sema-core 的分工：本类只管**存/取**；把 core 子集推给 sema-core 由 webview 的 config-controller
 * 走 gRPC（updateCoreConfig / updateCoreConfByKey）负责；启动 seed 由 MessageBridge 在 init 时合并。
 */
@Service(Service.Level.APP)
class SystemConfigManager {
    private val props = PropertiesComponent.getInstance()
    private val gson = Gson()

    companion object {
        private const val CONFIG_KEY = "sema.systemConfig"
        private const val DISABLED_TOOLS_KEY = "sema.disabledTools"

        // 对齐 src/webview/config/default/defaultConfig.ts
        private val DEFAULT_CONFIG: Map<String, Any?> = linkedMapOf(
            "stream" to true,
            "thinking" to true,
            "showThinkingText" to false,
            "skipFileEditPermission" to false,
            "skipShellExecPermission" to false,
            "skipSkillPermission" to false,
            "skipMCPToolPermission" to false,
            "skipFetchUrlPermission" to false,
            "skipExternalFileReadPermission" to true,
            "systemPrompt" to "You are Sema, AIRC's Agent AI for coding.",
            "customRules" to "- 中文回答",
            "enableLLMCache" to false,
            "disableBackgroundTasks" to false,
            "enablePet" to false,
        )

        // 仅落本地、不推 sema-core 的键（对齐 semaProcessWrapper.LOCAL_SYSTEM_CONFIG_KEYS）
        private val LOCAL_KEYS = setOf("enablePet", "showThinkingText")
    }

    /** 读取完整系统配置（缺省合并默认值，保证新增字段有值）。 */
    fun getConfig(): MutableMap<String, Any?> {
        val merged = LinkedHashMap<String, Any?>(DEFAULT_CONFIG)
        props.getValue(CONFIG_KEY)?.let { json ->
            runCatching {
                val type = object : TypeToken<Map<String, Any?>>() {}.type
                gson.fromJson<Map<String, Any?>>(json, type)
            }.getOrNull()?.let { merged.putAll(it) }
        }
        return merged
    }

    fun saveConfig(config: Map<String, Any?>) {
        props.setValue(CONFIG_KEY, gson.toJson(config))
    }

    fun saveByKey(key: String, value: Any?) {
        val c = getConfig()
        c[key] = value
        saveConfig(c)
    }

    fun getDisabledTools(): List<String>? {
        val json = props.getValue(DISABLED_TOOLS_KEY) ?: return null
        return runCatching {
            val type = object : TypeToken<List<String>>() {}.type
            gson.fromJson<List<String>>(json, type)
        }.getOrNull()
    }

    fun saveDisabledTools(tools: List<String>?) {
        if (tools == null) props.unsetValue(DISABLED_TOOLS_KEY)
        else props.setValue(DISABLED_TOOLS_KEY, gson.toJson(tools))
    }

    /** core 子集：去掉纯本地键，用于推 sema-core / init seed。 */
    fun coreSubset(): MutableMap<String, Any?> {
        val c = getConfig()
        for (k in LOCAL_KEYS) c.remove(k)
        return c
    }
}
