import Foundation

struct PetSession {
    let sessionId: String
    var cwd: String
    var projectName: String
    var state: PetState
    var lastEventAt: Date
}

struct MergedSnapshot {
    let displayState: PetState
    let winnerSessionId: String?
    let sessions: [PetSession]
}

protocol StateMachineDelegate: AnyObject {
    func stateDidChange(_ snapshot: MergedSnapshot)
    func allSessionsRemoved()
}

final class StateMachine {
    weak var delegate: StateMachineDelegate?

    private let queue = DispatchQueue(label: "sema.pet.state", qos: .userInitiated)
    private var sessions: [String: PetSession] = [:]
    private var sleepTimer: DispatchSourceTimer?

    init() {
        startSleepTimer()
    }

    deinit {
        sleepTimer?.cancel()
    }

    func register(_ p: RegisterPayload) {
        queue.async {
            let s = PetSession(
                sessionId: p.sessionId,
                cwd: p.cwd,
                projectName: (p.cwd as NSString).lastPathComponent,
                state: .idle,
                lastEventAt: Date()
            )
            self.sessions[p.sessionId] = s
            self.emitSnapshotLocked()
        }
    }

    func unregister(sessionId: String) {
        queue.async {
            self.sessions.removeValue(forKey: sessionId)
            if self.sessions.isEmpty {
                DispatchQueue.main.async { self.delegate?.allSessionsRemoved() }
            } else {
                self.emitSnapshotLocked()
            }
        }
    }

    func updateState(sessionId: String, state: PetState, ts: Double?) {
        queue.async {
            guard var s = self.sessions[sessionId] else { return }
            s.state = state
            if let ts = ts {
                s.lastEventAt = Date(timeIntervalSince1970: ts / 1000)
            } else {
                s.lastEventAt = Date()
            }
            self.sessions[sessionId] = s
            self.emitSnapshotLocked()
        }
    }

    func cwd(for sessionId: String) -> String? {
        queue.sync { sessions[sessionId]?.cwd }
    }

    func snapshot() -> MergedSnapshot {
        queue.sync { buildSnapshotLocked() }
    }

    private func emitSnapshotLocked() {
        let snap = buildSnapshotLocked()
        DispatchQueue.main.async { self.delegate?.stateDidChange(snap) }
    }

    private func buildSnapshotLocked() -> MergedSnapshot {
        let all = Array(sessions.values).sorted { $0.sessionId < $1.sessionId }

        var winner: PetSession? = nil
        for s in all {
            guard let cur = winner else { winner = s; continue }
            if s.state.priority > cur.state.priority {
                winner = s
            } else if s.state.priority == cur.state.priority && s.lastEventAt > cur.lastEventAt {
                winner = s
            }
        }

        let display: PetState
        if let w = winner {
            if w.state == .idle && allIdleLongEnough(all) {
                display = .sleeping
            } else {
                display = w.state
            }
        } else {
            display = .sleeping
        }

        return MergedSnapshot(displayState: display, winnerSessionId: winner?.sessionId, sessions: all)
    }

    private func allIdleLongEnough(_ all: [PetSession]) -> Bool {
        guard !all.isEmpty else { return false }
        let now = Date()
        for s in all {
            if s.state != .idle { return false }
            if now.timeIntervalSince(s.lastEventAt) < PetConstants.idleToSleepingSec {
                return false
            }
        }
        return true
    }

    private func startSleepTimer() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 30, repeating: 30)
        t.setEventHandler { [weak self] in
            guard let self = self, !self.sessions.isEmpty else { return }
            self.emitSnapshotLocked()
        }
        t.resume()
        sleepTimer = t
    }
}
