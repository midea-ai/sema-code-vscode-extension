import AppKit
import Foundation

final class PetWindow {
    let panel: NSPanel
    let view: PetView

    private static let defaultSize = NSSize(width: 128, height: 128)

    init() {
        let size = Self.defaultSize
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let savedOrigin = PetConfigStore.load().windowPosition
            .map { NSPoint(x: $0.x, y: $0.y) }
            .flatMap { Self.validatedOrigin($0, size: size) }
        let origin = savedOrigin ?? NSPoint(
            x: screenFrame.maxX - size.width - 24,
            y: screenFrame.minY + 60
        )

        let panel = NSPanel(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = false
        panel.ignoresMouseEvents = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let view = PetView(frame: NSRect(origin: .zero, size: size))
        panel.contentView = view

        self.panel = panel
        self.view = view
    }

    func show() {
        panel.orderFrontRegardless()
    }

    private static func validatedOrigin(_ origin: NSPoint, size: NSSize) -> NSPoint? {
        let rect = NSRect(origin: origin, size: size)
        let minVisible: CGFloat = 32
        for screen in NSScreen.screens {
            if screen.frame.intersection(rect).size.width >= minVisible,
               screen.frame.intersection(rect).size.height >= minVisible {
                return origin
            }
        }
        return nil
    }

    func close() {
        panel.orderOut(nil)
    }
}
