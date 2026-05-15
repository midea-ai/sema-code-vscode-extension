import Foundation

enum PetState: String, Codable {
    case idle, thinking, working, attention, sleeping

    var priority: Int {
        switch self {
        case .attention: return 4
        case .working:   return 3
        case .thinking:  return 2
        case .idle:      return 1
        case .sleeping:  return 0
        }
    }
}

struct RegisterPayload: Codable {
    let sessionId: String
    let cwd: String
}

struct UnregisterPayload: Codable {
    let sessionId: String
}

struct StatePayload: Codable {
    let sessionId: String
    let state: PetState
    let ts: Double?
}

struct SayPayload: Codable {
    let sessionId: String
    let text: String
    let kind: String?
    let ttlMs: Double?
    let sticky: Bool?
}

struct FocusCommand: Codable {
    let type: String
    let sessionId: String
}

struct NoopCommand: Codable {
    let type: String
}

enum PetConstants {
    static let host = "127.0.0.1"
    static let port: UInt16 = 24700
    static let serverHeaderKey = "x-sema-pet"
    static let serverHeaderValue = "server"
    static let longPollTimeoutSec: TimeInterval = 25
    static let idleToSleepingSec: TimeInterval = 60 * 60
    static let sayDefaultTtlMs: Double = 5000
    static let sayMaxChars: Int = 40
}
