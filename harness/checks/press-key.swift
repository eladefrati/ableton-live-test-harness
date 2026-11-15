// Presses a key for pointer-guards.js as a person does on a keyboard: each modifier down in
// turn, the key down and up, the modifiers up, posted as events (CGEvent) where a keyboard's
// would come in. It presses harness-computer-use's stop key (computer-use-overlay.swift,
// ADR-0017), given as the overlay's --stop-key gives it.
//
//   press-key <code> <modifier>... [--until-gone <file>]
//
// The modifiers are control, option, shift and command. With --until-gone it presses the
// key every 10 ms until <file> is gone, for up to UNTIL_SECONDS, for a press that must come
// as soon as the overlay has claimed the key, and exits 1 if the file is still there.

import Foundation
import CoreGraphics

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let UNTIL_SECONDS = 3.0
// Each modifier's key code and the flag it sets.
let MODIFIER_KEYS: [String: (code: CGKeyCode, flag: CGEventFlags)] = [
    "control": (59, .maskControl), "option": (58, .maskAlternate), "shift": (56, .maskShift), "command": (55, .maskCommand)]

var options = Array(CommandLine.arguments.dropFirst())
var until: String?
if let index = options.firstIndex(of: "--until-gone"), index + 1 < options.count {
    until = options[index + 1]
    options.removeSubrange(index...index + 1)
}
let usage = "usage: press-key <code> <modifier>... [--until-gone <file>]"
guard let first = options.first, let code = CGKeyCode(first) else { fail(usage) }
let modifiers = options.dropFirst().map { name -> (code: CGKeyCode, flag: CGEventFlags) in
    guard let key = MODIFIER_KEYS[name] else { fail("press-key takes the modifiers \(MODIFIER_KEYS.keys.sorted().joined(separator: ", ")), not \(name)") }
    return key
}

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
        if Date() > deadline { fail("\(until) was still there \(Int(UNTIL_SECONDS)) s after the key was first pressed") }
        press()
        usleep(10_000)
    }
} else {
    press()
}
// An event posted just before the process exits is lost.
usleep(100_000)
