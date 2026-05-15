import Foundation

struct PetConfig: Codable {
    var enabled: Bool
    var windowPosition: WindowPosition?

    struct WindowPosition: Codable {
        var x: Double
        var y: Double
    }

    static let `default` = PetConfig(enabled: true, windowPosition: nil)
}

enum PetConfigStore {
    static func load() -> PetConfig {
        guard let data = try? Data(contentsOf: PetPaths.configFile),
              let cfg = try? JSONDecoder().decode(PetConfig.self, from: data) else {
            return .default
        }
        return cfg
    }

    static func save(_ cfg: PetConfig) {
        PetPaths.ensureDirs()
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(cfg) else { return }
        try? data.write(to: PetPaths.configFile, options: .atomic)
    }

    static func update(_ mutate: (inout PetConfig) -> Void) {
        var cfg = load()
        mutate(&cfg)
        save(cfg)
    }
}
