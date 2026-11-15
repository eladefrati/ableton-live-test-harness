// Presses a key for pointer-guards.js as a person does on a keyboard: each modifier down in
// turn, the key down and up, the modifiers up, posted as events (CGEvent) where a keyboard's
// would come in. It presses harness-computer-use's stop key (computer-use-overlay.swift,
// ADR-0017), given as the overlay's --stop-key gives it.
//
//   press-key <code> <modifier>... [--until-gone <file>] [--hold <ms>]
//
// The modifiers are control, option, shift and command. With --hold it holds them down for
// <ms> before the key, as a person's fingers take a moment to reach it. With --until-gone it
// presses the key every 10 ms until <file> is gone, for up to UNTIL_SECONDS, for a press that must come
// as soon as the overlay has claimed the key, and exits 1 if the file is still there.
// Exits 1, posting nothing, if the terminal app may not post events (Accessibility).

import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let UNTIL_SECONDS = 3.0
// An event posted just before the process exits is lost, and with it a modifier's release.
let SETTLE_MICROSECONDS: useconds_t = 100_000
// Each modifier's key code and the flag it sets.
let MODIFIER_KEYS: [String: (code: CGKeyCode, flag: CGEventFlags)] = [
    "control": (59, .maskControl), "option": (58, .maskAlternate), "shift": (56, .maskShift), "command": (55, .maskCommand)]

var options = Array(CommandLine.arguments.dropFirst())
func value(_ name: String) -> String? {
    guard let index = options.firstIndex(of: name), index + 1 < options.count else { return nil }
    defer { options.removeSubrange(index...index + 1) }
    return options[index + 1]
}
let until = value("--until-gone")
let usage = "usage: press-key <code> <modifier>... [--until-gone <file>] [--hold <ms>]"
let hold = value("--hold").map { text -> useconds_t in
    guard let ms = useconds_t(text) else { fail(usage) }
    return ms * 1000
} ?? 0
guard let first = options.first, let code = CGKeyCode(first) else { fail(usage) }
let modifiers = options.dropFirst().map { name -> (code: CGKeyCode, flag: CGEventFlags) in
    guard let key = MODIFIER_KEYS[name] else { fail("press-key takes the modifiers \(MODIFIER_KEYS.keys.sorted().joined(separator: ", ")), not \(name)") }
    return key
}

// Without Accessibility the events would be dropped with no error.
guard AXIsProcessTrusted() else { fail("Pressing a key needs Accessibility for the terminal app") }
let source = CGEventSource(stateID: .hidSystemState)
func post(_ key: CGKeyCode, down: Bool, flags: CGEventFlags, modifier: Bool) {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down) else { fail("The key event couldn't be made") }
    if modifier { event.type = .flagsChanged }
    event.flags = flags
    event.post(tap: .cghidEventTap)
}
func press() {
    var held = CGEventFlags()
    for modifier in modifiers {
        held.insert(modifier.flag)
        post(modifier.code, down: true, flags: held, modifier: true)
    }
    usleep(hold)
    post(code, down: true, flags: held, modifier: false)
    post(code, down: false, flags: held, modifier: false)
    for modifier in modifiers.reversed() {
        held.remove(modifier.flag)
        post(modifier.code, down: false, flags: held, modifier: true)
    }
}

if let until {
    let deadline = Date().addingTimeInterval(UNTIL_SECONDS)
    while FileManager.default.fileExists(atPath: until) {
        if Date() > deadline {
            usleep(SETTLE_MICROSECONDS)
            fail("\(until) was still there \(Int(UNTIL_SECONDS)) s after the key was first pressed")
        }
        press()
        usleep(10_000)
    }
} else {
    press()
}
usleep(SETTLE_MICROSECONDS)
