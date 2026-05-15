import Foundation

final class FocusBridge {
    typealias Waiter = (Data) -> Void

    private let queue = DispatchQueue(label: "sema.pet.focus")
    private var waiters: [String: [(id: UUID, send: Waiter, timer: DispatchSourceTimer)]] = [:]
    private weak var stateMachine: StateMachine?

    init(stateMachine: StateMachine) {
        self.stateMachine = stateMachine
    }

    func enqueueWaiter(sessionId: String, send: @escaping Waiter, onCancel: @escaping () -> Void) -> UUID {
        let id = UUID()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + PetConstants.longPollTimeoutSec)
        timer.setEventHandler { [weak self] in
            self?.removeWaiter(sessionId: sessionId, id: id) { _ in onCancel() }
        }
        timer.resume()

        queue.async {
            self.waiters[sessionId, default: []].append((id, send, timer))
        }
        return id
    }

    func cancelWaiter(sessionId: String, id: UUID) {
        queue.async {
            self.removeWaiterLocked(sessionId: sessionId, id: id)
        }
    }

    private func removeWaiter(sessionId: String, id: UUID, perform: ((Waiter) -> Void)? = nil) {
        queue.async {
            if let send = self.removeWaiterLocked(sessionId: sessionId, id: id) {
                perform?(send)
            }
        }
    }

    @discardableResult
    private func removeWaiterLocked(sessionId: String, id: UUID) -> Waiter? {
        guard var arr = waiters[sessionId] else { return nil }
        guard let idx = arr.firstIndex(where: { $0.id == id }) else { return nil }
        let w = arr.remove(at: idx)
        w.timer.cancel()
        if arr.isEmpty { waiters.removeValue(forKey: sessionId) }
        else { waiters[sessionId] = arr }
        return w.send
    }

    func dispatchFocus(sessionId: String) {
        queue.async {
            guard var arr = self.waiters[sessionId], !arr.isEmpty else {
                self.spawnFallback(sessionId: sessionId)
                return
            }
            let w = arr.removeFirst()
            w.timer.cancel()
            if arr.isEmpty { self.waiters.removeValue(forKey: sessionId) }
            else { self.waiters[sessionId] = arr }
            let payload = FocusCommand(type: "focus", sessionId: sessionId)
            if let data = try? JSONEncoder().encode(payload) {
                w.send(data)
            }
        }
    }

    private func spawnFallback(sessionId: String) {
        guard let cwd = stateMachine?.cwd(for: sessionId) else { return }
        guard let codePath = locateVSCodeCLI() else { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: codePath)
        task.arguments = [cwd]
        do { try task.run() } catch { /* silent v1 */ }
    }

    private func locateVSCodeCLI() -> String? {
        let candidates = [
            "/usr/local/bin/code",
            "/opt/homebrew/bin/code",
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
        ]
        for p in candidates {
            if FileManager.default.isExecutableFile(atPath: p) { return p }
        }
        return nil
    }
}
