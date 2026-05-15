import AppKit
import Foundation

@main
final class SemaPetApp {
    static func main() {
        PetPaths.ensureDirs()

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)

        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let stateMachine = StateMachine()
    private var focusBridge: FocusBridge!
    private let httpServer = HttpServer(port: PetConstants.port)
    private let assets = Assets()
    private let tray = Tray()
    private var petWindow: PetWindow!
    private let bubblePanel = BubblePanel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        focusBridge = FocusBridge(stateMachine: stateMachine)

        petWindow = PetWindow()
        petWindow.view.delegate = self
        petWindow.view.setImage(assets.image(for: .idle))
        petWindow.show()
        bubblePanel.attach(to: petWindow.panel)

        stateMachine.delegate = self

        tray.dataSource = self
        tray.install()
        tray.onQuit = { [weak self] in self?.quitFromTray() }

        httpServer.delegate = self
        do {
            try httpServer.start()
        } catch {
            let alert = NSAlert()
            alert.messageText = "Sema Pet 启动失败"
            alert.informativeText = "端口 \(PetConstants.port) 被占用或权限不足：\(error.localizedDescription)"
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        RuntimeStore.write(port: PetConstants.port)

        NSAppleEventManager.shared().setEventHandler(self,
            andSelector: #selector(handleQuitEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kCoreEventClass),
            andEventID: AEEventID(kAEQuitApplication))
    }

    @objc func handleQuitEvent(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
        gracefulShutdown(persistDisabled: false)
    }

    func applicationWillTerminate(_ notification: Notification) {
        tray.uninstall()
        RuntimeStore.clear()
    }

    private func quitFromTray() {
        gracefulShutdown(persistDisabled: true)
    }

    private func gracefulShutdown(persistDisabled: Bool) {
        if persistDisabled {
            PetConfigStore.update { $0.enabled = false }
        }
        tray.uninstall()
        httpServer.stop()
        RuntimeStore.clear()
        NSApp.terminate(nil)
    }
}

// MARK: - StateMachineDelegate

extension AppDelegate: StateMachineDelegate {
    func stateDidChange(_ snapshot: MergedSnapshot) {
        petWindow.view.setImage(assets.image(for: snapshot.displayState))
    }

    func allSessionsRemoved() {
        gracefulShutdown(persistDisabled: false)
    }
}

// MARK: - HttpServerDelegate

extension AppDelegate: HttpServerDelegate {
    func httpHandleRegister(_ p: RegisterPayload) {
        stateMachine.register(p)
    }

    func httpHandleUnregister(sessionId: String) {
        stateMachine.unregister(sessionId: sessionId)
    }

    func httpHandleState(_ p: StatePayload) {
        stateMachine.updateState(sessionId: p.sessionId, state: p.state, ts: p.ts)
        DispatchQueue.main.async { [weak self] in
            self?.bubblePanel.clearStickyBubbles(forSession: p.sessionId)
        }
    }

    func httpHandleSay(_ p: SayPayload) {
        DispatchQueue.main.async { [weak self] in
            self?.bubblePanel.showBubble(
                sessionId: p.sessionId,
                text: p.text,
                kind: p.kind,
                ttlMs: p.ttlMs,
                sticky: p.sticky ?? false
            )
        }
    }

    func httpEnqueueWaiter(sessionId: String,
                           send: @escaping (Data) -> Void,
                           onCancel: @escaping () -> Void) -> UUID {
        focusBridge.enqueueWaiter(sessionId: sessionId, send: send, onCancel: onCancel)
    }

    func httpCancelWaiter(sessionId: String, id: UUID) {
        focusBridge.cancelWaiter(sessionId: sessionId, id: id)
    }
}

// MARK: - PetViewDelegate

extension AppDelegate: PetViewDelegate {
    func petViewDidClick() {
        guard let sid = stateMachine.snapshot().winnerSessionId else { return }
        focusBridge.dispatchFocus(sessionId: sid)
    }

    func petViewWantsContextMenu(at point: NSPoint, in view: NSView) {
        let menu = tray.contextMenu()
        menu.popUp(positioning: nil, at: point, in: view)
    }

    func petViewWindowPositionChanged(origin: NSPoint) {
        PetConfigStore.update { cfg in
            cfg.windowPosition = .init(x: Double(origin.x), y: Double(origin.y))
        }
    }
}

// MARK: - TrayDataSource

extension AppDelegate: TrayDataSource {
    func traySnapshot() -> [PetSession] {
        stateMachine.snapshot().sessions
    }

    func trayDidSelectSession(_ sessionId: String) {
        focusBridge.dispatchFocus(sessionId: sessionId)
    }
}
