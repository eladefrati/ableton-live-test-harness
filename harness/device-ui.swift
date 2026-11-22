// Sees and clicks Live's windows for device-ui.js (ADR-0004, ADR-0008):
//
//   device-ui window                  Live's main window: {"id", "x", "y", "w", "h"} in points
//   device-ui windows                 all of Live's windows on screen, front to back:
//                                     [{"id", "title", "layer", "x", "y", "w", "h"}]
//   device-ui plugin-window state|open|close <device>
//                                     reads, or presses until it reads so, the Show/Hide
//                                     Plug-In Window checkbox of the device of that name in
//                                     Device Detail: {"open"}
//   device-ui device <title>          the one device of that title in Device Detail, which
//                                     shows the selected track's devices: {"x", "y", "w",
//                                     "h"} in points, as Accessibility frames it
//   device-ui plugin-editor <title>   the plug-in window of that title and its editor:
//                                     {"id", "x", "y", "w", "h", "editor": {"x", "y", "w", "h"}}
//   device-ui text <png>              the text in an image, in pixels: {"width", "lines":
//                                     [{"text", "x", "y", "w", "h", "words": [{"text", "x"}]}]}
//   device-ui crop <png> <width> <x> <y> <w> <h> <out>
//                                     saves the rectangle of the image as a PNG of the image's
//                                     resolution: <x> <y> <w> <h> in points of an image that
//                                     is <width> points wide, as a window's capture is
//   device-ui hover <window> <x> <y>  moves the pointer to a point on the screen, in points
//   device-ui click <window> <x> <y> [double | shift]
//                                     moves the pointer there, presses and releases; with
//                                     double, presses and releases again 0.1 s later, as a
//                                     double-click; with shift, holds Shift down through the
//                                     click (ADR-0019)
//   device-ui click-editor <title> <x> <y> <w> <h>
//                                     clicks the point <x> <y> of the plug-in window's editor,
//                                     in points from its top left, if the editor is <w> x <h>
//   device-ui drag <window> <x> <y> <dx> <dy>
//   device-ui drag-editor <title> <x> <y> <w> <h> <dx> <dy>
//                                     as click and click-editor, but with the button down
//                                     moves the pointer by <dx>, <dy> whole points (right,
//                                     down) in one move, and releases the button where the
//                                     pointer then is (ADR-0013)
//
// hover, click and drag refuse, posting nothing, unless the screen is unlocked and <window> is
// the topmost window at the point, which a click and a drag check again after their hover,
// before the button goes down; the editor's commands also unless the point is inside the
// editor and the editor is the size given; a drag also unless it moves whole points, at least
// 1 on its longer axis and at most MAX_DRAG on either, and ends on a screen. Exits 1 with the
// reason on stderr if anything fails.
//
// Once the run is stopped (ADR-0012), hover, click and drag post nothing but the release of a
// button this helper holds, and exit 3 saying so. The run counts as stopped unless the helper
// can tell that it wasn't: the click token named in HARNESS_COMPUTER_USE_TOKEN can be read,
// and its folder written to. A run that has ended counts as stopped too, whatever became of
// its token: the helper posts only while the process that started it is still its parent.
// So does a run that Stop signalled because it couldn't remove the token: the run passes the
// signal, SIGUSR2, on to this helper, which handles it from its start, whatever its command. A
// click or a drag with only that release left has happened: the helper posts it and exits 4,
// saying that too; so does a double-click stopped after its first click, which happened. A
// helper that fails, or is sent SIGINT, SIGQUIT, SIGTERM or SIGHUP, while it holds the button
// or Shift releases them before it ends: by that signal, or with status 131 after SIGQUIT.

import ApplicationServices
import Foundation
import Vision

// Stop's last resort (ADR-0012): a Stop that can't remove the click token sends the run
// SIGUSR2, and the run passes it on to the helpers it has running. Handled before anything
// else, whatever the command: the signal ends a program that doesn't handle it.
var stopSignalled: sig_atomic_t = 0
signal(SIGUSR2) { _ in stopSignalled = 1 }

// Stop (ADR-0012). The run names its click token in HARNESS_COMPUTER_USE_TOKEN: a file that
// exists while the run may click, which the pill's Stop removes.
let CLICK_TOKEN = ProcessInfo.processInfo.environment["HARNESS_COMPUTER_USE_TOKEN"]
let STOPPED_STATUS: Int32 = 3
// Stopped with only a button's release left: the click or the drag happened.
let HAPPENED_STATUS: Int32 = 4

// What the helper of a run that Stop on its pill stopped says.
let STOPPED_FROM_PILL = "harness-computer-use was stopped from its pill: this run clicks no more"

// The run that started this helper: its parent as it starts. A run that a signal killed
// leaves its token behind, and its helper gets process 1 for a parent.
let RUN = getppid()

// Why this helper may post no more, or nil while it may: while the run that started it is
// still its parent, Stop hasn't signalled it, and the token can be opened for reading and its
// folder can be written to and searched, so that Stop can remove the token. Anything else
// counts as stopped, since the helper can't tell that the run wasn't; device-ui.js reads the
// token the same way. A helper given no token, as on the click host, has no Stop to obey, and
// still posts no more once its run has ended.
func stopped() -> String? {
    // Process 1 from the start is a run that ended before the helper got going.
    if RUN == 1 || getppid() != RUN { return "harness-computer-use's run has ended: this helper clicks no more" }
    if stopSignalled != 0 { return STOPPED_FROM_PILL }
    guard let token = CLICK_TOKEN else { return nil }
    let folder = (token as NSString).deletingLastPathComponent
    func cantTell(_ why: String) -> String {
        "harness-computer-use can't tell that it wasn't stopped (\(why)), which counts as stopped: this run clicks no more"
    }
    if access(folder, W_OK | X_OK) != 0 {
        return cantTell(errno == ENOENT ? "the token's folder \(folder) is gone"
            : "the folder \(folder) can't be written to, so Stop couldn't remove the token")
    }
    let file = open(token, O_RDONLY)
    if file >= 0 {
        close(file)
        return nil
    }
    return errno == ENOENT ? STOPPED_FROM_PILL : cantTell("the token \(token) can't be read")
}

// The button-up event, while this helper holds the button. It is made before the button goes
// down, when failing to make it leaves nothing held, so that whatever fails with the button
// down has the event to release it with.
var held: CGEvent? = nil
// Whether this helper holds Shift down, for a Shift-click: a posted key event leaves its key
// held until its release is posted (live-notes.md), so every way out releases it (release).
var shiftHeld = false
let SHIFT_KEY: CGKeyCode = 56
// A signal that would end the helper, as Ctrl-C on the run does, is held back once the button
// goes down: the helper releases the button first, then ends by that signal (obeySignal).
let ENDING_SIGNALS = [SIGINT, SIGQUIT, SIGTERM, SIGHUP]
var signalled: sig_atomic_t = 0

func fail(_ message: String) -> Never {
    release()
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

// The one device named `device` in Device Detail, which shows the selected track's devices.
func deviceElement(_ device: String) -> AXUIElement {
    let app = liveElement()
    let detail = axWindows(app).flatMap { within($0, depth: 3) { attribute($0, kAXTitleAttribute) as? String == "Device Detail" } }
    guard !detail.isEmpty else { fail("Live's Device Detail isn't in its window: is the Detail View shown?") }
    let devices = detail.flatMap(children).filter { attribute($0, kAXTitleAttribute) as? String == device }
    guard devices.count == 1 else {
        fail(devices.isEmpty ? "Device Detail shows no device named \(device): is it selected?" : "Device Detail shows \(devices.count) devices named \(device)")
    }
    return devices[0]
}

func printDevice(_ device: String) {
    let r = frame(deviceElement(device))
    printJSON(["x": r.minX, "y": r.minY, "w": r.width, "h": r.height])
}

// The Show/Hide Plug-In Window checkbox of the one device named `device` in Device Detail.
func pluginWindowButton(_ device: String) -> AXUIElement {
    guard let button = children(deviceElement(device)).first(where: { attribute($0, kAXDescriptionAttribute) as? String == SHOW_PLUGIN_WINDOW })
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

// Saves the rectangle `rect` of an image as a PNG: in points of an image `width` points
// wide, as a capture of a window is of its window. Each edge is rounded to a pixel by
// itself, so that a rectangle inside the image in points is inside it in pixels: its size
// rounded by itself could end it a pixel past the edge. The PNG is given the image's
// resolution, which a capture carries (144 dpi on a display of 2 pixels per point): a PNG
// that gives none reads as 72 dpi, twice the size.
// sips can't do this: it leaves an image whole, with no error, when the rectangle starts
// below the top and reaches the bottom edge, as a plug-in's editor does in its window
// (sips-316, macOS 26).
func crop(_ path: String, width: Double, _ rect: CGRect, to out: String) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("Cannot read \(path)") }
    let scale = Double(image.width) / width
    let (left, top) = ((rect.minX * scale).rounded(), (rect.minY * scale).rounded())
    let pixels = CGRect(x: left, y: top, width: (rect.maxX * scale).rounded() - left, height: (rect.maxY * scale).rounded() - top)
    guard pixels.width >= 1, pixels.height >= 1, CGRect(x: 0, y: 0, width: image.width, height: image.height).contains(pixels),
          let part = image.cropping(to: pixels)
    else { fail("\(rect) isn't inside the \(width) x \(Double(image.height) / scale) point image \(path)") }
    guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil)
    else { fail("Cannot write \(out)") }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
    let resolution = properties.filter { $0.key == kCGImagePropertyDPIWidth || $0.key == kCGImagePropertyDPIHeight }
    CGImageDestinationAddImage(destination, part, resolution as CFDictionary)
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
// harness-computer-use's own overlay (computer-use-overlay.swift, ADR-0012), which covers the
// screen and lets every click through: its title, and its program's name, cut short as macOS
// reports it. A window that reports no layer counts as a normal one (layer 0): left out, it
// could cover the point unseen.
func clickableWindows() -> [[String: Any]] {
    let cursor = Int(CGWindowLevelForKey(.cursorWindow))
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    return list.filter { ($0[kCGWindowLayer as String] as? Int ?? 0) < cursor && !isOverlay($0) }
}

func isOverlay(_ window: [String: Any]) -> Bool {
    (window[kCGWindowName as String] as? String) == "harness-computer-use overlay"
        && (window[kCGWindowOwnerName as String] as? String ?? "").hasPrefix("computer-use-overlay")
}

// harness-computer-use's pill (ADR-0012), which takes clicks, so the guard doesn't skip it.
func isPill(_ window: [String: Any]) -> Bool {
    (window[kCGWindowName as String] as? String) == "harness-computer-use pill"
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
        if let why = stopped() { halt(why) }
        usleep(250_000)
        top = clickableWindows().first(where: { bounds($0).contains(point) })
    }
    guard let top else { fail("No window at the point") }
    if isNotificationCover(top) { fail("A notification has covered the screen for \(Int(NOTIFICATION_WAIT_SECONDS)) s") }
    if isPill(top) { fail("The point is under harness-computer-use's pill") }
    if number(top) != id {
        fail("The window at the point is \(top[kCGWindowOwnerName as String] ?? "?") \(number(top)), not \(id)")
    }
}

// `clicks`: the click count the event carries, 2 for a double-click's second press and release.
func mouseEvent(_ type: CGEventType, _ point: CGPoint, clicks: Int64 = 1) -> CGEvent {
    guard let event = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type,
                              mouseCursorPosition: point, mouseButton: .left)
    else { fail("Cannot create a mouse event") }
    event.setIntegerValueField(.mouseEventClickState, value: clicks)
    return event
}

func emit(_ type: CGEventType, _ point: CGPoint, moved: CGVector? = nil, clicks: Int64 = 1) {
    let event = mouseEvent(type, point, clicks: clicks)
    if let moved {
        event.setIntegerValueField(.mouseEventDeltaX, value: Int64(moved.dx))
        event.setIntegerValueField(.mouseEventDeltaY, value: Int64(moved.dy))
    }
    event.post(tap: .cghidEventTap)
}

// The button up, for a click, a drag and a release alike, and then a wait: a mouse event
// posted as the last thing a program does is lost (live-notes.md).
func buttonUp(_ point: CGPoint) {
    guard let up = held else { return }
    up.location = point
    up.post(tap: .cghidEventTap)
    held = nil
    // A signal held back cuts a sleep short, so the rest of it is slept again.
    var (wait, left) = (timespec(tv_sec: 0, tv_nsec: 100_000_000), timespec())
    while nanosleep(&wait, &left) != 0 && errno == EINTR { wait = left }
}

// Shift's key up, if this helper holds it, and then a wait, as after a button up: an event
// posted as the last thing a program does is lost.
func releaseShift() {
    guard shiftHeld else { return }
    guard let up = CGEvent(keyboardEventSource: CGEventSource(stateID: .hidSystemState), virtualKey: SHIFT_KEY, keyDown: false)
    else { return }
    up.flags = up.flags.subtracting(.maskShift)
    up.post(tap: .cghidEventTap)
    shiftHeld = false
    usleep(100_000)
}

// Holds Shift down, as a person does before a Shift-click: the mouse events made after it
// from the keyboard's state carry it. Ending signals are held back from here on, as once the
// button is down, so that Shift is released before the helper ends.
func pressShift() {
    obeySignal()
    if let why = stopped() { halt(why) }
    guard let down = CGEvent(keyboardEventSource: CGEventSource(stateID: .hidSystemState), virtualKey: SHIFT_KEY, keyDown: true)
    else { fail("Cannot create a key event") }
    down.flags = down.flags.union(.maskShift)
    holdBackSignals()
    down.post(tap: .cghidEventTap)
    shiftHeld = true
    usleep(50_000)
}

// The events a helper that is halting or failing still posts: the button up where the pointer
// is, if it holds the button, and Shift's release, if it holds Shift. Returns that point.
@discardableResult func release() -> CGPoint? {
    defer { releaseShift() }
    guard let up = held else { return nil }
    let point = CGEvent(source: nil)?.location ?? up.location
    buttonUp(point)
    return point
}

// A signal the helper was started ignoring, as under nohup, stays ignored.
func holdBackSignals() {
    for number in ENDING_SIGNALS {
        if let before = signal(number, { signalled = $0 }) { signal(number, before) }
    }
}

// Ends by a signal that was held back, once the button is up: dies by it, or after a quit
// signal exits with the status a shell reports for that death. The system writes a crash
// report for a program that dies by a quit signal, and a release that went as designed is no
// crash (ADR-0012).
func obeySignal() {
    guard signalled != 0 else { return }
    release()
    if signalled == SIGQUIT { exit(128 + SIGQUIT) }
    signal(signalled, SIG_DFL)
    raise(signalled)
}

// Ends a helper that the run's stop, for the reason `why`, lets post nothing more: by a
// signal held back, or else as stopped.
func halt(_ why: String) -> Never {
    let released = release()
    obeySignal()
    let did = released.map { "released the button at \($0.x), \($0.y)" } ?? "held no button"
    FileHandle.standardError.write(Data("\(why), and the helper \(did)\n".utf8))
    exit(STOPPED_STATUS)
}

// The one function a hover's, a click's and a drag's events leave from, the button-up apart
// (complete), so it checks Stop before each, as requireOnTop does while it waits.
func post(_ type: CGEventType, _ point: CGPoint, moved: CGVector? = nil, clicks: Int64 = 1) {
    obeySignal()
    if let why = stopped() { halt(why) }
    if type == .leftMouseDown {
        let up = mouseEvent(.leftMouseUp, point, clicks: clicks)
        holdBackSignals()
        emit(type, point, clicks: clicks)
        held = up
    } else {
        emit(type, point, moved: moved)
    }
}

// The button-up that completes a click or a drag, posted whether or not the run is stopped:
// the click or the drag has happened by then. A helper stopped by then ends as stopped all
// the same, with a status of its own and saying what happened, so that the run can clear up
// what the click did (ADR-0012). A signal held back comes first.
func complete(_ gesture: String, at point: CGPoint) {
    buttonUp(point)
    releaseShift()
    obeySignal()
    guard let why = stopped() else { return }
    FileHandle.standardError.write(Data("\(why), and the helper released the button at \(point.x), \(point.y): the \(gesture) had happened\n".utf8))
    exit(HAPPENED_STATUS)
}

// The longest drag either way, in points (ADR-0013).
let MAX_DRAG = 400.0

// Refuses a drag from `point` by `delta`, before any event is posted, unless it moves whole
// points, at least 1 on its longer axis and at most MAX_DRAG on either, and ends on a screen.
// Whole points, because a knob of one of Live's devices reads positions in whole points: what
// a fraction of a point turned would depend on the fraction the press point happens to have.
func requireDrag(_ point: CGPoint, _ delta: CGVector) {
    guard delta.dx == delta.dx.rounded(), delta.dy == delta.dy.rounded(),
          abs(delta.dx) <= MAX_DRAG, abs(delta.dy) <= MAX_DRAG, max(abs(delta.dx), abs(delta.dy)) >= 1
    else { fail("A drag moves whole points, at least 1 on its longer axis and at most \(Int(MAX_DRAG)) on either, not \(delta.dx), \(delta.dy)") }
    let end = CGPoint(x: point.x + delta.dx, y: point.y + delta.dy)
    var count: UInt32 = 0
    guard CGGetDisplaysWithPoint(end, 0, nil, &count) == .success, count > 0 else { fail("A drag to \(end) ends off screen") }
}

// Button down at `point`, one drag event at the end of `delta`, button up where the pointer
// then is. One event, not a path of steps: for every drag event, a knob of one of Live's
// devices adds how far that event is from the press point and, when the event has a vertical
// part, moves the pointer back there, so a path measured from the press point is counted
// again at each step (live-notes.md). A control that reads where the pointer is ends at the
// same value either way. The event carries the whole distance in its delta fields too, for
// controls that read how far the mouse moved.
func drag(_ point: CGPoint, by delta: CGVector) {
    let end = CGPoint(x: point.x + delta.dx, y: point.y + delta.dy)
    post(.leftMouseDown, point)
    usleep(70_000)
    post(.leftMouseDragged, end, moved: delta)
    usleep(50_000)
    // Live has moved the pointer back to the press point by now after a move with a vertical
    // part; after any other, and on other controls, it is at the end.
    complete("drag", at: CGEvent(source: nil)?.location ?? end)
}

// A click; `double`, a double-click: a second press and release at the same point, 0.1 s after
// the first release (buttonUp's wait), carrying click count 2, as a person's second click does.
// Stop after the first click ends it there, as a click that happened (ADR-0019).
func press(_ point: CGPoint, double: Bool = false) {
    post(.leftMouseDown, point)
    usleep(70_000)
    guard double else { return complete("click", at: point) }
    buttonUp(point)
    obeySignal()
    if let why = stopped() {
        FileHandle.standardError.write(Data("\(why), after the first click of the double-click at \(point.x), \(point.y): that click had happened\n".utf8))
        exit(HAPPENED_STATUS)
    }
    post(.leftMouseDown, point, clicks: 2)
    usleep(70_000)
    complete("double-click", at: point)
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

// To the point, checked on top before and after the hover: a window can come over the point
// while the pointer travels, and Live hides a plug-in's window when it leaves the front.
func aim(_ id: Int, _ point: CGPoint) {
    requireOnTop(id, point)
    hover(point)
    requireOnTop(id, point)
}

// Two moves, because the Info View updates when the pointer moves, not when it arrives. The
// first is off the control: after Escape closed a menu, the Info View stayed blank while the
// pointer moved within the control that opened it.
func hover(_ point: CGPoint) {
    post(.mouseMoved, CGPoint(x: point.x - 15, y: point.y - 10))
    usleep(120_000)
    post(.mouseMoved, point)
    usleep(120_000)
}

let arguments = CommandLine.arguments
func pointer(gestures: [String] = []) -> (Int, CGPoint) {
    let usage = "usage: device-ui \(arguments[1]) <window> <x> <y>" + gestures.map { " [\($0)]" }.joined(separator: "")
    guard arguments.count == 5 || (arguments.count == 6 && gestures.contains(arguments[5])),
          let id = Int(arguments[2]), let x = Double(arguments[3]), let y = Double(arguments[4])
    else { fail(usage) }
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
    let numbers = arguments.dropFirst(3).prefix(5).compactMap { Double($0) }
    guard arguments.count == 9, numbers.count == 5, numbers[0] > 0 else { fail("usage: device-ui crop <png> <width> <x> <y> <w> <h> <out>") }
    crop(arguments[2], width: numbers[0], CGRect(x: numbers[1], y: numbers[2], width: numbers[3], height: numbers[4]), to: arguments[8])
case "hover":
    let (id, point) = pointer()
    requireUnlocked()
    requireOnTop(id, point)
    hover(point)
case "click":
    let (id, point) = pointer(gestures: ["double", "shift"])
    let gesture = arguments.count == 6 ? arguments[5] : ""
    requireUnlocked()
    aim(id, point)
    // Shift goes down after the aim's checks and hover, just before the button.
    if gesture == "shift" { pressShift() }
    press(point, double: gesture == "double")
case "plugin-window":
    guard arguments.count == 4, ["state", "open", "close"].contains(arguments[2])
    else { fail("usage: device-ui plugin-window state|open|close <device>") }
    pluginWindow(arguments[2], arguments[3])
case "device":
    guard arguments.count == 3 else { fail("usage: device-ui device <title>") }
    printDevice(arguments[2])
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
        let delta = CGVector(dx: numbers[4], dy: numbers[5])
        requireDrag(point, delta)
        aim(id, point)
        drag(point, by: delta)
    } else {
        aim(id, point)
        press(point)
    }
case "drag":
    guard arguments.count == 7, let id = Int(arguments[2]), let x = Double(arguments[3]), let y = Double(arguments[4]),
          let dx = Double(arguments[5]), let dy = Double(arguments[6])
    else { fail("usage: device-ui drag <window> <x> <y> <dx> <dy>") }
    let (point, delta) = (CGPoint(x: x, y: y), CGVector(dx: dx, dy: dy))
    requireDrag(point, delta)
    requireUnlocked()
    aim(id, point)
    drag(point, by: delta)
default:
    fail("usage: device-ui window | windows | device <title> | text <png> | crop <png> <width> <x> <y> <w> <h> <out> | hover <window> <x> <y> | click <window> <x> <y> [double | shift] | "
        + "plugin-window state|open|close <device> | plugin-editor <title> | click-editor <title> <x> <y> <w> <h> | "
        + "drag <window> <x> <y> <dx> <dy> | drag-editor <title> <x> <y> <w> <h> <dx> <dy>")
}
