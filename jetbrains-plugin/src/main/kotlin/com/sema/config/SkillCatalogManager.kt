package com.sema.config

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.reflect.TypeToken
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

/**
 * Skill 市场（JB 版）：1:1 移植 VSCode 端 src/managers/SkillCatalogManager.ts。
 *   - 资源由 build.gradle.kts 的 syncSkillAssets 从主工程 resources/skills 同步到插件资源 assets/skills，
 *     jar 内无法列目录，另由 genSkillIndex 生成 assets/skills-index.json（全部文件相对路径）
 *   - 本地目录形式 <id>/（含 SKILL.md，可选 card.json）：安装 = 按清单逐个拷贝
 *   - 远程配置形式 <id>.json（card + source）：安装 = 从 GitHub 拉 zip 包取子目录
 *   - 安装目标：用户级 ~/.sema/skills/<id> 或项目级 <project>/.sema/skills/<id>；同名目录存在即视为已安装
 *   - card.defaultInstall 的技能首次打开工具窗口时自动装到用户级，已处理 id 持久化（用户卸载后不再重装）
 */
@Service(Service.Level.APP)
class SkillCatalogManager {
    private val log = logger<SkillCatalogManager>()
    private val gson = Gson()
    private val props = PropertiesComponent.getInstance()
    /** 进行中的 zip 下载：同仓库同 ref 的并行安装共享一次下载 */
    private val inflightZips = ConcurrentHashMap<String, CompletableFuture<ByteArray>>()
    private val defaultInstallStarted = AtomicBoolean(false)

    companion object {
        private const val ASSETS_DIR = "assets/skills"
        private const val INDEX_PATH = "assets/skills-index.json"
        private const val DEFAULT_SKILLS_INSTALLED_KEY = "sema.defaultSkillsInstalled"
        /** 远程资源包大小上限 */
        private const val ZIP_MAX = 100 * 1024 * 1024
        private const val TIMEOUT_MS = 60_000

        fun instance(): SkillCatalogManager =
            com.intellij.openapi.application.ApplicationManager.getApplication().getService(SkillCatalogManager::class.java)
    }

    private data class Card(
        val name: String? = null,
        val description: String? = null,
        val category: String? = null,
        val order: Double? = null,
        val defaultInstall: Boolean? = null,
    )

    /** ref 不填时用 HEAD；第三方仓库建议钉死 commit，内容不可变 */
    private data class RemoteSource(val repo: String, val ref: String, val path: String)

    /** files：本地目录形式下目录内全部文件的相对路径 */
    private data class SkillRes(val id: String, val card: Card, val skillName: String, val files: List<String>? = null, val source: RemoteSource? = null)

    // 资源随插件打包不可变，扫描一次即可
    private val resources: List<SkillRes> by lazy { scan() }

    private fun readResource(path: String): ByteArray? =
        SkillCatalogManager::class.java.classLoader.getResourceAsStream(path)?.use { it.readBytes() }

    private fun readResourceText(path: String): String? = readResource(path)?.toString(Charsets.UTF_8)

    private fun parseJson(text: String?): JsonObject? =
        text?.let { runCatching { gson.fromJson(it, JsonObject::class.java) }.getOrNull() }

    private fun JsonObject.optStr(key: String): String? =
        get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString

    private fun parseCard(obj: JsonObject?): Card {
        if (obj == null) return Card()
        return Card(
            name = obj.optStr("name"),
            description = obj.optStr("description"),
            category = obj.optStr("category"),
            order = obj.get("order")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asDouble,
            defaultInstall = obj.get("defaultInstall")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean,
        )
    }

    private fun parseRemoteSource(v: JsonObject?): RemoteSource? {
        if (v == null) return null
        val repo = v.optStr("repo") ?: return null
        if (!Regex("^[\\w.-]+/[\\w.-]+$").matches(repo)) return null
        val refEl = v.get("ref")
        val ref = if (refEl == null || refEl.isJsonNull || (refEl.isJsonPrimitive && refEl.asString == "")) "HEAD"
                  else v.optStr("ref") ?: return null
        if (!Regex("^[\\w./-]+$").matches(ref)) return null
        val path = v.optStr("path") ?: return null
        if (path.isEmpty() || path.contains("..")) return null
        return RemoteSource(repo, ref, path.trim('/'))
    }

    /** SKILL.md frontmatter 兜底解析：card.json 缺失时取 name/description 当展示文案 */
    private fun parseFrontmatter(text: String?): Card {
        if (text == null) return Card()
        val m = Regex("^---\\r?\\n([\\s\\S]*?)\\r?\\n---").find(text) ?: return Card()
        val lines = m.groupValues[1].split(Regex("\\r?\\n"))
        fun pick(key: String): String? {
            val idx = lines.indexOfFirst { it.startsWith("$key:") }
            if (idx == -1) return null
            val inline = lines[idx].substring(key.length + 1).trim()
            // 块标量：|（保留换行）或 >（折叠为空格），兼容 |- >- |+ >+ 变体
            if (Regex("^[|>][+-]?$").matches(inline)) {
                val block = mutableListOf<String>()
                for (i in idx + 1 until lines.size) {
                    if (lines[i].isBlank()) { block.add(""); continue }
                    if (!lines[i][0].isWhitespace()) break
                    block.add(lines[i].trim())
                }
                while (block.isNotEmpty() && block.last().isEmpty()) block.removeAt(block.size - 1)
                return block.joinToString(if (inline[0] == '>') " " else "\n").ifEmpty { null }
            }
            return inline.replace(Regex("^[\"']|[\"']$"), "").ifEmpty { null }
        }
        return Card(name = pick("name"), description = pick("description"))
    }

    /** 扫描内置资源。id 取子目录名 / 文件名（无路径分隔符），install/uninstall 按 id 在扫描结果中找回，天然白名单 */
    private fun scan(): List<SkillRes> {
        val index: List<String> = readResourceText(INDEX_PATH)?.let {
            runCatching { gson.fromJson<List<String>>(it, object : TypeToken<List<String>>() {}.type) }.getOrNull()
        } ?: return emptyList()
        val out = mutableListOf<SkillRes>()
        // 本地目录形式：按首段目录名分组
        index.filter { it.contains('/') }.groupBy { it.substringBefore('/') }.forEach { (id, paths) ->
            val files = paths.map { it.substringAfter('/') }
            if ("SKILL.md" !in files) return@forEach
            val fm = parseFrontmatter(readResourceText("$ASSETS_DIR/$id/SKILL.md"))
            val card = parseJson(readResourceText("$ASSETS_DIR/$id/card.json"))?.let { parseCard(it) } ?: fm
            out.add(SkillRes(id, card, fm.name ?: id, files = files))
        }
        // 远程配置形式：顶层 <id>.json
        index.filter { !it.contains('/') && it.endsWith(".json") }.forEach { name ->
            val conf = parseJson(readResourceText("$ASSETS_DIR/$name")) ?: return@forEach
            val source = parseRemoteSource(conf.getAsJsonObject("source")) ?: return@forEach
            val skillName = conf.optStr("skillName")?.trim()?.ifEmpty { null } ?: source.path.substringAfterLast('/')
            out.add(SkillRes(name.removeSuffix(".json"), parseCard(conf.getAsJsonObject("card")), skillName, source = source))
        }
        // 组内展示顺序：card.order 小的在前（缺省排最后），同序按 id 字母序
        return out.sortedWith(compareBy<SkillRes> { it.card.order ?: Double.POSITIVE_INFINITY }.thenBy { it.id })
    }

    private fun find(id: String): SkillRes =
        resources.find { it.id == id } ?: throw IllegalStateException("Skill resource not found: $id")

    fun skillDir(scope: String, id: String, projectRoot: String?): File {
        if (scope == "project") {
            if (projectRoot.isNullOrEmpty()) throw IllegalStateException("No workspace folder is open")
            return File(projectRoot, ".sema/skills/$id")
        }
        return File(System.getProperty("user.home"), ".sema/skills/$id")
    }

    fun listCatalog(projectRoot: String?): List<Map<String, Any?>> = resources.map { r ->
        linkedMapOf(
            "id" to r.id,
            "name" to (r.card.name ?: r.id),
            "description" to (r.card.description ?: ""),
            "category" to r.card.category,
            "skillName" to r.skillName,
            "repo" to r.source?.repo,
            "repoUrl" to r.source?.let { "https://github.com/${it.repo}/tree/${it.ref}/${it.path}" },
            "installedUser" to skillDir("user", r.id, null).exists(),
            "installedProject" to (!projectRoot.isNullOrEmpty() && skillDir("project", r.id, projectRoot).exists()),
        )
    }

    /** 下载 GitHub 仓库 zip 包（codeload 无 API 限流），跟随重定向；按 repo@ref 去重进行中的请求 */
    private fun downloadZip(source: RemoteSource): ByteArray {
        val key = "${source.repo}@${source.ref}"
        val mine = CompletableFuture<ByteArray>()
        val task = inflightZips.putIfAbsent(key, mine) ?: mine
        if (task === mine) {
            try {
                mine.complete(fetch("https://codeload.github.com/${source.repo}/zip/${URLEncoder.encode(source.ref, "UTF-8")}", source.repo))
            } catch (e: Exception) {
                mine.completeExceptionally(e)
            } finally {
                // 完成即移除（成功失败都清，失败后重试会重新下载）
                inflightZips.remove(key)
            }
        }
        try { return task.get() } catch (e: java.util.concurrent.ExecutionException) { throw e.cause ?: e }
    }

    private fun fetch(startUrl: String, repo: String): ByteArray {
        val deadline = System.currentTimeMillis() + TIMEOUT_MS
        var url = startUrl
        repeat(5) {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("User-Agent", "sema-jetbrains")
            }
            try {
                val code = try { conn.responseCode } catch (e: Exception) { throw IllegalStateException("Download failed ($repo): ${e.message}") }
                val location = conn.getHeaderField("Location")
                if (code in 300..399 && location != null) { url = URL(URL(url), location).toString(); return@repeat }
                if (code != 200) throw IllegalStateException("Download failed ($repo): HTTP $code")
                val buf = ByteArrayOutputStream()
                conn.inputStream.use { input ->
                    val chunk = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        if (buf.size() + n > ZIP_MAX) throw IllegalStateException("Skill package too large")
                        if (System.currentTimeMillis() > deadline) throw IllegalStateException("Download timed out, check your network and retry")
                        buf.write(chunk, 0, n)
                    }
                }
                return buf.toByteArray()
            } finally {
                conn.disconnect()
            }
        }
        throw IllegalStateException("Download failed ($repo): too many redirects")
    }

    /** 拉取远程技能：先在临时目录解压校验，成功后才替换目标目录（失败不留半截） */
    private fun fetchRemoteSkill(r: SkillRes, dest: File) {
        val source = r.source!!
        val bytes = downloadZip(source)
        val tmp = Files.createTempDirectory("sema-skill-").toFile()
        try {
            val tmpCanonical = tmp.canonicalPath + File.separator
            var top: String? = null
            ZipInputStream(bytes.inputStream()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    // zip 顶层是 <repo>-<ref> 单目录，名字随 ref 形态变化，取首个条目的第一段即可
                    if (top == null) top = entry.name.substringBefore('/')
                    val prefix = "$top/${source.path}/"
                    // 只解压目标子目录，避免整仓落盘
                    if (entry.isDirectory || !entry.name.startsWith(prefix)) continue
                    val out = File(tmp, entry.name)
                    if (!out.canonicalPath.startsWith(tmpCanonical)) continue
                    out.parentFile.mkdirs()
                    out.outputStream().use { zip.copyTo(it) }
                }
            }
            val srcDir = top?.let { File(tmp, "$it/${source.path}") }
            if (srcDir == null || !File(srcDir, "SKILL.md").exists()) throw IllegalStateException("${source.path}/SKILL.md not found in package")
            dest.deleteRecursively()
            dest.parentFile.mkdirs()
            srcDir.copyRecursively(dest, overwrite = true)
        } finally {
            tmp.deleteRecursively()
        }
    }

    /** 安装；同名已存在且未确认覆盖时返回 false（需确认），由调用方二次确认后带 overwrite 重发 */
    fun install(id: String, scope: String, overwrite: Boolean, projectRoot: String?): Boolean {
        val r = find(id)
        val dest = skillDir(scope, r.id, projectRoot)
        if (dest.exists() && !overwrite) return false
        if (r.files != null) {
            dest.deleteRecursively()
            for (rel in r.files) {
                val bytes = readResource("$ASSETS_DIR/${r.id}/$rel") ?: throw IllegalStateException("Missing plugin resource: $ASSETS_DIR/${r.id}/$rel")
                val f = File(dest, rel)
                f.parentFile.mkdirs()
                f.writeBytes(bytes)
            }
        } else {
            fetchRemoteSkill(r, dest)
        }
        return true
    }

    /** 卸载：删掉用户级与项目级（若有）的同名目录；返回 skillName 供调用方清理禁用残留 */
    fun uninstall(id: String, projectRoot: String?): String {
        val r = find(id)
        skillDir("user", r.id, null).deleteRecursively()
        if (!projectRoot.isNullOrEmpty()) skillDir("project", r.id, projectRoot).deleteRecursively()
        return r.skillName
    }

    /**
     * 默认安装（每个 IDE 进程只跑一次，调用方放池线程）：card.defaultInstall 的技能里挑出未处理过的，装到用户级。
     * 用户级已有同名目录视为已处理（不覆盖）；下载失败的不计入，下次启动重试。处理完的 id 持久化（用户之后卸载也不再重装）。
     */
    fun installDefaultSkillsOnce() {
        if (!defaultInstallStarted.compareAndSet(false, true)) return
        val handled: List<String> = props.getValue(DEFAULT_SKILLS_INSTALLED_KEY)?.let {
            runCatching { gson.fromJson<List<String>>(it, object : TypeToken<List<String>>() {}.type) }.getOrNull()
        } ?: emptyList()
        val pending = resources.filter { it.card.defaultInstall == true && it.id !in handled }
        if (pending.isEmpty()) return
        val done = pending.map { r ->
            CompletableFuture.supplyAsync {
                try {
                    if (!skillDir("user", r.id, null).exists()) install(r.id, "user", false, null)
                    r.id
                } catch (e: Exception) {
                    log.warn("[skill-catalog] default skill ${r.id} install failed: ${e.message}")
                    null
                }
            }
        }.mapNotNull { it.join() }
        if (done.isNotEmpty()) props.setValue(DEFAULT_SKILLS_INSTALLED_KEY, gson.toJson((handled + done).distinct()))
    }
}
