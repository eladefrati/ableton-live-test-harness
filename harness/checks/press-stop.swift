// Presses Stop on harness-computer-use's pill for pointer-guards.js, as a click on it would:
// through Accessibility, the button labelled "Stop" in the windows of the overlay <pid>
// (computer-use-overlay.swift). Once pressed the button is labelled "Stopping", and is
// pressed by that label too. Accessibility delivers that press whether or not a click
// would reach the button, which then lies under the view its light is drawn in.
//
//   press-stop <pid> [<run>]
//
// With <run>, a run of the check's own, it finds the button, ends that process with SIGTERM
// and presses as soon as it has gone: sooner than the overlay looks for its run again.
//
// Exits 1, saying why, if the overlay shows no such button or refuses the press. An overlay
// whose run has ended obeys by ending before it answers, which Accessibility reports as a
// press it couldn't complete. That counts as pressed.

import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func stopButton(in element: AXUIElement, depth: Int) -> AXUIElement? {
    if attribute(element, kAXRoleAttribute) as? String == kAXButtonRole,
       ["Stop", "Stopping"].contains(attribute(element, kAXDescriptionAttribute) as? String) {
        return element
    }
    guard depth > 0 else { return nil }
    return (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).lazy.compactMap { stopButton(in: $0, depth: depth - 1) }.first
}

let arguments = CommandLine.arguments
guard (2...3).contains(arguments.count), let pid = pid_t(arguments[1]), let run = arguments.count == 3 ? pid_t(arguments[2]) : 0
else { fail("usage: press-stop <pid> [<run>]") }
guard AXIsProcessTrusted() else { fail("Pressing Stop needs Accessibility for the terminal app") }
guard let stop = stopButton(in: AXUIElementCreateApplication(pid), depth: 6) else { fail("The process \(pid) shows no Stop button") }
if run > 0 {
    kill(run, SIGTERM)
    let deadline = Date().addingTimeInterval(3)
    while kill(run, 0) == 0 {
        if Date() > deadline { fail("The process \(run) didn't end") }
        usleep(1000)
    }
}
let pressed = AXUIElementPerformAction(stop, kAXPressAction as CFString)
guard pressed == .success || pressed == .cannotComplete else { fail("Pressing Stop failed: \(pressed.rawValue)") }
