import AppKit

protocol TrayDataSource: AnyObject {
    func traySnapshot() -> [PetSession]
    func trayDidSelectSession(_ sessionId: String)
}

final class Tray: NSObject, NSMenuDelegate {
    private var item: NSStatusItem?
    private let menu = NSMenu()

    weak var dataSource: TrayDataSource?
    var onQuit: (() -> Void)?

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let btn = item.button {
            btn.image = Self.makePawsIcon()
            btn.imagePosition = .imageOnly
            btn.toolTip = "Sema Pet"
            btn.appearsDisabled = false
        }
        menu.delegate = self
        item.menu = menu
        rebuild(sessions: [])
        self.item = item
    }

    func uninstall() {
        if let item = item {
            NSStatusBar.system.removeStatusItem(item)
        }
        item = nil
    }

    private static func makePawsIcon() -> NSImage {
        let pawSize: CGFloat = 11
        let gap: CGFloat = 1
        let totalWidth = pawSize * 2 + gap
        let totalHeight: CGFloat = 16

        let config = NSImage.SymbolConfiguration(pointSize: pawSize, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(hierarchicalColor: .white))
        let paw = NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: nil)?
            .withSymbolConfiguration(config) ?? NSImage()

        let composite = NSImage(size: NSSize(width: totalWidth, height: totalHeight), flipped: false) { _ in
            let leftRect = NSRect(x: 0, y: 3, width: pawSize, height: pawSize)
            let rightRect = NSRect(x: pawSize + gap, y: 0, width: pawSize, height: pawSize)
            paw.draw(in: leftRect)
            paw.draw(in: rightRect)
            return true
        }
        composite.isTemplate = false
        return composite
    }

    func contextMenu() -> NSMenu {
        rebuild(sessions: dataSource?.traySnapshot() ?? [])
        return menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuild(sessions: dataSource?.traySnapshot() ?? [])
    }

    private func rebuild(sessions: [PetSession]) {
        menu.removeAllItems()

        if sessions.isEmpty {
            let empty = NSMenuItem(title: "暂无活跃会话", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        } else {
            let basenameCounts = sessions.reduce(into: [String: Int]()) { acc, s in
                acc[s.projectName, default: 0] += 1
            }
            let sorted = sessions.sorted { lhs, rhs in
                if lhs.state.priority != rhs.state.priority {
                    return lhs.state.priority > rhs.state.priority
                }
                return lhs.sessionId < rhs.sessionId
            }
            for s in sorted {
                let title = format(session: s, dedupe: (basenameCounts[s.projectName] ?? 0) > 1)
                let mi = NSMenuItem(title: title, action: #selector(sessionClicked(_:)), keyEquivalent: "")
                mi.target = self
                mi.representedObject = s.sessionId
                mi.image = Self.stateIcon(s.state)
                menu.addItem(mi)
            }
        }

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "退出桌宠", action: #selector(quitClicked(_:)), keyEquivalent: "")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    private func format(session s: PetSession, dedupe: Bool) -> String {
        var name = s.projectName
        if dedupe {
            let url = URL(fileURLWithPath: s.cwd)
            let parent = url.deletingLastPathComponent().lastPathComponent
            if !parent.isEmpty { name = "\(parent)/\(name)" }
        }
        return "\(name) — \(s.state.rawValue)"
    }

    private static func stateIcon(_ state: PetState) -> NSImage? {
        let color: NSColor
        switch state {
        case .attention: color = .systemOrange
        case .working:   color = .systemGreen
        case .thinking:  color = .systemBlue
        case .idle:      color = .secondaryLabelColor
        case .sleeping:  color = .tertiaryLabelColor
        }
        let canvas: CGFloat = 12
        let dot: CGFloat = 7
        let inset = (canvas - dot) / 2
        let img = NSImage(size: NSSize(width: canvas, height: canvas), flipped: false) { _ in
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: inset, y: inset, width: dot, height: dot)).fill()
            return true
        }
        img.isTemplate = false
        return img
    }

    @objc private func sessionClicked(_ sender: NSMenuItem) {
        guard let sid = sender.representedObject as? String else { return }
        dataSource?.trayDidSelectSession(sid)
    }

    @objc private func quitClicked(_ sender: Any?) {
        onQuit?()
    }
}
