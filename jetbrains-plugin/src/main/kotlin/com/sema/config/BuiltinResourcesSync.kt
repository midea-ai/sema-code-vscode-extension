package com.sema.config

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import semacore.SemaCore
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 内置资源随版本同步（对齐 VSCode extension.syncBuiltinResources / sema-core webui router 的启动同步）：
 *   - 默认安装：标 defaultInstall 的 skill 首次打开工具窗口装到用户级，处理过的 id 持久化，用户卸载后不再重装
 *   - 升级后首次打开（持久化的版本 ≠ 当前插件版本）：用户级已有的默认 skill 一律按插件资源覆盖；
 *     浏览器控制开着时，chrome MCP 必须经 core 重新 add（添加即更新）才能更新，而 core 在网页侧，
 *     所以由聊天页 core 就绪后发 browserControl/syncUpgrade：这里重拷用户级已有的 chrome-use 目录并回传 MCP 模板，
 *     网页侧刷新 skills、重写 MCP 后再发 browserControl/markSynced 落版本号；开关没开时 skill 同步成功即落版本号
 *   - 全部成功才记版本，有失败下次打开重试；同一版本内后续打开只比一次字符串，不碰用户级目录
 */
@Service(Service.Level.APP)
class BuiltinResourcesSync {
    private val log = logger<BuiltinResourcesSync>()
    private val gson = Gson()
    private val props = PropertiesComponent.getInstance()
    private val started = AtomicBoolean(false)
    /** 本进程默认 skill 同步是否已成功完成：markSynced 的前置，skill 侧失败则不落版本号 */
    @Volatile private var skillsSynced = false

    companion object {
        private const val VERSION_KEY = "sema.builtinResourcesVersion"
        private const val BROWSER_ASSETS_DIR = "assets/chrome"
        private const val BROWSER_SKILL_NAME = "chrome-use"
        private const val BROWSER_MCP_NAME = "chrome"
        /** 资源在 jar 内无法列目录，skill 文件按已知清单逐个拷贝：assets/chrome/skills/chrome-use 新增文件时需同步更新 */
        private val BROWSER_SKILL_FILES = listOf("SKILL.md")

        fun instance(): BuiltinResourcesSync =
            ApplicationManager.getApplication().getService(BuiltinResourcesSync::class.java)

        private val pluginVersion: String
            get() = PluginManagerCore.getPlugin(PluginId.getId("com.sema"))?.version ?: ""
    }

    private val upgraded: Boolean get() = props.getValue(VERSION_KEY) != pluginVersion

    private fun browserControlEnabled(): Boolean = SystemConfigManager.instance().getConfig()["enableBrowserControl"] == true

    private fun readResource(path: String): ByteArray? =
        BuiltinResourcesSync::class.java.classLoader.getResourceAsStream(path)?.use { it.readBytes() }

    /** 工具窗口创建时在池线程调用；进程内只跑一次 */
    fun syncOnce() {
        if (!started.compareAndSet(false, true)) return
        val upgraded = this.upgraded
        val failed = SkillCatalogManager.instance().syncDefaultSkills(upgraded)
        skillsSynced = failed == 0
        // 开关没开：没有浏览器控制侧要同步，这里就能落版本号；开着则等网页侧 markSynced
        if (upgraded && skillsSynced && !browserControlEnabled()) props.setValue(VERSION_KEY, pluginVersion)
    }

    /** 用户级 chrome-use skill 目录 */
    val userBrowserSkillDir: File get() = File(SemaCore.getSemaRootDir(), "skills/$BROWSER_SKILL_NAME")

    /** 从插件资源整拷 chrome-use 到用户级（先删后拷，不留旧文件） */
    fun copyBrowserSkill() {
        val dir = userBrowserSkillDir
        dir.deleteRecursively()
        dir.mkdirs()
        for (name in BROWSER_SKILL_FILES) {
            val bytes = readResource("$BROWSER_ASSETS_DIR/skills/$BROWSER_SKILL_NAME/$name")
                ?: throw IllegalStateException("插件资源缺少 $BROWSER_ASSETS_DIR/skills/$BROWSER_SKILL_NAME/$name")
            File(dir, name).writeBytes(bytes)
        }
    }

    /** 读 assets/chrome/mcp.json 模板里的 chrome 项（网页侧补上 name / scope 后经 core add） */
    fun browserMcpTemplate(): JsonObject {
        val template = readResource("$BROWSER_ASSETS_DIR/mcp.json")?.toString(Charsets.UTF_8)
            ?: throw IllegalStateException("插件资源缺少 $BROWSER_ASSETS_DIR/mcp.json")
        return gson.fromJson(template, JsonObject::class.java)
            ?.getAsJsonObject("mcpServers")?.getAsJsonObject(BROWSER_MCP_NAME)
            ?: throw IllegalStateException("$BROWSER_ASSETS_DIR/mcp.json 缺少 mcpServers.$BROWSER_MCP_NAME")
    }

    /**
     * 网页侧 core 就绪后调用：升级后首次且开关开着 → 重拷用户级已有的 chrome-use 目录，返回 true 让网页侧继续 MCP 同步。
     * 没开过、或用户已删目录的不补，等开启时再装。
     */
    fun prepareUpgradeSync(): Boolean {
        if (!upgraded || !browserControlEnabled()) return false
        if (File(userBrowserSkillDir, "SKILL.md").exists()) copyBrowserSkill()
        return true
    }

    /** 网页侧 MCP 同步成功后调用：skill 侧也成功才落版本号，否则下次打开整体重试 */
    fun markSynced() {
        if (skillsSynced) props.setValue(VERSION_KEY, pluginVersion)
        else log.warn("[builtin-sync] default skills sync not finished or failed, version not recorded")
    }
}
