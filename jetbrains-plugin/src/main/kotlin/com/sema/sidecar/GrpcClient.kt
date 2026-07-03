package com.sema.sidecar

import com.intellij.openapi.diagnostic.logger
import com.sema.grpc.BridgeCommand
import com.sema.grpc.BridgeEvent
import com.sema.grpc.SemaBridgeGrpc
import io.grpc.ManagedChannel
import io.grpc.okhttp.OkHttpChannelBuilder
import io.grpc.stub.StreamObserver
import java.util.concurrent.TimeUnit

/**
 * gRPC 双向流客户端：连接 sema-grpc 的 SemaBridge.Connect。
 * 收到 BridgeEvent 回调 onEvent；send() 写 BridgeCommand。桥保持哑转发，不解释内容。
 */
class GrpcClient(
    private val port: Int,
    private val onEvent: (BridgeEvent) -> Unit,
    private val onClosed: (Throwable?) -> Unit,
) {
    private val log = logger<GrpcClient>()
    private var channel: ManagedChannel? = null
    private var requests: StreamObserver<BridgeCommand>? = null

    fun connect() {
        val ch = OkHttpChannelBuilder.forAddress("127.0.0.1", port)
            .usePlaintext()
            .build()
        channel = ch
        val stub = SemaBridgeGrpc.newStub(ch)
        requests = stub.connect(object : StreamObserver<BridgeEvent> {
            override fun onNext(value: BridgeEvent) = onEvent(value)
            override fun onError(t: Throwable) {
                log.warn("gRPC stream error", t)
                onClosed(t)
            }
            override fun onCompleted() = onClosed(null)
        })
    }

    fun send(id: String, action: String, payload: String, sessionId: String) {
        val cmd = BridgeCommand.newBuilder()
            .setId(id)
            .setAction(action)
            .setPayload(payload)
            .setSessionId(sessionId)
            .build()
        requests?.onNext(cmd)
    }

    fun shutdown() {
        try {
            requests?.onCompleted()
        } catch (_: Exception) {
        }
        channel?.shutdown()?.awaitTermination(3, TimeUnit.SECONDS)
        channel = null
        requests = null
    }
}
