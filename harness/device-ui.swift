// Sees and clicks Live's window for device-ui.js (ADR-0004):
//
//   device-ui window                  Live's main window: {"id", "x", "y", "w", "h"} in points
//   device-ui windows                 all of Live's windows on screen, front to back:
//                                     [{"id", "title", "x", "y", "w", "h"}]
//   device-ui text <png>              the text in an image, in pixels: {"width", "lines":
//                                     [{"text", "x", "y", "w", "h", "words": [{"text", "x"}]}]}
//   device-ui hover <window> <x> <y>  moves the pointer to a point on the screen, in points
//   device-ui click <window> <x> <y>  moves the pointer there, presses and releases
//
// hover and click refuse, posting nothing, unless the screen is unlocked and <window> is the
// topmost window at the point. Exits 1 with the reason on stderr if anything fails.

import CoreGraphics
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

func liveWindows() {
    let live = windows().filter { ($0[kCGWindowOwnerName as String] as? String) == "Live" }
    printJSON(live.map { window -> [String: Any] in
        let r = bounds(window)
        return ["id": number(window), "title": window[kCGWindowName as String] as? String ?? "",
                "x": r.minX, "y": r.minY, "w": r.width, "h": r.height]
    })
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

// A locked screen takes the events itself. The flag clears a moment after the display wakes.
func requireUnlocked() {
    for _ in 0..<30 {
        let session = CGSessionCopyCurrentDictionary() as? [String: Any]
        if (session?["CGSSessionScreenIsLocked"] as? Bool) != true { return }
        usleep(100_000)
    }
    fail("The screen is locked")
}

func requireOnTop(_ id: Int, _ point: CGPoint) {
    guard let top = windows().first(where: { bounds($0).contains(point) }) else { fail("No window at the point") }
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
    post(.leftMouseDown, point)
    usleep(70_000)
    post(.leftMouseUp, point)
    usleep(100_000)
default:
    fail("usage: device-ui window | windows | text <png> | hover <window> <x> <y> | click <window> <x> <y>")
}
