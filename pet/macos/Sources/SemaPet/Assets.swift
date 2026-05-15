import AppKit
import Foundation

enum PetAssetSet {
    static let names: [PetState: String] = [
        .idle:      "idle.gif",
        .thinking:  "thinking.gif",
        .working:   "working.gif",
        .attention: "attention.gif",
        .sleeping:  "sleeping.gif"
    ]
}

final class Assets {
    private var cache: [PetState: NSImage] = [:]

    init() {
        PetPaths.ensureDirs()
        seedDefaultsIfMissing()
    }

    func image(for state: PetState) -> NSImage? {
        if let img = cache[state] { return img }
        guard let name = PetAssetSet.names[state] else { return nil }
        let url = PetPaths.assetsDir.appendingPathComponent(name)
        if let img = loadAnimated(url: url) {
            cache[state] = img
            return img
        }
        if let bundled = bundleAssetURL(name: name), let img = loadAnimated(url: bundled) {
            cache[state] = img
            return img
        }
        return nil
    }

    private func seedDefaultsIfMissing() {
        for (_, name) in PetAssetSet.names {
            let dst = PetPaths.assetsDir.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: dst.path) { continue }
            guard let src = bundleAssetURL(name: name) else { continue }
            try? FileManager.default.copyItem(at: src, to: dst)
        }
    }

    private func bundleAssetURL(name: String) -> URL? {
        let stem = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        if let url = Bundle.module.url(forResource: stem, withExtension: ext) {
            return url
        }
        if let url = Bundle.module.url(forResource: "Assets/\(stem)", withExtension: ext) {
            return url
        }
        return nil
    }

    private func loadAnimated(url: URL) -> NSImage? {
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url) else { return nil }
        return NSImage(data: data)
    }
}
