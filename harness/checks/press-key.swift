// Presses a key for pointer-guards.js, posted as events (CGEvent) where a keyboard's would come
// in: harness-computer-use's stop key (computer-use-overlay.swift, ADR-0017), given as the
// overlay's --stop-key gives it.
//
//   press-key <code> <modifier>... [--until-gone <file> | --after-end <pid> | --hold <ms> | --release]
//
// The modifiers are control, option, shift and command. The key goes down and up carrying
// them as its flags, with no modifier pressed on its own. The hot key takes that as the key.
// Such an event leaves its modifiers held until their release is posted (live-notes.md), so
// it posts their release however it ends but SIGKILL: when it is done, when it fails, and on
// SIGINT, SIGTERM or SIGHUP. With --until-gone it presses the key every 20 ms until <file> is
// gone, for up to UNTIL_SECONDS, for a press that must come as soon as the overlay has
// claimed the key, and exits 1 if the file is still there. The whole chord every 10 ms, 800
// events a second, held up the overlay's start by more than 3 s. With --after-end it ends
// the process <pid> (SIGTERM) and presses as soon as it has gone, as press-stop does with its
// <run>. With --hold it presses the modifiers on their own first, as a person does, and holds
// them down for <ms> before the key. With --release it only posts the modifiers' release, for
// a check to call after one that may have been killed holding them.
// Exits 1, posting nothing, if the terminal app may not post events (Accessibility).

import ApplicationServices
import Foundation

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
func flag(_ name: String) -> Bool {
    guard let index = options.firstIndex(of: name) else { return false }
    options.remove(at: index)
    return true
}
func usageFail() -> Never {
    FileHandle.standardError.write(Data("usage: press-key <code> <modifier>... [--until-gone <file> | --after-end <pid> | --hold <ms> | --release]\n".utf8))
    exit(1)
}
let until = value("--until-gone")
let afterEnd = value("--after-end").map { text -> pid_t in
    guard let pid = pid_t(text), pid > 0 else { usageFail() }
    return pid
}
let hold = value("--hold").map { text -> useconds_t in
    guard let ms = useconds_t(text) else { usageFail() }
    return ms * 1000
}
let releaseOnly = flag("--release")
guard [until != nil, afterEnd != nil, hold != nil, releaseOnly].filter({ $0 }).count <= 1 else { usageFail() }
guard let first = options.first, let code = CGKeyCode(first) else { usageFail() }
let modifiers = options.dropFirst().map { name -> (code: CGKeyCode, flag: CGEventFlags) in
    guard let key = MODIFIER_KEYS[name] else {
        FileHandle.standardError.write(Data("press-key takes the modifiers \(MODIFIER_KEYS.keys.sorted().joined(separator: ", ")), not \(name)\n".utf8))
        exit(1)
    }
    return key
}
let allModifiers = modifiers.reduce(CGEventFlags()) { $0.union($1.flag) }

let eventSource = CGEventSource(stateID: .hidSystemState)
// The modifiers pressed on their own and not yet let go, which every way out lets go.
let heldLock = NSLock()
var held = CGEventFlags()

// Posts a key event: a modifier's press or release (flagsChanged), or the key's.
func post(_ key: CGKeyCode, down: Bool, flags: CGEventFlags, modifier: Bool) -> Bool {
    guard let event = CGEvent(keyboardEventSource: eventSource, virtualKey: key, keyDown: down) else { return false }
    if modifier { event.type = .flagsChanged }
    event.flags = flags
    event.post(tap: .cghidEventTap)
    return true
}
func letGo() {
    heldLock.lock()
    defer { heldLock.unlock() }
    for modifier in modifiers.reversed() where held.contains(modifier.flag) {
        held.remove(modifier.flag)
        _ = post(modifier.code, down: false, flags: held, modifier: true)
    }
    usleep(SETTLE_MICROSECONDS)
}
func fail(_ message: String) -> Never {
    letGo()
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
func pressModifiers() {
    var made = true
    heldLock.lock()
    for modifier in modifiers where made {
        held.insert(modifier.flag)
        made = post(modifier.code, down: true, flags: held, modifier: true)
    }
    heldLock.unlock()
    if !made { fail("The key event couldn't be made") }
}
// The key down and up, carrying the modifiers as its flags, which leaves them held. They are
// counted as held from just before, so that every way out lets them go.
func tapKey() {
    heldLock.lock()
    held = allModifiers
    heldLock.unlock()
    guard post(code, down: true, flags: allModifiers, modifier: false), post(code, down: false, flags: allModifiers, modifier: false)
    else { fail("The key event couldn't be made") }
}

// Without Accessibility the events would be dropped with no error.
guard AXIsProcessTrusted() else { fail("Pressing a key needs Accessibility for the terminal app") }

// An interrupt, termination or hangup lets the modifiers go before this process ends by it:
// on another thread, since the main one sleeps between events.
var signalSources: [DispatchSourceSignal] = []
for number in [SIGINT, SIGTERM, SIGHUP] {
    signal(number, SIG_IGN)
    let signalSource = DispatchSource.makeSignalSource(signal: number, queue: .global())
    signalSource.setEventHandler {
        letGo()
        signal(number, SIG_DFL)
        kill(getpid(), number)
    }
    signalSource.resume()
    signalSources.append(signalSource)
}

if releaseOnly {
    heldLock.lock()
    held = allModifiers
    heldLock.unlock()
    letGo()
    exit(0)
}
if let afterEnd {
    kill(afterEnd, SIGTERM)
    let deadline = Date().addingTimeInterval(UNTIL_SECONDS)
    while kill(afterEnd, 0) == 0 {
        if Date() > deadline { fail("The process \(afterEnd) didn't end") }
        usleep(1000)
    }
}
if let until {
    let deadline = Date().addingTimeInterval(UNTIL_SECONDS)
    while FileManager.default.fileExists(atPath: until) {
        if Date() > deadline { fail("\(until) was still there \(Int(UNTIL_SECONDS)) s after the key was first pressed") }
        tapKey()
        usleep(20_000)
    }
} else if let hold {
    pressModifiers()
    usleep(hold)
    tapKey()
} else {
    tapKey()
}
letGo()
