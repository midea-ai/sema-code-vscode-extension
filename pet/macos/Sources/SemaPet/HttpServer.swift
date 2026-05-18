import Foundation
import Network

protocol HttpServerDelegate: AnyObject {
    func httpHandleRegister(_ p: RegisterPayload) -> Bool
    func httpHandleUnregister(sessionId: String)
    func httpHandleState(_ p: StatePayload)
    func httpHandleSay(_ p: SayPayload)
    func httpEnqueueWaiter(sessionId: String,
                           send: @escaping (Data) -> Void,
                           onCancel: @escaping () -> Void) -> UUID
    func httpCancelWaiter(sessionId: String, id: UUID)
}

final class HttpServer {
    weak var delegate: HttpServerDelegate?

    private let port: UInt16
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "sema.pet.http")
    private var activeContexts: [ObjectIdentifier: ConnectionContext] = [:]

    init(port: UInt16) {
        self.port = port
    }

    func start() throws {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.acceptLocalOnly = true
        let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        l.newConnectionHandler = { [weak self] conn in
            self?.accept(conn)
        }
        l.stateUpdateHandler = { state in
            if case let .failed(err) = state {
                FileHandle.standardError.write(Data("[sema-pet] listener failed: \(err)\n".utf8))
                exit(1)
            }
        }
        l.start(queue: queue)
        listener = l
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func accept(_ conn: NWConnection) {
        let ctx = ConnectionContext(connection: conn, delegate: delegate, queue: queue)
        let key = ObjectIdentifier(ctx)
        activeContexts[key] = ctx
        ctx.onClosed = { [weak self] in
            self?.activeContexts.removeValue(forKey: key)
        }
        ctx.start()
    }
}

private final class ConnectionContext {
    private let connection: NWConnection
    private weak var delegate: HttpServerDelegate?
    private let queue: DispatchQueue
    private var buffer = Data()
    private var closed = false
    private var closeCallbacks: [() -> Void] = []
    var onClosed: (() -> Void)?

    init(connection: NWConnection, delegate: HttpServerDelegate?, queue: DispatchQueue) {
        self.connection = connection
        self.delegate = delegate
        self.queue = queue
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .cancelled, .failed:
                self?.handleConnectionClose()
            default:
                break
            }
        }
        connection.start(queue: queue)
        receive()
    }

    private func handleConnectionClose() {
        let cbs = closeCallbacks
        closeCallbacks.removeAll()
        for cb in cbs { cb() }
        let onClosedCb = onClosed
        onClosed = nil
        onClosedCb?()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self, !self.closed else { return }
            if let data = data, !data.isEmpty {
                self.buffer.append(data)
                self.tryHandleRequest()
            }
            if isComplete || error != nil {
                self.close()
            } else if !self.closed {
                self.receive()
            }
        }
    }

    private func tryHandleRequest() {
        guard let request = HttpRequest.parse(&buffer) else { return }
        route(request)
    }

    private func route(_ req: HttpRequest) {
        switch (req.method, req.path) {
        case ("GET", "/health"):
            writeJson(200, ["ok": true])
        case ("POST", "/session/register"):
            if let p: RegisterPayload = decode(req.body) {
                if delegate?.httpHandleRegister(p) ?? false {
                    writeJson(200, ["ok": true])
                } else {
                    writeJson(409, ["ok": false, "error": "cwd already registered"])
                }
            } else {
                writeJson(400, ["error": "bad payload"])
            }
        case ("POST", "/session/unregister"):
            if let p: UnregisterPayload = decode(req.body) {
                delegate?.httpHandleUnregister(sessionId: p.sessionId)
                writeJson(200, ["ok": true])
            } else {
                writeJson(400, ["error": "bad payload"])
            }
        case ("POST", "/state"):
            if let p: StatePayload = decode(req.body) {
                delegate?.httpHandleState(p)
                writeJson(200, ["ok": true])
            } else {
                writeJson(400, ["error": "bad payload"])
            }
        case ("POST", "/say"):
            if let p: SayPayload = decode(req.body) {
                delegate?.httpHandleSay(p)
                writeJson(200, ["ok": true])
            } else {
                writeJson(400, ["error": "bad payload"])
            }
        case ("GET", "/command"):
            handleCommand(req)
        default:
            writeJson(404, ["error": "not found"])
        }
    }

    private func handleCommand(_ req: HttpRequest) {
        let sessionId = req.query["sessionId"] ?? ""
        guard !sessionId.isEmpty else {
            writeJson(400, ["error": "missing sessionId"])
            return
        }
        let id = delegate?.httpEnqueueWaiter(
            sessionId: sessionId,
            send: { [weak self] data in
                self?.writeRaw(status: 200, body: data)
            },
            onCancel: { [weak self] in
                let noop = (try? JSONEncoder().encode(NoopCommand(type: "noop"))) ?? Data("{\"type\":\"noop\"}".utf8)
                self?.writeRaw(status: 200, body: noop)
            }
        )
        if let waiterId = id {
            closeCallbacks.append { [weak self] in
                self?.delegate?.httpCancelWaiter(sessionId: sessionId, id: waiterId)
            }
        }
    }

    private func decode<T: Decodable>(_ data: Data) -> T? {
        guard !data.isEmpty else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func writeJson(_ status: Int, _ body: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8)
        writeRaw(status: status, body: data)
    }

    private func writeRaw(status: Int, body: Data) {
        guard !closed else { return }
        let reason: String = {
            switch status {
            case 200: return "OK"
            case 400: return "Bad Request"
            case 404: return "Not Found"
            case 409: return "Conflict"
            case 500: return "Internal Server Error"
            default:  return "OK"
            }
        }()
        var header = "HTTP/1.1 \(status) \(reason)\r\n"
        header += "content-type: application/json\r\n"
        header += "content-length: \(body.count)\r\n"
        header += "\(PetConstants.serverHeaderKey): \(PetConstants.serverHeaderValue)\r\n"
        header += "connection: close\r\n\r\n"
        var out = Data(header.utf8)
        out.append(body)
        connection.send(content: out, completion: .contentProcessed { [weak self] _ in
            self?.close()
        })
    }

    private func close() {
        if closed { return }
        closed = true
        connection.cancel()
    }
}

private struct HttpRequest {
    let method: String
    let path: String
    let query: [String: String]
    let headers: [String: String]
    let body: Data

    static func parse(_ buffer: inout Data) -> HttpRequest? {
        guard let headerEnd = findHeaderEnd(in: buffer) else { return nil }
        let headerData = buffer.prefix(headerEnd)
        guard let headerString = String(data: headerData, encoding: .utf8) else {
            buffer.removeAll()
            return nil
        }
        var lines = headerString.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return nil }
        let requestLine = lines.removeFirst()
        let parts = requestLine.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 2 else { return nil }

        let method = parts[0]
        let target = parts[1]
        var path = target
        var query: [String: String] = [:]
        if let qIdx = target.firstIndex(of: "?") {
            path = String(target[..<qIdx])
            let qs = target[target.index(after: qIdx)...]
            for pair in qs.split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1)
                let k = kv[0].removingPercentEncoding ?? String(kv[0])
                let v = kv.count > 1 ? (kv[1].removingPercentEncoding ?? String(kv[1])) : ""
                query[String(k)] = v
            }
        }

        var headers: [String: String] = [:]
        for line in lines {
            if line.isEmpty { continue }
            if let colon = line.firstIndex(of: ":") {
                let key = line[..<colon].lowercased()
                var val = String(line[line.index(after: colon)...])
                val = val.trimmingCharacters(in: .whitespaces)
                headers[key] = val
            }
        }

        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        let bodyStart = headerEnd + 4
        if buffer.count < bodyStart + contentLength {
            return nil
        }
        let body = buffer.subdata(in: bodyStart..<(bodyStart + contentLength))
        buffer.removeSubrange(0..<(bodyStart + contentLength))

        return HttpRequest(method: method, path: path, query: query, headers: headers, body: body)
    }

    private static func findHeaderEnd(in data: Data) -> Int? {
        let needle: [UInt8] = [0x0D, 0x0A, 0x0D, 0x0A]
        guard data.count >= needle.count else { return nil }
        return data.withUnsafeBytes { raw -> Int? in
            let buf = raw.bindMemory(to: UInt8.self)
            for i in 0...(buf.count - needle.count) {
                if buf[i] == 0x0D && buf[i+1] == 0x0A && buf[i+2] == 0x0D && buf[i+3] == 0x0A {
                    return i
                }
            }
            return nil
        }
    }
}

private extension Substring {
    var removingPercentEncoding: String? { String(self).removingPercentEncoding }
}
