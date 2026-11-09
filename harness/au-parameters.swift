// Prints the global-scope parameters of one Audio Unit as JSON, for plugin.js:
//
//   au-parameters <type> <subtype> <manufacturer>     (each a four-character code's integer)
//
// {"parameters": [{"id", "name", "unit", "flags", "min", "max", "default", "items"}]} on one
// line that starts with "AU-PARAMETERS ", since a plug-in can print to stdout as it loads.
// The parameters are in the AU's kAudioUnitProperty_ParameterList order, the order Live
// fills slots in (ADR-0003); never sort them. min, max and default are ParameterInfo's raw
// values, read before the AU is initialized, so at its default stream format: a range
// that follows the sample rate (AUDelay's lowpass, up to 22050 Hz) is the one for 44.1 kHz.
// items are an indexed parameter's value strings (empty if it has none). Exits 1 with the
// reason on stderr if anything fails.

import AudioToolbox
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

func check(_ status: OSStatus, _ what: String) {
    if status != noErr { fail("\(what) failed (OSStatus \(status))") }
}

let args = CommandLine.arguments
guard args.count == 4, let type = UInt32(args[1]), let subtype = UInt32(args[2]), let maker = UInt32(args[3]) else {
    fail("usage: au-parameters <type> <subtype> <manufacturer> (four-character codes as integers)")
}
var description = AudioComponentDescription(componentType: type, componentSubType: subtype,
                                            componentManufacturer: maker, componentFlags: 0, componentFlagsMask: 0)
guard let component = AudioComponentFindNext(nil, &description) else { fail("didn't find the component") }
var instance: AudioUnit?
check(AudioComponentInstanceNew(component, &instance), "AudioComponentInstanceNew")
guard let unit = instance else { fail("AudioComponentInstanceNew returned no instance") }

let scope = kAudioUnitScope_Global
var size: UInt32 = 0
var writable: DarwinBoolean = false
var ids: [AudioUnitParameterID] = []
// An AU with no parameters may answer the size query with an error instead of 0.
if AudioUnitGetPropertyInfo(unit, kAudioUnitProperty_ParameterList, scope, 0, &size, &writable) == noErr, size > 0 {
    ids = [AudioUnitParameterID](repeating: 0, count: Int(size) / MemoryLayout<AudioUnitParameterID>.size)
    check(AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterList, scope, 0, &ids, &size), "ParameterList")
}

var parameters: [[String: Any]] = []
for id in ids {
    var info = AudioUnitParameterInfo()
    var infoSize = UInt32(MemoryLayout<AudioUnitParameterInfo>.size)
    check(AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterInfo, scope, id, &info, &infoSize), "ParameterInfo of \(id)")
    // The CFString holds the full name; the fixed-size C name can be cut short.
    var name: String
    if info.flags.contains(.flag_HasCFNameString), let cf = info.cfNameString {
        name = cf.takeUnretainedValue() as String
        if info.flags.contains(.flag_CFNameRelease) { cf.release() }
    } else {
        name = withUnsafeBytes(of: info.name) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }
    var items: [String] = []
    if info.unit == .indexed {
        var strings: Unmanaged<CFArray>?
        var stringsSize = UInt32(MemoryLayout<Unmanaged<CFArray>?>.size)
        if AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterValueStrings, scope, id, &strings, &stringsSize) == noErr,
           let array = strings?.takeRetainedValue() as? [String] {
            items = array
        }
    }
    for (label, value) in [("min", info.minValue), ("max", info.maxValue), ("default", info.defaultValue)] where !value.isFinite {
        fail("parameter \(id) (\(name)) has a \(label) that isn't a number: \(value)")
    }
    parameters.append(["id": id, "name": name, "unit": info.unit.rawValue, "flags": info.flags.rawValue,
                       "min": Double(info.minValue), "max": Double(info.maxValue), "default": Double(info.defaultValue),
                       "items": items])
}
check(AudioComponentInstanceDispose(unit), "AudioComponentInstanceDispose")

let json = try JSONSerialization.data(withJSONObject: ["parameters": parameters])
print("AU-PARAMETERS " + String(decoding: json, as: UTF8.self))
