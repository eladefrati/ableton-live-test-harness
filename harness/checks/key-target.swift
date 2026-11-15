// A window that reports the keys it receives, for pointer-guards.js: the app in front, as
// Live is during a run, to show which keys harness-computer-use's overlay leaves to it.
//
//   key-target
//
// Shows its window, takes the front and prints {"front": <whether it is the frontmost app
// with its window key>}, then one line per key that goes down in it: {"key": <key code>,
// "at": <when, in ms>}. SIGTERM ends it, and so does the end of the process that started it.

import AppKit

setvbuf(stdout, nil, _IOLBF, 0)

func printJSON(_ value: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)!)
}

let app = NSApplication.shared
// A regular app, which can take the front and get keys, where pointer-target's panel can't.
app.setActivationPolicy(.regular)
let screen = NSScreen.screens[0].frame
let window = NSWindow(contentRect: NSRect(x: screen.minX + 400, y: screen.maxY - 500, width: 400, height: 300),
                      styleMask: [.titled], backing: .buffered, defer: false)
window.title = "key-target"
window.makeKeyAndOrderFront(nil)
NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
    printJSON(["key": Int(event.keyCode), "at": Date().timeIntervalSince1970 * 1000])
    return nil
}
// Activated once the run loop runs; asked half a second later whether it is in front.
DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
    app.activate(ignoringOtherApps: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        printJSON(["front": NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid() && window.isKeyWindow])
    }
}

signal(SIGTERM, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminate.setEventHandler { exit(0) }
terminate.resume()
// A check that was killed can't end its target: launchd is then the parent.
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in if getppid() == 1 { exit(0) } }
app.run()
