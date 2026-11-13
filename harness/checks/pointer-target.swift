// A window that reports the mouse events it receives, for pointer-guards.js: a floating panel
// that takes clicks without taking the front.
//
//   pointer-target <x> <y> <w> <h> [--cover] [--return]
//                                     at that rectangle, in points from the screen's top left
//   pointer-target --under <title>    at the rectangle of the window of that title, under it
//
// Prints {"window", "x", "y", "w", "h"} once the panel is on screen, then one line per button
// event a window of its receives: {"type": "down" | "drag" | "up", "window", "x", "y", "dx",
// "dy"}, the event's position in points from the screen's top left and its delta fields. With
// --cover it shows a second window over the panel when the pointer first moves in it. With
// --return it moves the pointer back to where the button went down at every drag event, as a
// knob of one of Live's devices does.
//
// SIGTERM ends it, and so does the end of the process that started it. If the left button is
// held then, it posts the button up first and prints {"released": <whether that released it>}.

import AppKit

setvbuf(stdout, nil, _IOLBF, 0)

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func printJSON(_ value: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)!)
}

final class Pad: NSView {
    var onFirstMove: (() -> Void)?
    var returnsPointer = false
    var pressed = CGPoint.zero
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        pressed = event.cgEvent?.location ?? .zero
        report("down", event)
    }
    override func mouseDragged(with event: NSEvent) {
        report("drag", event)
        if returnsPointer { CGWarpMouseCursorPosition(pressed) }
    }
    override func mouseUp(with event: NSEvent) { report("up", event) }
    override func mouseMoved(with event: NSEvent) {
        onFirstMove?()
        onFirstMove = nil
    }
    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 0.2, alpha: 0.85).setFill()
        bounds.fill()
    }
    func report(_ type: String, _ event: NSEvent) {
        guard let posted = event.cgEvent else { return }
        printJSON(["type": type, "window": window?.windowNumber ?? -1, "x": posted.location.x, "y": posted.location.y,
                   "dx": posted.getIntegerValueField(.mouseEventDeltaX), "dy": posted.getIntegerValueField(.mouseEventDeltaY)])
    }
}

final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// A panel at `rect`, in points from the top left of the screen with the menu bar.
func showPanel(_ rect: CGRect) -> (Panel, Pad) {
    let screen = NSScreen.screens[0].frame
    let panel = Panel(contentRect: NSRect(x: rect.minX, y: screen.height - rect.maxY, width: rect.width, height: rect.height),
                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary]
    let pad = Pad(frame: NSRect(origin: .zero, size: rect.size))
    panel.contentView = pad
    panel.orderFrontRegardless()
    return (panel, pad)
}

// The rectangle of the window titled `title`, waiting up to 5 s for it to show.
func windowTitled(_ title: String) -> CGRect {
    for _ in 0..<50 {
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
        if let window = list.first(where: { $0[kCGWindowName as String] as? String == title }),
           let rect = CGRect(dictionaryRepresentation: window[kCGWindowBounds as String] as! CFDictionary) {
            return rect
        }
        usleep(100_000)
    }
    fail("No window titled \(title) is on screen")
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// Each drag event as it was posted, not several merged into one.
NSEvent.isMouseCoalescingEnabled = false

var options = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String) -> Bool {
    guard let index = options.firstIndex(of: name) else { return false }
    options.remove(at: index)
    return true
}
let (cover, returnsPointer) = (flag("--cover"), flag("--return"))
let rect: CGRect
if options.count == 2, options[0] == "--under" {
    rect = windowTitled(options[1])
} else {
    let numbers = options.compactMap { Double($0) }
    guard options.count == 4, numbers.count == 4
    else { fail("usage: pointer-target <x> <y> <w> <h> [--cover] [--return] | --under <title>") }
    rect = CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
}

let (panel, pad) = showPanel(rect)
pad.returnsPointer = returnsPointer
var over: Panel?
if cover {
    pad.addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: pad))
    pad.onFirstMove = { over = showPanel(rect).0 }
}
// The window server lists the panel only once the run loop below has run: 50 to 70 ms after
// it was ordered front, and a click posted before that went to the window under it.
Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { timer in
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    guard list.contains(where: { $0[kCGWindowNumber as String] as? Int == panel.windowNumber }) else { return }
    timer.invalidate()
    printJSON(["window": panel.windowNumber, "x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height])
}

func finish() -> Never {
    if CGEventSource.buttonState(.combinedSessionState, button: .left) {
        let pointer = CGEvent(source: nil)?.location ?? .zero
        CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: .leftMouseUp,
                mouseCursorPosition: pointer, mouseButton: .left)?.post(tap: .cghidEventTap)
        // An event posted just before the process exits is lost.
        usleep(100_000)
        printJSON(["released": !CGEventSource.buttonState(.combinedSessionState, button: .left)])
    }
    exit(0)
}

signal(SIGTERM, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminate.setEventHandler { finish() }
terminate.resume()
// A check that was killed can't end its target: launchd is then the parent.
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in if getppid() == 1 { finish() } }
app.run()
