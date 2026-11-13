// Shows that harness-computer-use holds the mouse (ADR-0009): a breathing purple glow in from
// the edges of every screen and a pill naming the run, until the process <pid> exits, then a
// notification that the mouse is free again. The pill's Stop sends the run SIGUSR2, after
// which it clicks no more, and takes all of this down at once. The glow lets every click
// through; nothing here takes the front.
//
//   computer-use-overlay <pid> [<run>]
//
// device-ui.swift's click guard skips the glow's windows, titled OVERLAY_TITLE, that this
// program owns. It doesn't skip the pill, which takes clicks.

import AppKit

let OVERLAY_TITLE = "harness-computer-use overlay"
let PILL_TITLE = "harness-computer-use pill"
let PURPLE = NSColor(srgbRed: 0.62, green: 0.47, blue: 0.96, alpha: 1)
let LIGHT_PURPLE = NSColor(srgbRed: 0.78, green: 0.66, blue: 1, alpha: 1)
// The glow fades from the screen's edge over this many points, from this opacity at the edge.
let GLOW_WIDTH = 140.0
let GLOW_EDGE_ALPHA = 0.55
// The pill naming the run sits this far below the menu bar, at the top centre: over Live's
// transport and the set's name, which the harness drives over OSC and doesn't click. It ends
// 44 points below the menu bar, above the editor of a plug-in window Live opened 60 points
// from the screen's top, whose editor starts at 79.
let PILL_MARGIN = 6.0

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments
guard (2...3).contains(arguments.count), let pid = pid_t(arguments[1]) else { fail("usage: computer-use-overlay <pid> [<run>]") }
let run = arguments.count == 3 ? arguments[2] : ""

// A soft glow inward from every edge: one-point rings whose opacity falls off with the distance
// from the edge, with no line where it starts or ends. Drawn once into the view's layer.
final class Glow: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        for inset in stride(from: 0.0, to: GLOW_WIDTH, by: 1.0) {
            let fade = pow(1 - inset / GLOW_WIDTH, 2.2)
            PURPLE.withAlphaComponent(GLOW_EDGE_ALPHA * fade).setStroke()
            let ring = bounds.insetBy(dx: inset + 0.5, dy: inset + 0.5)
            let path = NSBezierPath(roundedRect: ring, xRadius: 12 + inset * 0.6, yRadius: 12 + inset * 0.6)
            path.lineWidth = 1
            path.stroke()
        }
    }
}

// Opacity going from one value to another and back for ever, eased.
func breathe(_ layer: CALayer?, from: Double, to: Double, seconds: Double) {
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = from
    animation.toValue = to
    animation.duration = seconds
    animation.autoreverses = true
    animation.repeatCount = .infinity
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    layer?.add(animation, forKey: "breathe")
}

// Ends the overlay with a notification saying why.
@MainActor func finish(_ message: String) -> Never {
    NSApp.windows.forEach { $0.orderOut(nil) }
    let notify = Process()
    notify.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    notify.arguments = ["-e", "on run argv", "-e",
                        "display notification (item 1 of argv) with title \"harness-computer-use\"",
                        "-e", "end run", message]
    try? notify.run()
    notify.waitUntilExit()
    exit(0)
}

// Stop's target. It is called on the main thread, as AppKit calls every action.
final class Stopper: NSObject {
    let target: pid_t, name: String
    init(target: pid_t, name: String) { (self.target, self.name) = (target, name) }
    @objc func stop() {
        kill(target, SIGUSR2)
        MainActor.assumeIsolated { finish("Stopped: \(name.isEmpty ? "the run" : name) won't click again. The mouse is yours.") }
    }
}
let stopper = Stopper(target: pid, name: run)

// A panel that takes a click without taking the front from the app in front.
final class PillPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// A dark frosted pill: a pulsing dot, harness-computer-use and the run, and Stop.
func pill(on screen: NSScreen) -> NSPanel {
    let text = NSTextField(labelWithAttributedString: {
        let line = NSMutableAttributedString(string: "harness-computer-use", attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.white])
        if !run.isEmpty {
            line.append(NSAttributedString(string: "  \(run)", attributes: [
                .font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.white.withAlphaComponent(0.6)]))
        }
        return line
    }())
    text.sizeToFit()
    // Drawn by hand, white on a faint capsule: AppKit greys a control in a window that never
    // becomes key, as this one doesn't.
    let stop = NSButton(title: "", target: stopper, action: #selector(Stopper.stop))
    stop.isBordered = false
    stop.image = NSImage(systemSymbolName: "stop.fill", accessibilityDescription: nil)?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 9, weight: .bold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.white])))
    stop.attributedTitle = NSAttributedString(string: " Stop", attributes: [
        .font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: NSColor.white])
    stop.imagePosition = .imageLeading
    stop.imageHugsTitle = true
    stop.setAccessibilityLabel("Stop")
    stop.sizeToFit()
    stop.frame.size = NSSize(width: stop.frame.width + 20, height: 24)
    stop.wantsLayer = true
    stop.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.14).cgColor
    stop.layer?.cornerRadius = 12
    let (height, pad, dot, gap) = (38.0, 16.0, 8.0, 10.0)
    let width = pad + dot + gap + text.frame.width + 14 + stop.frame.width + 7
    let panel = PillPanel(contentRect: NSRect(x: screen.frame.minX + (screen.frame.width - width) / 2,
                                              y: screen.visibleFrame.maxY - PILL_MARGIN - height, width: width, height: height),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.title = PILL_TITLE
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    panel.hidesOnDeactivate = false
    let view = NSView(frame: NSRect(origin: .zero, size: panel.frame.size))
    // The frosted background is a sibling under the dot and the text, not their parent: the
    // frosted view tints what it holds, which turned the dot grey.
    let frost = NSVisualEffectView(frame: view.bounds)
    frost.material = .hudWindow
    frost.blendingMode = .behindWindow
    frost.state = .active
    frost.appearance = NSAppearance(named: .darkAqua)
    frost.wantsLayer = true
    frost.layer?.cornerRadius = height / 2
    frost.layer?.masksToBounds = true
    frost.layer?.borderWidth = 1
    frost.layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor
    view.addSubview(frost)
    let light = NSView(frame: NSRect(x: pad, y: (height - dot) / 2, width: dot, height: dot))
    light.wantsLayer = true
    light.layer?.backgroundColor = LIGHT_PURPLE.cgColor
    light.layer?.cornerRadius = dot / 2
    light.layer?.shadowColor = LIGHT_PURPLE.cgColor
    light.layer?.shadowOpacity = 1
    light.layer?.shadowRadius = 4
    light.layer?.shadowOffset = .zero
    breathe(light.layer, from: 1, to: 0.45, seconds: 0.9)
    view.addSubview(light)
    text.setFrameOrigin(NSPoint(x: pad + dot + gap, y: (height - text.frame.height) / 2))
    view.addSubview(text)
    stop.setFrameOrigin(NSPoint(x: width - 7 - stop.frame.width, y: (height - stop.frame.height) / 2))
    view.addSubview(stop)
    panel.contentView = view
    return panel
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// One glow window per screen, above everything but the cursor, on every Space; the pill above
// the glow on the main screen.
for screen in NSScreen.screens {
    let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.title = OVERLAY_TITLE
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .screenSaver
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    let glow = Glow(frame: NSRect(origin: .zero, size: screen.frame.size))
    glow.wantsLayer = true
    breathe(glow.layer, from: 1, to: 0.55, seconds: 2.2)
    window.contentView = glow
    window.orderFrontRegardless()
    if screen == NSScreen.main { pill(on: screen).orderFrontRegardless() }
}

// The run that holds the mouse is gone once signal 0 to it fails.
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
    guard kill(pid, 0) != 0 else { return }
    MainActor.assumeIsolated { finish("\(run.isEmpty ? "The run" : run) has ended: the mouse is yours again.") }
}
app.run()
