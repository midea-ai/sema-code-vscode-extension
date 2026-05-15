import AppKit
import Foundation

protocol PetViewDelegate: AnyObject {
    func petViewDidClick()
    func petViewWantsContextMenu(at point: NSPoint, in view: NSView)
    func petViewWindowPositionChanged(origin: NSPoint)
}

final class PetView: NSView {
    weak var delegate: PetViewDelegate?

    private let imageView = NSImageView(frame: .zero)

    private var hitMask: CGImage?

    private var mouseDownScreenPoint: NSPoint?
    private var didDrag = false
    private var windowOriginAtDragStart: NSPoint = .zero
    private let dragThreshold: CGFloat = 4.0

    private let maxSide: CGFloat = 128
    private var currentImageSize: NSSize = .zero

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = .clear

        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.animates = true
        imageView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        imageView.setContentHuggingPriority(.defaultLow, for: .vertical)
        imageView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        imageView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        addSubview(imageView)
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: trailingAnchor),
            imageView.topAnchor.constraint(equalTo: topAnchor),
            imageView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func setImage(_ image: NSImage?) {
        imageView.image = image
        if let image = image {
            currentImageSize = image.size
            resizeWindowKeepingOrigin(for: image.size)
        } else {
            currentImageSize = .zero
        }
        rebuildHitMask(from: image)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil, currentImageSize.width > 0, currentImageSize.height > 0 {
            resizeWindowKeepingOrigin(for: currentImageSize)
        }
    }

    private func resizeWindowKeepingOrigin(for imageSize: NSSize) {
        guard imageSize.width > 0, imageSize.height > 0 else { return }
        guard let window = self.window else { return }
        let longest = max(imageSize.width, imageSize.height)
        let scale = maxSide / longest
        let targetSize = NSSize(
            width: (imageSize.width * scale).rounded(),
            height: (imageSize.height * scale).rounded()
        )
        if window.frame.size == targetSize { return }
        let origin = window.frame.origin
        window.setFrame(NSRect(origin: origin, size: targetSize), display: true, animate: false)
    }

    private func rebuildHitMask(from image: NSImage?) {
        guard let image = image else { hitMask = nil; return }
        if let rep = image.representations.first as? NSBitmapImageRep, let cg = rep.cgImage {
            hitMask = cg
            return
        }
        var rect = NSRect(origin: .zero, size: image.size)
        hitMask = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }

    override func mouseDown(with event: NSEvent) {
        mouseDownScreenPoint = NSEvent.mouseLocation
        didDrag = false
        windowOriginAtDragStart = window?.frame.origin ?? .zero
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = mouseDownScreenPoint, let win = window else { return }
        let current = NSEvent.mouseLocation
        let dx = current.x - start.x
        let dy = current.y - start.y
        if !didDrag && hypot(dx, dy) < dragThreshold { return }
        didDrag = true
        let newOrigin = NSPoint(
            x: windowOriginAtDragStart.x + dx,
            y: windowOriginAtDragStart.y + dy
        )
        win.setFrameOrigin(newOrigin)
    }

    override func mouseUp(with event: NSEvent) {
        defer { mouseDownScreenPoint = nil }
        if didDrag {
            if let origin = window?.frame.origin {
                delegate?.petViewWindowPositionChanged(origin: origin)
            }
            return
        }
        delegate?.petViewDidClick()
    }

    override func rightMouseDown(with event: NSEvent) {
        delegate?.petViewWantsContextMenu(at: event.locationInWindow, in: self)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        guard imageView.frame.contains(local) else { return nil }
        let imageLocal = NSPoint(
            x: local.x - imageView.frame.minX,
            y: local.y - imageView.frame.minY
        )
        guard let mask = hitMask else { return super.hitTest(point) }
        if isPixelOpaque(mask: mask, in: imageView.bounds, at: imageLocal) {
            return self
        }
        return nil
    }

    private func isPixelOpaque(mask: CGImage, in viewBounds: NSRect, at local: NSPoint) -> Bool {
        let w = mask.width, h = mask.height
        guard w > 0, h > 0, viewBounds.width > 0, viewBounds.height > 0 else { return false }
        let px = Int((local.x / viewBounds.width) * CGFloat(w))
        let py = Int(((viewBounds.height - local.y) / viewBounds.height) * CGFloat(h))
        guard px >= 0, px < w, py >= 0, py < h else { return false }

        guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return false }
        var pixel: [UInt8] = [0, 0, 0, 0]
        guard let ctx = CGContext(
            data: &pixel,
            width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        ctx.draw(mask, in: CGRect(x: -CGFloat(px), y: CGFloat(py) - CGFloat(h) + 1, width: CGFloat(w), height: CGFloat(h)))
        return pixel[3] > 16
    }
}
