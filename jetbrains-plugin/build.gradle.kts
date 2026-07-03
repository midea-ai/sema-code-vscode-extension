import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.gradle.api.tasks.bundling.AbstractArchiveTask

plugins {
    kotlin("jvm") version "1.9.25"
    id("org.jetbrains.intellij.platform") version "2.1.0"
    id("com.google.protobuf") version "0.9.4"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

val grpcVersion = "1.66.0"
val protobufVersion = "3.25.3"

dependencies {
    intellijPlatform {
        create(
            IntelliJPlatformType.fromCode(providers.gradleProperty("platformType").get()),
            providers.gradleProperty("platformVersion").get(),
        )
        instrumentationTools()
    }

    // gRPC 客户端（连接 sema-grpc sidecar）。okhttp 传输比 netty-shaded 小 ~8M，
    // 本机 127.0.0.1 明文连接足够用。
    implementation("io.grpc:grpc-okhttp:$grpcVersion")
    implementation("io.grpc:grpc-protobuf:$grpcVersion")
    implementation("io.grpc:grpc-stub:$grpcVersion")
    implementation("com.google.protobuf:protobuf-java:$protobufVersion")
    // gRPC 生成代码需要 javax.annotation.Generated
    compileOnly("org.apache.tomcat:annotations-api:6.0.53")
}

// proto 直接指向 sema-grpc 的定义（sema-grpc 在本工程内部），保持单一真源
sourceSets {
    main {
        proto {
            srcDir("sema-grpc/proto")
        }
    }
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:$protobufVersion"
    }
    plugins {
        create("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:$grpcVersion"
        }
    }
    generateProtoTasks {
        all().forEach { task ->
            task.plugins {
                create("grpc")
            }
        }
    }
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

// 把 sema-grpc sidecar 的单文件产物（esbuild 打的 server.js）随插件打包。
// 运行时由 MessageBridge 从 classpath 释放到 ~/.sema/jb-sidecar 再用系统 node 执行。
val syncSidecar by tasks.registering(Copy::class) {
    val serverJs = file("sema-grpc/dist/server.js")
    doFirst {
        if (!serverJs.exists()) {
            throw GradleException(
                "缺少 sidecar 产物 $serverJs；请先在 sema-grpc 下执行 `npm ci && npm run build`（见 DEVELOPMENT.md）"
            )
        }
    }
    from(serverJs)
    into(layout.buildDirectory.dir("resources/main/sidecar"))
}
val syncSidecarProto by tasks.registering(Copy::class) {
    from("sema-grpc/proto")
    into(layout.buildDirectory.dir("resources/main/sidecar/proto"))
}

// 从主工程同步 React 产物（chat.js 等）到 resources/web
// 注意：MVP 的 JS 层（含 semaSessionWrapper + RemoteSession bootstrap）将由主工程 webpack 产出后同步至此
val syncWeb by tasks.registering(Copy::class) {
    from("../dist/webview")
    into(layout.buildDirectory.dir("resources/main/web"))
    include("*.js")
}

tasks.named("processResources") {
    dependsOn(syncSidecar, syncSidecarProto, syncWeb)
}

// Kotlin 引用生成的 gRPC 类，编译前必须先生成
tasks.named("compileKotlin") {
    dependsOn("generateProto")
}

// 打包产物直接落在 jetbrains-plugin/ 根下，省得进 build/distributions 深目录
tasks.named<AbstractArchiveTask>("buildPlugin") {
    destinationDirectory.set(layout.projectDirectory)
}
