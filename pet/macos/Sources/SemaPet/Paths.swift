import Foundation

enum PetPaths {
    static let petDir: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".sema/pet", isDirectory: true)
    }()

    static let assetsDir = petDir.appendingPathComponent("assets", isDirectory: true)
    static let runtimeFile = petDir.appendingPathComponent("runtime.json")
    static let configFile  = petDir.appendingPathComponent("config.json")

    static func ensureDirs() {
        for url in [petDir, assetsDir] {
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }
}
