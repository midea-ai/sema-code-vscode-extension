package com.sema.sidecar

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.sema.grpc.BridgeEvent
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList

/**
 * 项目级服务：管理该 project 的 sidecar 生命周期 + 多条 gRPC 连接。
 * IDE / 项目关闭时随之释放（Disposable）。
 *
 * 一个 project 只拉起**一个** sidecar 进程（共享同一 SemaCore + 会话池），
 * 但每个 UI 面板（聊天 ToolWindow / 配置编辑器 tab）各自开一条**独立 gRPC 连接**（Conn）。
 * 对齐 sema-grpc 的多连接设计：每连接独立 binders、事件流互不串扰、cmdId 不冲突，
 * 进程级事件（cron:update / mcp:server:status）两条连接都能收到。
 *
 * sidecar 启动是异步的（要等 Node 打印端口），连接就绪前每个 Conn 的指令先入队，就绪后 flush。
 */
@Service(Service.Level.PROJECT)
class SidecarService(private val project: Project) : Disposable {
    private val log = logger<SidecarService>()

    private var sidecar: SidecarProcess? = null
    @Volatile private var port: Int = -1
    @Volatile private var ready = false
    private val connections = CopyOnWriteArrayList<Conn>()

    private data class Command(val id: String, val action: String, val payload: String, val sessionId: String)

    /** 一条面板连接：拥有自己的 GrpcClient 与就绪前缓冲队列。 */
    inner class Conn(private val onEvent: (BridgeEvent) -> Unit) {
        @Volatile private var client: GrpcClient? = null
        private val pending = ConcurrentLinkedQueue<Command>()

        fun send(id: String, action: String, payload: String, sessionId: String) {
            val c = client
            if (c != null) c.send(id, action, payload, sessionId)
            else pending.add(Command(id, action, payload, sessionId))
        }

        @Synchronized
        internal fun attach(p: Int) {
            if (client != null) return
            val c = GrpcClient(p, onEvent) { /* stream closed: 后续做重连 */ }
            c.connect()
            client = c
            while (true) {
                val cmd = pending.poll() ?: break
                c.send(cmd.id, cmd.action, cmd.payload, cmd.sessionId)
            }
        }

        internal fun shutdown() {
            client?.shutdown()
            client = null
        }
    }

    /**
     * 注册一条面板连接（立即返回，命令先入该连接的缓冲队列）。进程就绪后自动 attach。
     * 与 startProcess 解耦：面板构造时即可 connect 拿到可缓冲的 Conn，避免"命令早于 onLoadEnd"竞态。
     * @param onEvent 该连接收到的所有 BridgeEvent（含 ack / error / 会话事件 / 进程事件）
     */
    @Synchronized
    fun connect(onEvent: (BridgeEvent) -> Unit): Conn {
        val conn = Conn(onEvent)
        connections.add(conn)
        if (ready) conn.attach(port) // 进程已就绪（非首个面板）→ 立即 attach；否则等就绪回调统一 attach
        return conn
    }

    /** 拉起 sidecar 进程（幂等）；就绪后为所有已注册连接 attach。首个面板在 onLoadEnd 调用。 */
    @Synchronized
    fun startProcess(sidecarDir: File) {
        if (sidecar != null) return
        startProcessInternal(sidecarDir)
    }

    /** 面板关闭时断开其连接（不影响 sidecar 进程与其它面板）。 */
    fun disconnect(conn: Conn) {
        connections.remove(conn)
        conn.shutdown()
    }

    private fun startProcessInternal(sidecarDir: File) {
        val workingDir = project.basePath ?: System.getProperty("user.home")
        val proc = SidecarProcess(sidecarDir, workingDir)
        sidecar = proc
        proc.start().whenComplete { p, err ->
            if (err != null) {
                log.error("sidecar 启动失败", err)
                return@whenComplete
            }
            port = p
            ready = true
            connections.forEach { it.attach(p) }
            log.info("sidecar 就绪，端口 $p")
        }
    }

    override fun dispose() {
        connections.forEach { it.shutdown() }
        connections.clear()
        sidecar?.stop()
        sidecar = null
        ready = false
        port = -1
    }
}
