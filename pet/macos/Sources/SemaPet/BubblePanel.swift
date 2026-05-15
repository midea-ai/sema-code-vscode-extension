import AppKit
import Foundation

final class BubblePanel {
    private let panel: NSPanel
    private let stack = NSStackView()

    private var bubbles: [Entry] = []
    private let maxBubbles = 3
    private var reapTimer: Timer?

    private weak var anchorWindow: NSWindow?
    private var anchorObservers: [NSObjectProtocol] = []

    private struct Entry {
        let view: NSView
        let sessionId: String
        let sticky: Bool
        let expiry: Date?
    }

    init() {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 1, height: 1),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let content = NSView(frame: .zero)
        content.wantsLayer = true
        content.layer?.backgroundColor = .clear

        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])

        panel.contentView = content
        self.panel = panel

        reapTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.reapExpiredBubbles()
        }
    }

    deinit {
        reapTimer?.invalidate()
        for token in anchorObservers {
            NotificationCenter.default.removeObserver(token)
        }
    }

    // MARK: - Public

    func attach(to window: NSWindow) {
        for token in anchorObservers {
            NotificationCenter.default.removeObserver(token)
        }
        anchorObservers.removeAll()
        anchorWindow = window

        let nc = NotificationCenter.default
        let move = nc.addObserver(forName: NSWindow.didMoveNotification, object: window, queue: .main) { [weak self] _ in
            self?.repositionToAnchor()
        }
        let resize = nc.addObserver(forName: NSWindow.didResizeNotification, object: window, queue: .main) { [weak self] _ in
            self?.repositionToAnchor()
        }
        anchorObservers = [move, resize]
        repositionToAnchor()
    }

    func showBubble(sessionId: String, text: String, kind: String?, ttlMs: Double?, sticky: Bool) {
        let truncated = Self.truncate(text, max: PetConstants.sayMaxChars)
        let bubble = makeBubbleView(text: truncated, kind: kind)
        stack.addArrangedSubview(bubble)
        let expiry: Date? = sticky ? nil : Date(timeIntervalSinceNow: (ttlMs ?? PetConstants.sayDefaultTtlMs) / 1000)
        bubbles.append(Entry(view: bubble, sessionId: sessionId, sticky: sticky, expiry: expiry))
        while bubbles.count > maxBubbles {
            let old = bubbles.removeFirst()
            old.view.removeFromSuperview()
        }
        relayout()
    }

    func clearStickyBubbles(forSession sessionId: String) {
        bubbles.removeAll { entry in
            if entry.sessionId == sessionId && entry.sticky {
                entry.view.removeFromSuperview()
                return true
            }
            return false
        }
        relayout()
    }

    // MARK: - Internal

    private func reapExpiredBubbles() {
        let now = Date()
        var changed = false
        bubbles.removeAll { entry in
            if let exp = entry.expiry, exp <= now {
                entry.view.removeFromSuperview()
                changed = true
                return true
            }
            return false
        }
        if changed { relayout() }
    }

    private func relayout() {
        guard let content = panel.contentView else { return }
        if bubbles.isEmpty {
            panel.orderOut(nil)
            return
        }
        content.layoutSubtreeIfNeeded()
        let fitting = stack.fittingSize
        let size = NSSize(
            width: max(fitting.width, 1),
            height: max(fitting.height, 1)
        )
        panel.setContentSize(size)
        repositionToAnchor()
        panel.orderFrontRegardless()
    }

    private func repositionToAnchor() {
        guard let anchor = anchorWindow else { return }
        let anchorFrame = anchor.frame
        let panelSize = panel.frame.size
        let centerX = anchorFrame.midX - panelSize.width / 2
        let bottomY = anchorFrame.maxY + 4
        panel.setFrameOrigin(NSPoint(x: centerX, y: bottomY))
    }

    private func makeBubbleView(text: String, kind: String?) -> NSView {
        let label = NSTextField(labelWithString: text)
        label.textColor = .white
        label.font = .systemFont(ofSize: 12)
        label.maximumNumberOfLines = 2
        label.lineBreakMode = .byTruncatingTail
        label.preferredMaxLayoutWidth = 220
        label.setContentHuggingPriority(.required, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .vertical)

        let container = NSStackView()
        container.orientation = .horizontal
        container.edgeInsets = NSEdgeInsets(top: 6, left: 10, bottom: 6, right: 10)
        container.wantsLayer = true
        let bg: NSColor = (kind == "attention")
            ? NSColor.systemOrange.withAlphaComponent(0.92)
            : NSColor(white: 0, alpha: 0.85)
        container.layer?.backgroundColor = bg.cgColor
        container.layer?.cornerRadius = 8
        container.addArrangedSubview(label)
        return container
    }

    private static func truncate(_ s: String, max: Int) -> String {
        if s.count <= max { return s }
        let end = s.index(s.startIndex, offsetBy: max)
        return String(s[..<end]) + "…"
    }
}
