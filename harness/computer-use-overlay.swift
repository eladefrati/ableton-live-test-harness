// Shows that harness-computer-use holds the mouse (ADR-0012): a breathing purple glow in from
// the edges of every screen and a pill naming the run, until the process <pid> exits, then a
// notification that the mouse is free again. The pill's Stop removes the file <click-token>,
// without which the run and its helper post nothing but the release of a button the helper
// holds, and takes the glow down. If the token is still there after that, Stop signals the
// run instead: the run stops clicking and goes on to its clean-up, and the glow stays up.
// Either way the pill stays, its button reading Stopping with a light going round it, until
// the run has ended. A run still going END_SECONDS after Stop is left running if its token
// is gone, and the overlay ends; one that was signalled is killed, and the overlay ends once
// it has gone (ADR-0015).
// The stop key, STOP_KEY, is Stop on the pill while this program runs (ADR-0017): a press
// is sent as the pill's button sends a click, through its action to its target. The key is
// claimed exclusively, so no app gets it meanwhile, and it is given up first as the program
// ends. The pill shows the key beside its Stop.
// The glow lets every click through; nothing here takes the front.
//
//   computer-use-overlay <pid> <click-token> [<run>]
//   computer-use-overlay --stop-key
//
// With --stop-key it prints the stop key as JSON and ends: {"code", "modifiers", "words",
// "symbols"}, its key code, its modifiers' names, and the key in words and in symbols, for
// the dialog shown before the border and for the check that presses it. It needs no window
// server.
//
// A <pid> of 0 or below is refused with the usage, as one that is no number is: Stop's last
// resort signals <pid> and kills it if it stays, and to kill, 0 is this program's own
// process group and -1 every process the user may signal.
//
// Prints "no stop key: <why>" first if it couldn't claim the stop key, as when another
// program holds it, which the pill then doesn't show; "shown" once the window server lists its windows, "stopping" once Stop is pressed
// and has removed the token or signalled the run, and, as it ends, the message it notifies.
// A Stop that removes the token before "shown" takes the glow down: "shown" then follows
// "stopping", once the pill is listed.
// If its windows can't show (no desktop session, no screen, or not listed within
// SHOWN_SECONDS), it says why on stderr and exits 1, so the run can warn that it clicks with
// no border.
//
// device-ui.swift's click guard skips the glow's windows, titled OVERLAY_TITLE, that this
// program owns. It doesn't skip the pill, which takes clicks.

import AppKit
import Carbon.HIToolbox

let OVERLAY_TITLE = "harness-computer-use overlay"
let PILL_TITLE = "harness-computer-use pill"
let PURPLE = NSColor(srgbRed: 0.62, green: 0.47, blue: 0.96, alpha: 1)
let LIGHT_PURPLE = NSColor(srgbRed: 0.78, green: 0.66, blue: 1, alpha: 1)
// The glow fades from the screen's edge over this many points, from this opacity at the edge.
let GLOW_WIDTH = 140.0
let GLOW_EDGE_ALPHA = 0.55
// The pill naming the run sits this far below the menu bar, at the top centre: over Live's
// transport and the set's name, which the harness drives over OSC and doesn't click. It ends
// 44 points below the menu bar, above the editor of a plug-in window Live opened 60 points
// from the screen's top, whose editor starts at 79.
let PILL_MARGIN = 6.0

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// A modifier a stop key may have: its mask for a hot key, and its name, word and symbol.
struct Modifier {
    let mask: Int, name: String, word: String, symbol: String
}
let CONTROL = Modifier(mask: controlKey, name: "control", word: "Control", symbol: "\u{2303}")
let OPTION = Modifier(mask: optionKey, name: "option", word: "Option", symbol: "\u{2325}")
let SHIFT = Modifier(mask: shiftKey, name: "shift", word: "Shift", symbol: "\u{21E7}")
let COMMAND = Modifier(mask: cmdKey, name: "command", word: "Command", symbol: "\u{2318}")
// The key that stops the run as Stop on the pill does (ADR-0017). A choice, not a constraint:
// changed here alone, it changes the pill's hint, the dialog's words and the key that
// checks/pointer-guards.js presses. Space is in one place on every keyboard layout, and
// nothing in Live's shortcut list uses these modifiers together. The modifiers go in the
// order macOS names them.
let STOP_KEY = (code: kVK_Space, name: "Space", modifiers: [CONTROL, OPTION, COMMAND])
let STOP_KEY_WORDS = (STOP_KEY.modifiers.map { $0.word } + [STOP_KEY.name]).joined(separator: "-")
let STOP_KEY_SYMBOLS = STOP_KEY.modifiers.map { $0.symbol }.joined() + STOP_KEY.name

let arguments = CommandLine.arguments
if arguments.count == 2 && arguments[1] == "--stop-key" {
    let key: [String: Any] = ["code": STOP_KEY.code, "modifiers": STOP_KEY.modifiers.map { $0.name }, "words": STOP_KEY_WORDS, "symbols": STOP_KEY_SYMBOLS]
    print(String(data: try! JSONSerialization.data(withJSONObject: key), encoding: .utf8)!)
    exit(0)
}
guard (3...4).contains(arguments.count), let pid = pid_t(arguments[1]), pid > 0 else { fail("usage: computer-use-overlay <pid> <click-token> [<run>] | --stop-key") }
let token = arguments[2]
let run = arguments.count == 4 ? arguments[3] : ""
let RUN_ENDED = "\(run.isEmpty ? "The run" : run) has ended: the mouse is yours again."
// The run may be gone, with its end of the pipes, when this writes to them.
signal(SIGPIPE, SIG_IGN)
// With no window server a program gets no session, no screens and windows that never show,
// and no error (live-notes.md).
if CGSessionCopyCurrentDictionary() == nil { fail("this process has no desktop session") }

// A soft glow inward from every edge: one-point rings whose opacity falls off with the distance
// from the edge, with no line where it starts or ends. Drawn once into the view's layer.
final class Glow: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        for inset in stride(from: 0.0, to: GLOW_WIDTH, by: 1.0) {
            let fade = pow(1 - inset / GLOW_WIDTH, 2.2)
            PURPLE.withAlphaComponent(GLOW_EDGE_ALPHA * fade).setStroke()
            let ring = bounds.insetBy(dx: inset + 0.5, dy: inset + 0.5)
            let path = NSBezierPath(roundedRect: ring, xRadius: 12 + inset * 0.6, yRadius: 12 + inset * 0.6)
            path.lineWidth = 1
            path.stroke()
        }
    }
}

// Opacity going from one value to another and back for ever, eased.
func breathe(_ layer: CALayer?, from: Double, to: Double, seconds: Double) {
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = from
    animation.toValue = to
    animation.duration = seconds
    animation.autoreverses = true
    animation.repeatCount = .infinity
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    layer?.add(animation, forKey: "breathe")
}

// Waits for the notification without running the run loop, as waitUntilExit would: the timer
// that watches the run would fire meanwhile and say a second time that the run has ended.
// @Sendable, which the compiler asks of a function that finish, isolated to the main actor,
// calls: it captures nothing.
@Sendable func notify(_ message: String) {
    let script = Process()
    script.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    script.arguments = ["-e", "on run argv", "-e",
                        "display notification (item 1 of argv) with title \"harness-computer-use\"",
                        "-e", "end run", message]
    let posted = DispatchSemaphore(value: 0)
    script.terminationHandler = { _ in posted.signal() }
    if (try? script.run()) != nil { posted.wait() }
}

// Ends the overlay with a notification saying why, printed first for a program that reads
// this one's output.
@MainActor func finish(_ message: String) -> Never {
    // The key first: the notification below may take a while, and the key would stay
    // swallowed with no pill to show it.
    if let stopKeyClaim { UnregisterEventHotKey(stopKeyClaim) }
    NSApp.windows.forEach { $0.orderOut(nil) }
    print(message)
    fflush(stdout)
    notify(message)
    exit(0)
}

// Whether the process `run` has ended: it is gone, or it has exited and its parent hasn't
// waited for it yet. Such a process stays in the process table and still answers signal 0,
// so its state is read too.
func ended(_ run: pid_t) -> Bool {
    if kill(run, 0) != 0 { return true }
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.size
    var name = [CTL_KERN, KERN_PROC, KERN_PROC_PID, run]
    guard sysctl(&name, UInt32(name.count), &info, &size, nil, 0) == 0, size > 0 else { return false }
    return info.kp_proc.p_stat == SZOMB
}

// How long a run has to end by itself after Stop, before the overlay leaves one whose token
// is gone and kills one that it signalled, and how long a killed run then has to end.
let END_SECONDS = 10.0
let KILLED_SECONDS = 1.0

// What the pill's button reads once Stop is pressed, and how long the light that then goes
// round the button takes for a round.
let STOPPING_TITLE = NSAttributedString(string: "Stopping", attributes: [
    .font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: NSColor.white.withAlphaComponent(0.7)])
let ROUND_SECONDS = 1.1

// The pill's button once Stop is pressed (ADR-0015): it reads Stopping, and a light goes
// round its edge until the overlay ends. The stop key's hint beside it goes: the key does
// nothing more. The light is drawn in a view of its own over the
// button, whose layer is AppKit's to draw in: a bright head and a fainter, longer tail, two
// dashes of the button's outline that start with their leading ends together.
@MainActor func showStopping(_ button: NSButton) {
    button.superview?.subviews.first { ($0 as? NSTextField)?.stringValue == STOP_KEY_SYMBOLS }?.isHidden = true
    button.image = nil
    button.attributedTitle = STOPPING_TITLE
    button.setAccessibilityLabel("Stopping")
    let ring = NSView(frame: button.frame)
    ring.layer = CALayer()
    ring.wantsLayer = true
    let edge = ring.bounds.insetBy(dx: 0.75, dy: 0.75)
    let length = 2 * (edge.width - edge.height) + .pi * edge.height
    for (share, alpha) in [(0.4, 0.35), (0.14, 1.0)] {
        let light = CAShapeLayer()
        light.path = CGPath(roundedRect: edge, cornerWidth: edge.height / 2, cornerHeight: edge.height / 2, transform: nil)
        light.fillColor = nil
        light.strokeColor = LIGHT_PURPLE.withAlphaComponent(alpha).cgColor
        light.lineWidth = 1.5
        light.lineCap = .round
        light.lineDashPattern = [NSNumber(value: share * length), NSNumber(value: (1 - share) * length)]
        let round = CABasicAnimation(keyPath: "lineDashPhase")
        round.fromValue = share * length
        round.toValue = share * length - length
        round.duration = ROUND_SECONDS
        round.repeatCount = .infinity
        light.add(round, forKey: "round")
        ring.layer?.addSublayer(light)
    }
    button.superview?.addSubview(ring)
}

// Stop's target, which also watches for the run's end. Its methods are called on the main
// thread: stop as AppKit calls every action, watch by timers.
final class Stopper: NSObject {
    let target: pid_t, token: String, name: String
    // Since Stop was pressed: when that was, whether the token went, and when the run was
    // killed, if it was.
    var pressed: Date?, removed = false, killed: Date?
    init(target: pid_t, token: String, name: String) { (self.target, self.token, self.name) = (target, token, name) }

    @objc func stop(_ button: NSButton) {
        // Pressed again: the run is stopping already.
        guard pressed == nil else { return }
        // The token first, before the pill shows anything: once it is gone the run's helper
        // posts nothing but a release. It is gone if this removed it, or if it or its folder
        // had gone already. Whether the run can read it doesn't count: with a folder that
        // can't be written to the run reads as stopped, but what made it so may pass, and
        // the token would let the run click again.
        removed = unlink(token) == 0 || errno == ENOENT
        MainActor.assumeIsolated {
            // A run that has ended has nothing left to stop, whatever became of its token: it
            // removes the token's folder a moment before this program notices it has gone.
            if ended(target) { finish(RUN_ENDED) }
            // Stop's last resort (ADR-0012), for a token that is still there: the run is sent
            // SIGUSR2, on which it counts itself stopped, stops its helpers and goes on to
            // its clean-up.
            if !removed { kill(target, SIGUSR2) }
            pressed = Date()
            print("stopping")
            fflush(stdout)
            // The glow says that the run may take the pointer, which a run whose token is
            // gone can't. A run that was signalled can, until it has ended. It goes without
            // the closing animation of a window, which kept it on screen 0.3 s longer.
            if removed {
                for glow in NSApp.windows where glow.title == OVERLAY_TITLE {
                    glow.animationBehavior = .none
                    glow.orderOut(nil)
                }
            }
            showStopping(button)
            // The run's end is looked for more often from now on: the pill goes with it.
            Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in MainActor.assumeIsolated { stopper.watch() } }
        }
    }

    // Ends the overlay once the run has ended, saying what became of it; until then, after
    // Stop, the pill stays (ADR-0015). Nothing here waits: a timer calls it again. A run
    // still going END_SECONDS after Stop, whose token is gone, can't click: the overlay ends
    // and leaves it running, saying so. In Stop's last resort such a run can click, and is
    // killed: its helpers stop because their run has gone, and the overlay ends once it has,
    // KILLED_SECONDS later at the latest.
    @MainActor func watch() {
        let stopped = "Stopped: \(name.isEmpty ? "the run" : name) won't click again"
        let wasEnded = "\(name.isEmpty ? "The run" : name) was ended: its click token couldn't be removed. The mouse is yours."
        if ended(target) {
            guard pressed != nil else { finish(RUN_ENDED) }
            finish(killed == nil ? "\(stopped). The mouse is yours." : wasEnded)
        }
        guard let pressed else { return }
        if let killed {
            if Date() > killed.addingTimeInterval(KILLED_SECONDS) { finish(wasEnded) }
        } else if Date() > pressed.addingTimeInterval(END_SECONDS) {
            // A guard, which can't fall through: a run whose token is gone is never killed.
            guard !removed else { finish("\(stopped), and is still running. The mouse is yours.") }
            kill(target, SIGKILL)
            killed = Date()
        }
    }
}
let stopper = Stopper(target: pid, token: token, name: run)

// The claim on the stop key while this program holds it, given up first in finish.
var stopKeyClaim: EventHotKeyRef?

// Claims the stop key for `button`, the pill's Stop, as a system hot key, which needs no
// permission (ADR-0017). The claim is exclusive: it fails if another program holds the key,
// and while this program holds it, the key goes to no other. A press is sent as the button
// sends a click, through its action to its target; once Stop is pressed, that does nothing
// more. Returns why it couldn't claim the key, or nil once it has.
func claimStopKey(pressing button: NSButton) -> String? {
    let mask = STOP_KEY.modifiers.reduce(0) { $0 | $1.mask }
    // The signature is any four letters naming the claim to Carbon: "hcus", for
    // harness-computer-use's stop key.
    let claimed = RegisterEventHotKey(UInt32(STOP_KEY.code), UInt32(mask), EventHotKeyID(signature: 0x68637573, id: 1),
                                      GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &stopKeyClaim)
    if Int(claimed) == eventHotKeyExistsErr { return "another program holds \(STOP_KEY_WORDS)" }
    guard claimed == noErr else { return "RegisterEventHotKey returned \(claimed)" }
    // The button is the handler's: the pill holds it for as long as this program runs.
    var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let handled = InstallEventHandler(GetApplicationEventTarget(), { _, _, button in
        MainActor.assumeIsolated {
            let button = Unmanaged<NSButton>.fromOpaque(button!).takeUnretainedValue()
            if let action = button.action { NSApp.sendAction(action, to: button.target, from: button) }
        }
        return noErr
    }, 1, &pressed, Unmanaged.passUnretained(button).toOpaque(), nil)
    guard handled == noErr else {
        if let stopKeyClaim { UnregisterEventHotKey(stopKeyClaim) }
        stopKeyClaim = nil
        return "InstallEventHandler returned \(handled)"
    }
    return nil
}

// A panel that takes a click without taking the front from the app in front.
final class PillPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// A dark frosted pill: a pulsing dot, harness-computer-use and the run, and Stop, with the
// stop key before it, dim, if `showsKey`. Returns the pill and its Stop.
func pill(on screen: NSScreen, showsKey: Bool) -> (panel: NSPanel, stop: NSButton) {
    let text = NSTextField(labelWithAttributedString: {
        let line = NSMutableAttributedString(string: "harness-computer-use", attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.white])
        if !run.isEmpty {
            line.append(NSAttributedString(string: "  \(run)", attributes: [
                .font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.white.withAlphaComponent(0.6)]))
        }
        return line
    }())
    text.sizeToFit()
    // Drawn by hand, white on a faint capsule: AppKit greys a control in a window that never
    // becomes key, as this one doesn't.
    let stop = NSButton(title: "", target: stopper, action: #selector(Stopper.stop(_:)))
    stop.isBordered = false
    stop.image = NSImage(systemSymbolName: "stop.fill", accessibilityDescription: nil)?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 9, weight: .bold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.white])))
    stop.attributedTitle = NSAttributedString(string: " Stop", attributes: [
        .font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: NSColor.white])
    stop.imagePosition = .imageLeading
    stop.imageHugsTitle = true
    stop.setAccessibilityLabel("Stop")
    stop.sizeToFit()
    // Wide enough for what it reads once pressed too (showStopping), so that the pill keeps
    // its size then.
    let stopping = NSButton(title: "", target: nil, action: nil)
    stopping.isBordered = false
    stopping.attributedTitle = STOPPING_TITLE
    stopping.sizeToFit()
    stop.frame.size = NSSize(width: max(stop.frame.width, stopping.frame.width) + 20, height: 24)
    stop.wantsLayer = true
    stop.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.14).cgColor
    stop.layer?.cornerRadius = 12
    let hint = showsKey ? NSTextField(labelWithAttributedString: NSAttributedString(string: STOP_KEY_SYMBOLS, attributes: [
        .font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.white.withAlphaComponent(0.45)])) : nil
    hint?.sizeToFit()
    let (height, pad, dot, gap, hintGap) = (38.0, 16.0, 8.0, 10.0, 8.0)
    let hintWidth = hint.map { $0.frame.width + hintGap } ?? 0
    let width = pad + dot + gap + text.frame.width + 14 + hintWidth + stop.frame.width + 7
    let panel = PillPanel(contentRect: NSRect(x: screen.frame.minX + (screen.frame.width - width) / 2,
                                              y: screen.visibleFrame.maxY - PILL_MARGIN - height, width: width, height: height),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.title = PILL_TITLE
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    panel.hidesOnDeactivate = false
    let view = NSView(frame: NSRect(origin: .zero, size: panel.frame.size))
    // The frosted background is a sibling under the dot and the text, not their parent: the
    // frosted view tints what it holds, which turned the dot grey.
    let frost = NSVisualEffectView(frame: view.bounds)
    frost.material = .hudWindow
    frost.blendingMode = .behindWindow
    frost.state = .active
    frost.appearance = NSAppearance(named: .darkAqua)
    frost.wantsLayer = true
    frost.layer?.cornerRadius = height / 2
    frost.layer?.masksToBounds = true
    frost.layer?.borderWidth = 1
    frost.layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor
    view.addSubview(frost)
    let light = NSView(frame: NSRect(x: pad, y: (height - dot) / 2, width: dot, height: dot))
    light.wantsLayer = true
    light.layer?.backgroundColor = LIGHT_PURPLE.cgColor
    light.layer?.cornerRadius = dot / 2
    light.layer?.shadowColor = LIGHT_PURPLE.cgColor
    light.layer?.shadowOpacity = 1
    light.layer?.shadowRadius = 4
    light.layer?.shadowOffset = .zero
    breathe(light.layer, from: 1, to: 0.45, seconds: 0.9)
    view.addSubview(light)
    text.setFrameOrigin(NSPoint(x: pad + dot + gap, y: (height - text.frame.height) / 2))
    view.addSubview(text)
    stop.setFrameOrigin(NSPoint(x: width - 7 - stop.frame.width, y: (height - stop.frame.height) / 2))
    view.addSubview(stop)
    if let hint {
        hint.setFrameOrigin(NSPoint(x: stop.frame.minX - hintGap - hint.frame.width, y: (height - hint.frame.height) / 2))
        view.addSubview(hint)
    }
    panel.contentView = view
    return (panel, stop)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
if NSScreen.screens.isEmpty { fail("there is no screen to show on") }

// One glow window per screen, above everything but the cursor, on every Space; the pill above
// the glow on the main screen.
var windows: [NSWindow] = []
for screen in NSScreen.screens {
    let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.title = OVERLAY_TITLE
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .screenSaver
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    let glow = Glow(frame: NSRect(origin: .zero, size: screen.frame.size))
    glow.wantsLayer = true
    breathe(glow.layer, from: 1, to: 0.55, seconds: 2.2)
    window.contentView = glow
    windows.append(window)
    if screen == NSScreen.main {
        // The stop key once the pill's Stop exists, before the windows show; a pill that
        // can't have it is made again, without its hint.
        var made = pill(on: screen, showsKey: true)
        if let refused = claimStopKey(pressing: made.stop) {
            print("no stop key: \(refused)")
            fflush(stdout)
            made = pill(on: screen, showsKey: false)
        }
        windows.append(made.panel)
    }
}
windows.forEach { $0.orderFrontRegardless() }

// Says "shown" once the window server lists every window that is to be up: all of them, but
// for the glow once a Stop that came before this has removed the token and so taken it
// down. The window server is asked, not the windows: NSWindow.isVisible is true even with
// no window server, and false for a window that anything has taken off the screen.
let SHOWN_SECONDS = 2.0
let started = Date()
Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { timer in
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    let listed = Set(list.compactMap { $0[kCGWindowNumber as String] as? Int })
    if MainActor.assumeIsolated({ windows.filter { !(stopper.removed && $0.title == OVERLAY_TITLE) }.allSatisfy { listed.contains($0.windowNumber) } }) {
        timer.invalidate()
        print("shown")
        fflush(stdout)
    } else if Date().timeIntervalSince(started) > SHOWN_SECONDS {
        fail("its windows weren't on screen after \(Int(SHOWN_SECONDS)) s")
    }
}

// Looks every quarter of a second whether the run that holds the mouse has ended.
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in MainActor.assumeIsolated { stopper.watch() } }
app.run()
