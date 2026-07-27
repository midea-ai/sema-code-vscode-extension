import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.gradle.api.tasks.bundling.AbstractArchiveTask

plugins {
    kotlin("jvm") version "1.9.25"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(
            IntelliJPlatformType.fromCode(providers.gradleProperty("platformType").get()),
            providers.gradleProperty("platformVersion").get(),
        )
        instrumentationTools()
    }

    // sema-core Java SDK：通信层（gRPC 双向流 + 就绪缓冲 + 断线重连）、sidecar 托管
    // （内嵌桥产物释放、Node 探测/下载、端口握手、孤儿回收）全部由 SDK 提供，
    // gRPC/protobuf/gson 依赖随之传递引入。
    implementation("io.github.midea-ai:sema-core:${providers.gradleProperty("semaCoreSdkVersion").get()}")
}

intellijPlatform {
    pluginConfiguration {
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")
        // description 保留在 plugin.xml（避免与 <description> 冲突）；此处只补 version/changeNotes。
        changeNotes = providers.gradleProperty("pluginVersion").map { "<ul><li>Sema Code $it</li></ul>" }
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            val until = providers.gradleProperty("pluginUntilBuild").orNull
            if (!until.isNullOrBlank()) untilBuild = until else untilBuild = provider { null }
        }
    }

    // 签名（上架 Marketplace 需要）：证书链/私钥/口令走环境变量，本地未配则跳过。
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }

    // 发布到 JetBrains Marketplace：token 走环境变量 PUBLISH_TOKEN。
    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }
}

kotlin {
    jvmToolchain(providers.gradleProperty("javaVersion").get().toInt())
}

// 从主工程同步 React 产物（chat.js 等）到 resources/web
// 注意：MVP 的 JS 层（含 semaSessionWrapper + RemoteSession bootstrap）将由主工程 webpack 产出后同步至此
val syncWeb by tasks.registering(Copy::class) {
    from("../dist/webview")
    into(layout.buildDirectory.dir("resources/main/web"))
    // 只打 JB 用的 bundle：插件仅加载 jb-chat/jb-config/jb-sessionHistory。
    // VSCode 版（chat.js/config.js/sessionHistory.js）在 JB 从不加载，别带进来（省 ~3.8MB）。
    include("jb-*.js")
}

tasks.named("processResources") {
    dependsOn(syncWeb)
}

// 打包产物直接落在 jetbrains-plugin/ 根下，省得进 build/distributions 深目录
tasks.named<AbstractArchiveTask>("buildPlugin") {
    destinationDirectory.set(layout.projectDirectory)
}

// 沙箱里禁用 IDE 自带的 Android 插件：它加载自身 pluginIcon_dark.svg 时会刷
// "Cannot load plugin icon ... Not a directory" 警告（IC-2023.2 已知噪音，与本插件无关）。
// 我们不做 Android 开发，禁掉即可静默该日志并略微加快沙箱启动。
val disableBundledPluginsInSandbox by tasks.registering {
    val disabledFile = layout.buildDirectory.file(
        "idea-sandbox/${providers.gradleProperty("platformType").get()}-${providers.gradleProperty("platformVersion").get()}/config/disabled_plugins.txt"
    )
    outputs.file(disabledFile)
    // 沙箱由 prepareSandbox 搭建，禁用清单要在其之后写入，避免被覆盖
    mustRunAfter("prepareSandbox")
    doLast {
        val f = disabledFile.get().asFile
        f.parentFile.mkdirs()
        val ids = if (f.exists()) f.readLines().map { it.trim() }.filter { it.isNotEmpty() }.toMutableSet()
                  else mutableSetOf()
        if (ids.add("org.jetbrains.android")) {
            f.writeText(ids.joinToString(System.lineSeparator()))
        }
    }
}
tasks.named("runIde") {
    dependsOn(disableBundledPluginsInSandbox)
}
