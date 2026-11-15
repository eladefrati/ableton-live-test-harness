// Says what harness-computer-use's overlay <pid> shows, for pointer-guards.js
// (computer-use-overlay.swift):
//
//   overlay-state <pid>
//
// Prints {"windows", "button", "texts"}: the titles of the overlay's windows on screen, as the
// window server lists them, the label of the pill's button and the pill's texts, such as its
// stop key, as Accessibility gives them. The label is null, and the texts are empty, if the
// overlay shows no button, or doesn't answer within ANSWER_SECONDS: a
// program answers Accessibility on its main thread, so one whose main thread is held up
// gives none.

import ApplicationServices
import Foundation

let ANSWER_SECONDS: Float = 1

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func button(in element: AXUIElement, depth: Int) -> AXUIElement? {
    if attribute(element, kAXRoleAttribute) as? String == kAXButtonRole { return element }
    guard depth > 0 else { return nil }
    return (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).lazy.compactMap { button(in: $0, depth: depth - 1) }.first
}

func texts(in element: AXUIElement, depth: Int) -> [String] {
    if attribute(element, kAXRoleAttribute) as? String == kAXStaticTextRole { return [attribute(element, kAXValueAttribute) as? String ?? ""] }
    guard depth > 0 else { return [] }
    return (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).flatMap { texts(in: $0, depth: depth - 1) }
}

let arguments = CommandLine.arguments
guard arguments.count == 2, let pid = pid_t(arguments[1]), pid > 0 else { fail("usage: overlay-state <pid>") }
guard AXIsProcessTrusted() else { fail("Reading the pill's button needs Accessibility for the terminal app") }
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
let titles = list.filter { $0[kCGWindowOwnerPID as String] as? Int == Int(pid) }.map { $0[kCGWindowName as String] as? String ?? "" }
let overlay = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(overlay, ANSWER_SECONDS)
let label = button(in: overlay, depth: 6).flatMap { attribute($0, kAXDescriptionAttribute) as? String }
let shown: [String: Any] = ["windows": titles, "button": label ?? NSNull(), "texts": texts(in: overlay, depth: 6)]
print(String(data: try! JSONSerialization.data(withJSONObject: shown), encoding: .utf8)!)
