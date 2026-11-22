// A MIDI source of the harness's own, which Live sees as a MIDI input port while this runs
// (ADR-0018). A check sends it messages, and Live takes them as from a controller.
//
//   midi <name>
//
// It makes a virtual source named <name>, with a fixed unique ID so that Live finds the same
// port each time, prints "ready", and then reads lines on stdin, each a whole MIDI message as
// decimal bytes, at most 3 ("176 1 64" is CC 1 at 64 on channel 1). It sends each line's
// message at once and answers "ok", or "error <reason>" for a line it can't send. It ends,
// and the port goes, when stdin closes, as when the process that started it ends.
//
// Errors that stop it go to stderr, with exit status 1.

import CoreMIDI
import Foundation

// The source's kMIDIPropertyUniqueID. Apps that keep a port's settings may keep them by this
// ID; a virtual source gets a new random one each time unless it is set.
let UNIQUE_ID: MIDIUniqueID = 0x4C48_4D49

func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

func say(_ line: String) {
    print(line)
    fflush(stdout)
}

let args = CommandLine.arguments
if args.count != 2 || args[1].isEmpty { fail("usage: midi <name>") }
let name = args[1]

var client = MIDIClientRef()
var status = MIDIClientCreateWithBlock(name as CFString, &client) { _ in }
if status != noErr { fail("Couldn't make a MIDI client (OSStatus \(status))") }
var source = MIDIEndpointRef()
status = MIDISourceCreate(client, name as CFString, &source)
if status != noErr { fail("Couldn't make the MIDI source \(name) (OSStatus \(status))") }
// Another source may hold the ID already; the port then works with the ID it was given.
MIDIObjectSetIntegerProperty(source, kMIDIPropertyUniqueID, UNIQUE_ID)

// The message's bytes, or nil with the reason: a status byte first, then up to two data
// bytes, each a whole number from 0 to 255 (no SysEx).
func message(_ line: String) -> ([UInt8]?, String) {
    let words = line.split(separator: " ")
    let bytes = words.compactMap { UInt8($0) }
    if bytes.count != words.count || bytes.isEmpty { return (nil, "not bytes: \(line)") }
    if bytes.count > 3 { return (nil, "more than 3 bytes: \(line)") }
    if bytes[0] < 0x80 { return (nil, "no status byte first: \(line)") }
    if bytes.dropFirst().contains(where: { $0 >= 0x80 }) { return (nil, "a data byte above 127: \(line)") }
    return (bytes, "")
}

func send(_ bytes: [UInt8]) -> OSStatus {
    var list = MIDIPacketList()
    let packet = MIDIPacketListInit(&list)
    // One message, at most 3 bytes (no SysEx), fits the list's own packet.
    _ = MIDIPacketListAdd(&list, MemoryLayout<MIDIPacketList>.size, packet, 0, bytes.count, bytes)
    return MIDIReceived(source, &list)
}

say("ready")
while let line = readLine() {
    let text = line.trimmingCharacters(in: .whitespaces)
    if text.isEmpty { continue }
    let (bytes, reason) = message(text)
    guard let bytes = bytes else {
        say("error \(reason)")
        continue
    }
    let sent = send(bytes)
    say(sent == noErr ? "ok" : "error MIDIReceived failed (OSStatus \(sent))")
}
MIDIEndpointDispose(source)
MIDIClientDispose(client)
