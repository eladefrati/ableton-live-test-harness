// Sees and clicks Live's windows for device-ui.js (ADR-0004, ADR-0008):
//
//   device-ui window                  Live's main window: {"id", "x", "y", "w", "h"} in points
//   device-ui windows                 all of Live's windows on screen, front to back:
//                                     [{"id", "title", "layer", "x", "y", "w", "h"}]
//   device-ui plugin-window state|open|close <device>
//                                     reads, or presses until it reads so, the Show/Hide
//                                     Plug-In Window checkbox of the device of that name in
//                                     Device Detail: {"open"}
//   device-ui plugin-editor <title>   the plug-in window of that title and its editor:
//                                     {"id", "x", "y", "w", "h", "editor": {"x", "y", "w", "h"}}
//   device-ui text <png>              the text in an image, in pixels: {"width", "lines":
//                                     [{"text", "x", "y", "w", "h", "words": [{"text", "x"}]}]}
//   device-ui crop <png> <x> <y> <w> <h> <out>
//                                     saves the rectangle of the image, in pixels, as a PNG
//   device-ui hover <window> <x> <y>  moves the pointer to a point on the screen, in points
//   device-ui click <window> <x> <y>  moves the pointer there, presses and releases
//   device-ui click-editor <title> <x> <y> <w> <h>
//                                     clicks the point <x> <y> of the plug-in window's editor,
//                                     in points from its top left, if the editor is <w> x <h>
//   device-ui drag <window> <x> <y> <dx> <dy>
//   device-ui drag-editor <title> <x> <y> <w> <h> <dx> <dy>
//                                     as click and click-editor, but moves the pointer by
//                                     <dx>, <dy> points (right, down) with the button down
//                                     (ADR-0010)
//
// hover, click and drag refuse, posting nothing, unless the screen is unlocked and <window> is
// the topmost window at the point; the editor's commands also unless the point is inside the
// editor and the editor is the size given; a drag also unless it is at most MAX_DRAG points
// either way and ends on a screen. Exits 1 with the reason on stderr if anything fails.

import ApplicationServices
import Foundation
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func printJSON(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value)
    print(String(data: data, encoding: .utf8)!)
}

// The normal (layer 0) windows on screen, front to back.
func windows() -> [[String: Any]] {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    return list.filter { ($0[kCGWindowLayer as String] as? Int ?? 1) == 0 }
}

func bounds(_ window: [String: Any]) -> CGRect {
    CGRect(dictionaryRepresentation: window[kCGWindowBounds as String] as! CFDictionary) ?? .zero
}

func number(_ window: [String: Any]) -> Int { window[kCGWindowNumber as String] as? Int ?? -1 }

func mainWindow() {
    let live = windows().filter { ($0[kCGWindowOwnerName as String] as? String) == "Live" }
    guard let window = live.max(by: { bounds($0).width * bounds($0).height < bounds($1).width * bounds($1).height })
    else { fail("Live has no window on screen") }
    let r = bounds(window)
    printJSON(["id": number(window), "x": r.minX, "y": r.minY, "w": r.width, "h": r.height])
}

func isLive(_ window: [String: Any]) -> Bool { (window[kCGWindowOwnerName as String] as? String) == "Live" }

func liveWindows() {
    printJSON(clickableWindows().filter(isLive).map { window -> [String: Any] in
        let r = bounds(window)
        return ["id": number(window), "title": window[kCGWindowName as String] as? String ?? "",
                "layer": window[kCGWindowLayer as String] as? Int ?? 0,
                "x": r.minX, "y": r.minY, "w": r.width, "h": r.height]
    })
}

// Live's Accessibility tree (ADR-0008). Live 12.4 names its device view's parts there; the
// search stays near the top, as the browser's lists below hold thousands of elements.
func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }

func frame(_ element: AXUIElement) -> CGRect {
    var origin = CGPoint.zero, size = CGSize.zero
    if let value = attribute(element, kAXPositionAttribute) { AXValueGetValue(value as! AXValue, .cgPoint, &origin) }
    if let value = attribute(element, kAXSizeAttribute) { AXValueGetValue(value as! AXValue, .cgSize, &size) }
    return CGRect(origin: origin, size: size)
}

func liveElement() -> AXUIElement {
    guard AXIsProcessTrusted() else { fail("Reading Live's window needs Accessibility for the terminal app") }
    let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
    let pids = Set(list.filter(isLive).compactMap { $0[kCGWindowOwnerPID as String] as? Int })
    guard pids.count == 1, let pid = pids.first else { fail(pids.isEmpty ? "Live isn't running" : "More than one Live is running") }
    let app = AXUIElementCreateApplication(pid_t(pid))
    AXUIElementSetMessagingTimeout(app, 3)
    return app
}

func axWindows(_ app: AXUIElement) -> [AXUIElement] { attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? [] }

func within(_ element: AXUIElement, depth: Int, _ match: (AXUIElement) -> Bool) -> [AXUIElement] {
    (match(element) ? [element] : []) + (depth == 0 ? [] : children(element).flatMap { within($0, depth: depth - 1, match) })
}

let SHOW_PLUGIN_WINDOW = "Show/Hide Plug-In Window"

// The Show/Hide Plug-In Window checkbox of the one device named `device` in Device Detail,
// which shows the selected track's devices.
func pluginWindowButton(_ device: String) -> AXUIElement {
    let app = liveElement()
    let detail = axWindows(app).flatMap { within($0, depth: 3) { attribute($0, kAXTitleAttribute) as? String == "Device Detail" } }
    guard !detail.isEmpty else { fail("Live's Device Detail isn't in its window: is the Detail View shown?") }
    let devices = detail.flatMap(children).filter { attribute($0, kAXTitleAttribute) as? String == device }
    guard devices.count == 1 else {
        fail(devices.isEmpty ? "Device Detail shows no device named \(device): is it selected?" : "Device Detail shows \(devices.count) devices named \(device)")
    }
    guard let button = children(devices[0]).first(where: { attribute($0, kAXDescriptionAttribute) as? String == SHOW_PLUGIN_WINDOW })
    else { fail("\(device) has no \(SHOW_PLUGIN_WINDOW) button: is it a plug-in?") }
    return button
}

func isOpen(_ button: AXUIElement) -> Bool { (attribute(button, kAXValueAttribute) as? Int ?? 0) == 1 }

func pluginWindow(_ action: String, _ device: String) {
    let button = pluginWindowButton(device)
    if action != "state" && isOpen(button) != (action == "open") {
        guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success
        else { fail("Pressing \(device)'s \(SHOW_PLUGIN_WINDOW) failed") }
        var tries = 0
        while isOpen(button) != (action == "open") {
            tries += 1
            if tries > 30 { fail("\(device)'s plug-in window didn't \(action)") }
            usleep(100_000)
        }
    }
    printJSON(["open": isOpen(button)])
}

// The plug-in window titled `title` (Live names it "<device>/<track>") and its editor: the one
// group in it, below Live's title bar. Only on screen while Live is in front and the display
// is on.
func pluginEditor(_ title: String) -> (id: Int, window: CGRect, editor: CGRect) {
    let shown = clickableWindows().filter { isLive($0) && $0[kCGWindowName as String] as? String == title }
    guard shown.count == 1 else {
        fail(shown.isEmpty ? "The plug-in window \(title) isn't on screen" : "\(shown.count) windows are titled \(title)")
    }
    let window = bounds(shown[0])
    let matching = axWindows(liveElement()).filter { attribute($0, kAXTitleAttribute) as? String == title && frame($0) == window }
    guard matching.count == 1 else { fail("Accessibility shows \(matching.count) windows titled \(title)") }
    let groups = children(matching[0]).filter { attribute($0, kAXRoleAttribute) as? String == kAXGroupRole }
    guard groups.count == 1 else { fail("The plug-in window \(title) has \(groups.count) groups, not one editor") }
    return (number(shown[0]), window, frame(groups[0]))
}

func printEditor(_ title: String) {
    let (id, window, editor) = pluginEditor(title)
    printJSON(["id": id, "x": window.minX, "y": window.minY, "w": window.width, "h": window.height,
               "editor": ["x": editor.minX, "y": editor.minY, "w": editor.width, "h": editor.height]])
}

func text(in path: String) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("Cannot read \(path)") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    do {
        try VNImageRequestHandler(cgImage: image).perform([request])
    } catch {
        fail("Text recognition failed: \(error)")
    }
    let (w, h) = (Double(image.width), Double(image.height))
    let lines = (request.results ?? []).compactMap { result -> [String: Any]? in
        guard let candidate = result.topCandidates(1).first else { return nil }
        let string = candidate.string
        let box = result.boundingBox // normalized, origin at the bottom left
        // Each word's own left edge: a line's box takes in icons read as characters.
        let words = string.split(separator: " ").map { word -> [String: Any] in
            let edge = (try? candidate.boundingBox(for: word.startIndex..<word.endIndex))?.boundingBox.minX ?? box.minX
            return ["text": String(word), "x": edge * w]
        }
        return ["text": string, "x": box.minX * w, "y": (1 - box.maxY) * h, "w": box.width * w, "h": box.height * h,
                "words": words]
    }
    printJSON(["width": image.width, "lines": lines])
}

// sips can't do this: it leaves an image whole, with no error, when the rectangle starts
// below the top and reaches the bottom edge, as a plug-in's editor does in its window
// (sips-316, macOS 26).
func crop(_ path: String, _ rect: CGRect, to out: String) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("Cannot read \(path)") }
    guard CGRect(x: 0, y: 0, width: image.width, height: image.height).contains(rect), let part = image.cropping(to: rect)
    else { fail("\(rect) isn't inside the \(image.width) x \(image.height) image \(path)") }
    guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)
    else { fail("Cannot write \(out)") }
    CGImageDestinationAddImage(destination, part, nil)
    if !CGImageDestinationFinalize(destination) { fail("Cannot write \(out)") }
}

// A locked screen takes the events itself. The flag clears a moment after the display wakes.
func requireUnlocked() {
    for _ in 0..<30 {
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        if (session?["CGSSessionScreenIsLocked"] as? Bool) != true { return }
        usleep(100_000)
    }
    fail("The screen is locked")
}

// Every window on screen that can take a click, front to back: all layers, since a floating
// window (a plug-in's, layer 3) or the menu bar covers Live's main window, but none from the
// cursor's layer up, as the cursor is a window too and sits on the point after a hover. Nor
// harness-computer-use's own overlay (computer-use-overlay.swift, ADR-0009), which covers the
// screen and lets every click through: its title, and its program's name, cut short as macOS
// reports it.
func clickableWindows() -> [[String: Any]] {
    let cursor = Int(CGWindowLevelForKey(.cursorWindow))
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    return list.filter { ($0[kCGWindowLayer as String] as? Int ?? cursor) < cursor && !isOverlay($0) }
}

func isOverlay(_ window: [String: Any]) -> Bool {
    (window[kCGWindowName as String] as? String) == "harness-computer-use overlay"
        && (window[kCGWindowOwnerName as String] as? String ?? "").hasPrefix("computer-use-overlay")
}

// While a notification banner shows, from any app, Notification Center holds a transparent
// window over the whole screen. Rather than guess whether the point is under the banner, the
// guard waits for that window to go.
let NOTIFICATION_WAIT_SECONDS = 10.0

func isNotificationCover(_ window: [String: Any]) -> Bool {
    (window[kCGWindowOwnerName as String] as? String) == "Notification Center"
        && bounds(window) == CGDisplayBounds(CGMainDisplayID())
}

func requireOnTop(_ id: Int, _ point: CGPoint) {
    let deadline = Date().addingTimeInterval(NOTIFICATION_WAIT_SECONDS)
    var top = clickableWindows().first(where: { bounds($0).contains(point) })
    while let cover = top, isNotificationCover(cover), Date() < deadline {
        usleep(250_000)
        top = clickableWindows().first(where: { bounds($0).contains(point) })
    }
    guard let top else { fail("No window at the point") }
    if isNotificationCover(top) { fail("A notification has covered the screen for \(Int(NOTIFICATION_WAIT_SECONDS)) s") }
    if number(top) != id {
        fail("The window at the point is \(top[kCGWindowOwnerName as String] ?? "?") \(number(top)), not \(id)")
    }
}

func post(_ type: CGEventType, _ point: CGPoint) {
    guard let event = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type,
                              mouseCursorPosition: point, mouseButton: .left)
    else { fail("Cannot create a mouse event") }
    event.setIntegerValueField(.mouseEventClickState, value: 1)
    event.post(tap: .cghidEventTap)
}

// The longest drag either way, in points (ADR-0010).
let MAX_DRAG = 400.0

// The end of a drag from `point`, or a failure, before any event is posted.
func dragEnd(_ point: CGPoint, _ delta: CGVector) -> CGPoint {
    guard abs(delta.dx) <= MAX_DRAG, abs(delta.dy) <= MAX_DRAG, delta.dx != 0 || delta.dy != 0
    else { fail("A drag moves between 1 and \(Int(MAX_DRAG)) points either way, not \(delta.dx), \(delta.dy)") }
    let end = CGPoint(x: point.x + delta.dx, y: point.y + delta.dy)
    var count: UInt32 = 0
    guard CGGetDisplaysWithPoint(end, 0, nil, &count) == .success, count > 0 else { fail("A drag to \(end) ends off screen") }
    return end
}

// Button down at `point`, one-point steps to `end`, button up there. Each drag event carries
// its movement too, for controls that read how far the mouse moved.
func drag(_ point: CGPoint, to end: CGPoint) {
    post(.leftMouseDown, point)
    usleep(70_000)
    let steps = Int(max(abs(end.x - point.x), abs(end.y - point.y)).rounded(.up))
    var last = point
    for step in 1...steps {
        let t = Double(step) / Double(steps)
        let next = CGPoint(x: point.x + (end.x - point.x) * t, y: point.y + (end.y - point.y) * t)
        guard let event = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: .leftMouseDragged,
                                  mouseCursorPosition: next, mouseButton: .left)
        else { fail("Cannot create a mouse event") }
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        event.setIntegerValueField(.mouseEventDeltaX, value: Int64((next.x - last.x).rounded()))
        event.setIntegerValueField(.mouseEventDeltaY, value: Int64((next.y - last.y).rounded()))
        event.post(tap: .cghidEventTap)
        last = next
        usleep(8_000)
    }
    usleep(50_000)
    post(.leftMouseUp, end)
    usleep(100_000)
}

func press(_ point: CGPoint) {
    post(.leftMouseDown, point)
    usleep(70_000)
    post(.leftMouseUp, point)
    usleep(100_000)
}

// Within this of a size counts as that size: Accessibility reports whole points.
let SIZE_TOLERANCE = 0.5

// The plug-in window's id and the screen point of <x> <y> in its editor, if the editor is
// `size` and the point inside it.
func editorPoint(_ title: String, _ x: Double, _ y: Double, _ size: CGSize) -> (Int, CGPoint) {
    let (id, _, editor) = pluginEditor(title)
    if abs(editor.width - size.width) > SIZE_TOLERANCE || abs(editor.height - size.height) > SIZE_TOLERANCE {
        fail("The editor of \(title) is \(editor.width) x \(editor.height) points, not \(size.width) x \(size.height)")
    }
    guard x > 0, y > 0, x < editor.width, y < editor.height else {
        fail("\(x), \(y) isn't inside the editor of \(title), \(editor.width) x \(editor.height) points")
    }
    return (id, CGPoint(x: editor.minX + x, y: editor.minY + y))
}

// To the point, checked on top before and after the hover: Live hides a plug-in's window
// when it leaves the front.
func aim(_ id: Int, _ point: CGPoint) {
    requireOnTop(id, point)
    hover(point)
    requireOnTop(id, point)
}

// Two moves, because the Info View updates when the pointer moves, not when it arrives.
func hover(_ point: CGPoint) {
    post(.mouseMoved, CGPoint(x: point.x - 3, y: point.y - 1))
    usleep(120_000)
    post(.mouseMoved, point)
    usleep(120_000)
}

let arguments = CommandLine.arguments
func pointer() -> (Int, CGPoint) {
    guard arguments.count == 5, let id = Int(arguments[2]), let x = Double(arguments[3]), let y = Double(arguments[4])
    else { fail("usage: device-ui \(arguments[1]) <window> <x> <y>") }
    return (id, CGPoint(x: x, y: y))
}

switch arguments.count > 1 ? arguments[1] : "" {
case "window":
    mainWindow()
case "windows":
    liveWindows()
case "text":
    guard arguments.count == 3 else { fail("usage: device-ui text <png>") }
    text(in: arguments[2])
case "crop":
    let numbers = arguments.dropFirst(3).prefix(4).compactMap { Double($0) }
    guard arguments.count == 8, numbers.count == 4 else { fail("usage: device-ui crop <png> <x> <y> <w> <h> <out>") }
    crop(arguments[2], CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3]), to: arguments[7])
case "hover":
    let (id, point) = pointer()
    requireUnlocked()
    requireOnTop(id, point)
    hover(point)
case "click":
    let (id, point) = pointer()
    requireUnlocked()
    requireOnTop(id, point)
    hover(point)
    press(point)
case "plugin-window":
    guard arguments.count == 4, ["state", "open", "close"].contains(arguments[2])
    else { fail("usage: device-ui plugin-window state|open|close <device>") }
    pluginWindow(arguments[2], arguments[3])
case "plugin-editor":
    guard arguments.count == 3 else { fail("usage: device-ui plugin-editor <title>") }
    printEditor(arguments[2])
case "click-editor", "drag-editor":
    let numbers = arguments.dropFirst(3).compactMap { Double($0) }
    let dragging = arguments[1] == "drag-editor"
    guard arguments.count == (dragging ? 9 : 7), numbers.count == arguments.count - 3
    else { fail("usage: device-ui click-editor <title> <x> <y> <w> <h> | drag-editor <title> <x> <y> <w> <h> <dx> <dy>") }
    requireUnlocked()
    let (id, point) = editorPoint(arguments[2], numbers[0], numbers[1], CGSize(width: numbers[2], height: numbers[3]))
    if dragging {
        let end = dragEnd(point, CGVector(dx: numbers[4], dy: numbers[5]))
        aim(id, point)
        drag(point, to: end)
    } else {
        aim(id, point)
        press(point)
    }
case "drag":
    guard arguments.count == 7, let id = Int(arguments[2]), let x = Double(arguments[3]), let y = Double(arguments[4]),
          let dx = Double(arguments[5]), let dy = Double(arguments[6])
    else { fail("usage: device-ui drag <window> <x> <y> <dx> <dy>") }
    let point = CGPoint(x: x, y: y)
    let end = dragEnd(point, CGVector(dx: dx, dy: dy))
    requireUnlocked()
    aim(id, point)
    drag(point, to: end)
default:
    fail("usage: device-ui window | windows | text <png> | crop <png> <x> <y> <w> <h> <out> | hover <window> <x> <y> | click <window> <x> <y> | "
        + "plugin-window state|open|close <device> | plugin-editor <title> | click-editor <title> <x> <y> <w> <h> | "
        + "drag <window> <x> <y> <dx> <dy> | drag-editor <title> <x> <y> <w> <h> <dx> <dy>")
}
