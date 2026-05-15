import Foundation

struct RuntimeInfo: Codable {
    let port: Int
    let pid: Int
    let startedAt: Double
}

enum RuntimeStore {
    static func write(port: UInt16) {
        PetPaths.ensureDirs()
        let info = RuntimeInfo(
            port: Int(port),
            pid: Int(ProcessInfo.processInfo.processIdentifier),
            startedAt: Date().timeIntervalSince1970 * 1000
        )
        if let data = try? JSONEncoder().encode(info) {
            try? data.write(to: PetPaths.runtimeFile, options: .atomic)
        }
    }

    static func clear() {
        try? FileManager.default.removeItem(at: PetPaths.runtimeFile)
    }
}
