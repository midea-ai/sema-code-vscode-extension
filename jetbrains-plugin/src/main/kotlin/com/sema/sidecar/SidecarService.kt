package com.sema.sidecar

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import semacore.runtime.SidecarManager
import semacore.transport.BridgeConnection
import semacore.transport.SemaEvent
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

/**
 * 项目级服务：托管该 project 的 sidecar 进程与多条 gRPC 连接，通信层全部委托 sema-core Java SDK。
 * IDE / 项目关闭时随之释放（Disposable）。
 *
 * 一个 project 只拉起**一个** sidecar 进程（SidecarManager：内嵌桥产物释放、Node 探测/下载、
 * 端口握手、SIGTERM 回收），每个 UI 面板（聊天 ToolWindow / 配置编辑器 tab）各自开一条
 * **独立 BridgeConnection**（事件流互不串扰、cmdId 不冲突，进程级事件每条连接都能收到）。
 *
 * 就绪前缓冲与断线指数退避重连由 SDK 连接内置；首条连接创建即异步引导进程（boot 在
 * SDK 守护线程执行，EDT 安全）。dev 用 SEMA_SIDECAR_DIR / -Dsema.sidecar.dir 覆盖桥产物目录。
 */
@Service(Service.Level.PROJECT)
class SidecarService(private val project: Project) : Disposable {
    private val log = logger<SidecarService>()

    @Volatile private var manager: SidecarManager? = null
    private val connections = CopyOnWriteArrayList<BridgeConnection>()

    @Synchronized
    private fun ensureManager(): SidecarManager {
        manager?.let { return it }
        val workingDir = project.basePath ?: System.getProperty("user.home")
        val m = SidecarManager.builder()
            .workingDir(Path.of(workingDir))
            .logConsumer { line -> log.info("[sidecar] $line") }
            .onExit { code -> log.warn("sidecar 进程退出，exit=$code") }
            .build()
        manager = m
        m.start().whenComplete { p, err ->
            if (err != null) log.error("sidecar 启动失败", err)
            else log.info("sidecar 就绪，端口 $p")
        }
        return m
    }

    /**
     * 注册一条面板连接（立即返回）。进程/连接就绪前的指令由 SDK 缓冲，就绪后按序 flush，
     * 避免"命令早于进程就绪"竞态；事件监听先于 connect 挂好，不丢首帧。
     * @param onEvent 该连接收到的所有事件帧（含 ack / error / 会话事件 / 进程事件）
     */
    fun connect(onEvent: (SemaEvent) -> Unit): BridgeConnection {
        val conn = ensureManager().connectionBuilder().build()
        conn.onEvent { ev -> onEvent(ev) }
        conn.onStateChange { state, error ->
            if (error != null) log.warn("sidecar 连接状态 $state", error)
        }
        conn.connect()
        connections.add(conn)
        return conn
    }

    /** 面板关闭时断开其连接（不影响 sidecar 进程与其它面板）。 */
    fun disconnect(conn: BridgeConnection) {
        connections.remove(conn)
        conn.close()
    }

    override fun dispose() {
        connections.forEach { runCatching { it.close() } }
        connections.clear()
        manager?.close()
        manager = null
    }
}
