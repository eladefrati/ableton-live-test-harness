// Shows that harness-computer-use holds the mouse (ADR-0009): a breathing purple glow in from
// the edges of every screen and a pill naming the run, until the process <pid> exits, then a
// notification that the mouse is free again. The windows let every click through and never
// take the front.
//
//   computer-use-overlay <pid> [<run>]
//
// device-ui.swift's click guard skips the windows titled OVERLAY_TITLE that this program owns.

import AppKit

let OVERLAY_TITLE = "harness-computer-use overlay"
let PURPLE = NSColor(srgbRed: 0.58, green: 0.36, blue: 0.98, alpha: 1)
let LIGHT_PURPLE = NSColor(srgbRed: 0.78, green: 0.64, blue: 1, alpha: 1)
// The glow fades from the screen's edge over this many points, from this opacity at the edge.
let GLOW_WIDTH = 140.0
let GLOW_EDGE_ALPHA = 0.9
// The pill naming the run sits this far above the bottom of the screen's usable area.
let PILL_MARGIN = 28.0

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

// A dark frosted pill: a pulsing dot, then harness-computer-use and the run.
func pill(on screen: NSScreen) -> NSView {
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
    let (height, pad, dot) = (34.0, 16.0, 8.0)
    let width = pad + dot + 10 + text.frame.width + pad
    let usable = screen.visibleFrame.minY - screen.frame.minY
    let view = NSView(frame: NSRect(x: (screen.frame.width - width) / 2, y: usable + PILL_MARGIN, width: width, height: height))
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
    text.setFrameOrigin(NSPoint(x: pad + dot + 10, y: (height - text.frame.height) / 2))
    view.addSubview(text)
    return view
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// One window per screen, above everything but the cursor, on every Space.
var windows: [NSWindow] = []
for screen in NSScreen.screens {
    let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.title = OVERLAY_TITLE
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .screenSaver
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    let content = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
    let glow = Glow(frame: content.bounds)
    glow.wantsLayer = true
    breathe(glow.layer, from: 1, to: 0.55, seconds: 2.2)
    content.addSubview(glow)
    if screen == NSScreen.main { content.addSubview(pill(on: screen)) }
    window.contentView = content
    window.orderFrontRegardless()
    windows.append(window)
}

// The run that holds the mouse is gone once signal 0 to it fails.
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
    guard kill(pid, 0) != 0 else { return }
    windows.forEach { $0.orderOut(nil) }
    let notify = Process()
    notify.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    notify.arguments = ["-e", "on run argv", "-e",
                        "display notification (item 1 of argv) with title \"harness-computer-use\"",
                        "-e", "end run", "\(run.isEmpty ? "The run" : run) has ended: the mouse is yours again."]
    try? notify.run()
    notify.waitUntilExit()
    exit(0)
}
app.run()
