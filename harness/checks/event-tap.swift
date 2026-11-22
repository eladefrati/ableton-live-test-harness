// Reports the mouse events that reach the session, for editor-guards.js: a listen-only event
// tap, which sees every event posted and changes none.
//
//   event-tap
//
// Prints {"ready": true} once the tap is in place, then one line per pointer move, button
// down, drag or button up: {"type": "move" | "down" | "drag" | "up", "x", "y", "dx", "dy",
// "pid", "at"}, the event's position in points from the screen's top left, its delta fields,
// the process that posted it (0 for a real mouse) and when it was seen, in ms; and
// {"disabled": true, "at"} each time the system turned the tap off, which it then turns on
// again. Given the
// line "freeze" on its input, it suspends (SIGSTOP) the process that posts the next pointer
// move among those that the tap's own parent started, and prints {"frozen": <its id>} after
// that move's line, for the check to let it go on (SIGCONT); "thaw" takes that back if no
// such move has come. Needs Accessibility for the terminal app, as the click helper does.
// SIGTERM ends it, and so does the end of the process that started it; a process it
// suspended is then let go on.

import ApplicationServices
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let TYPES: [CGEventType: String] = [.mouseMoved: "move", .leftMouseDown: "down", .leftMouseDragged: "drag", .leftMouseUp: "up"]
let CHECK = getppid()

func printJSON(_ value: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)!)
}

// The parent of the process `pid`, or 0 if the system doesn't say.
func parent(of pid: pid_t) -> pid_t {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? pid_t(info.pbi_ppid) : 0
}

// Whether the next move of the check's children is to be frozen, and the process frozen.
var armed = false
var frozen: pid_t = 0

func report(_ type: CGEventType, _ event: CGEvent) {
    guard let name = TYPES[type] else { return }
    let poster = pid_t(event.getIntegerValueField(.eventSourceUnixProcessID))
    printJSON(["type": name, "x": event.location.x, "y": event.location.y,
               "dx": event.getIntegerValueField(.mouseEventDeltaX), "dy": event.getIntegerValueField(.mouseEventDeltaY),
               "pid": Int(poster), "at": Date().timeIntervalSince1970 * 1000])
    // Never 0, which the events of a real mouse carry. It would suspend this program's own
    // process group.
    if armed, type == .mouseMoved, poster > 0, parent(of: poster) == CHECK, kill(poster, SIGSTOP) == 0 {
        armed = false
        frozen = poster
        printJSON(["frozen": Int(poster)])
    }
}

// The system turns a tap off when it is slow to take its events, or on some user input; the
// tap is turned on again at once and says so, as events may have gone unseen meanwhile.
var port: CFMachPort?
func reenable() {
    if let port { CGEvent.tapEnable(tap: port, enable: true) }
    printJSON(["disabled": true, "at": Date().timeIntervalSince1970 * 1000])
}

let mask = TYPES.keys.reduce(CGEventMask(0)) { $0 | CGEventMask(1) << CGEventMask($1.rawValue) }
port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask,
                         callback: { _, type, event, _ in
                             if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { reenable() }
                             else { report(type, event) }
                             return Unmanaged.passUnretained(event)
                         }, userInfo: nil)
guard let tap = port else {
    FileHandle.standardError.write(Data("The event tap couldn't be made: is Accessibility allowed for the terminal app?\n".utf8))
    exit(1)
}
CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// The input's lines, handled on the main thread, where the tap's events are.
FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    // At the input's end the handler would be called again and again.
    if data.isEmpty { handle.readabilityHandler = nil }
    let lines = String(decoding: data, as: UTF8.self).split(separator: "\n")
    DispatchQueue.main.async {
        for line in lines {
            armed = line == "freeze"
            if line == "freeze" { frozen = 0 }
        }
    }
}

func finish() -> Never {
    if frozen > 0 { kill(frozen, SIGCONT) }
    exit(0)
}
signal(SIGTERM, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminate.setEventHandler { finish() }
terminate.resume()
// A check that was killed can't end its tap. launchd is then its parent, which is looked for here.
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in if getppid() == 1 { finish() } }
printJSON(["ready": true])
CFRunLoopRun()
