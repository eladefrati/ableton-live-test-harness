// Shows that harness-computer-use holds the mouse (ADR-0009): a purple glow around every
// screen and a label naming the run, until the process <pid> exits, then a notification that
// the mouse is free again. The windows let every click through and never take the front.
//
//   computer-use-overlay <pid> <run>
//
// device-ui.swift's click guard skips the windows titled OVERLAY_TITLE that this program owns.

import AppKit

let OVERLAY_TITLE = "harness-computer-use overlay"
let PURPLE = NSColor(srgbRed: 0.56, green: 0.33, blue: 0.95, alpha: 1)
// The glow's width in points, from the screen's edge inward.
let GLOW = 18.0

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3, let pid = pid_t(arguments[1]) else { fail("usage: computer-use-overlay <pid> <run>") }
let run = arguments[2]

final class Glow: NSView {
    override func draw(_ dirtyRect: NSRect) {
        // Strokes from wide and faint to narrow and strong, centred on the edge, read as a glow.
        let steps = 12
        for step in 0..<steps {
            let width = GLOW * 2 * Double(steps - step) / Double(steps)
            PURPLE.withAlphaComponent(0.08 + 0.5 * pow(Double(step + 1) / Double(steps), 2)).setStroke()
            let path = NSBezierPath(rect: bounds)
            path.lineWidth = width
            path.stroke()
        }
    }
}

func labelView(in frame: NSRect) -> NSView {
    let text = NSTextField(labelWithString: "harness-computer-use: \(run) is using the mouse")
    text.font = .systemFont(ofSize: 13, weight: .semibold)
    text.textColor = .white
    text.sizeToFit()
    let pad = NSSize(width: 14, height: 6)
    let pill = NSView(frame: NSRect(x: frame.midX - frame.minX - text.frame.width / 2 - pad.width,
                                    y: frame.height - GLOW - 34 - pad.height,
                                    width: text.frame.width + 2 * pad.width, height: text.frame.height + 2 * pad.height))
    pill.wantsLayer = true
    pill.layer?.backgroundColor = PURPLE.withAlphaComponent(0.9).cgColor
    pill.layer?.cornerRadius = pill.frame.height / 2
    text.setFrameOrigin(NSPoint(x: pad.width, y: pad.height))
    pill.addSubview(text)
    return pill
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
    let glow = Glow(frame: NSRect(origin: .zero, size: screen.frame.size))
    if screen == NSScreen.main { glow.addSubview(labelView(in: screen.frame)) }
    window.contentView = glow
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
                        "-e", "end run", "\(run) has ended: the mouse is yours again."]
    try? notify.run()
    notify.waitUntilExit()
    exit(0)
}
app.run()
