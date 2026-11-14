// Records a video of one of Live's windows, or of the main display, with ScreenCaptureKit
// (ADR-0016). macOS 15 or later (SCRecordingOutput).
//
//   video record <out.mov> window <id> | screen <seconds>
//
// record writes H.264 in a .mov, at most 30 frames a second, the pointer included. A window is
// recorded alone, behind other windows too; the display with everything on it. It prints
// "recording" once the file has started, and on stopping one JSON line: {"seconds", "bytes"}.
// It stops after <seconds>, on SIGINT, SIGTERM or SIGHUP, or when the process that started it
// ends, and finishes the file each time. A file it was writing when it was killed is whole up
// to then: SCRecordingOutput writes it as it goes (a recorder killed 5 s in left 5 s). While
// it records the display is kept on: a display that sleeps leaves the video on its last
// picture.
//
// Errors go to stderr, with exit status 1.

import AppKit
import AVFoundation
import IOKit.pwr_mgt
import ScreenCaptureKit

// How long a stopped recording may take to finish its file.
let FINISH_SECONDS = 10.0
// The process that started this one, taken first: the recording stops when it ends.
let PARENT = getppid()

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func printJSON(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value)
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}

final class Recorder: NSObject, SCStreamDelegate, SCStreamOutput, SCRecordingOutputDelegate {
    let file: URL
    let seconds: Double
    var stream: SCStream?
    var output: SCRecordingOutput?
    var stopping = false

    init(file: URL, seconds: Double) {
        self.file = file
        self.seconds = seconds
    }

    func start(filter: SCContentFilter, width: Int, height: Int) throws {
        let config = SCStreamConfiguration()
        config.width = width
        config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.showsCursor = true
        config.queueDepth = 6
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        // The frames go to the file through the recording output; this output, which drops
        // them, is the configuration the recording was measured with (ADR-0016).
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames"))
        let recording = SCRecordingOutputConfiguration()
        recording.outputURL = file
        recording.outputFileType = .mov
        recording.videoCodecType = .h264
        let output = SCRecordingOutput(configuration: recording, delegate: self)
        try stream.addRecordingOutput(output)
        self.stream = stream
        self.output = output
        stream.startCapture { error in
            if let error { fail("The recording couldn't start: \(error.localizedDescription)") }
        }
    }

    // Stops the stream; the recording output then finishes the file.
    func stop() {
        guard !stopping, let stream else { return }
        stream.stopCapture { _ in }
        awaitFinish()
    }

    func awaitFinish() {
        stopping = true
        DispatchQueue.main.asyncAfter(deadline: .now() + FINISH_SECONDS) {
            fail("The recording didn't finish its file within \(Int(FINISH_SECONDS)) s of stopping")
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {}

    // A window that closes ends the stream: the file is finished as on a stop.
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("The recording stopped: \(error.localizedDescription)\n".utf8))
        DispatchQueue.main.async { if !self.stopping { self.awaitFinish() } }
    }

    // The length counts from here, where the file starts. On the main queue, so "recording"
    // comes only once the signals that stop the recording are handled (record()).
    func recordingOutputDidStartRecording(_ output: SCRecordingOutput) {
        DispatchQueue.main.async {
            print("recording")
            fflush(stdout)
            DispatchQueue.main.asyncAfter(deadline: .now() + self.seconds) { self.stop() }
        }
    }

    func recordingOutput(_ output: SCRecordingOutput, didFailWithError error: Error) {
        fail("The recording failed: \(error.localizedDescription)")
    }

    // The length is read from the file: recordedDuration came in whole seconds.
    func recordingOutputDidFinishRecording(_ output: SCRecordingOutput) {
        let file = self.file
        Task {
            let bytes = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            guard let duration = try? await AVURLAsset(url: file).load(.duration) else {
                fail("The recording finished, but \(file.path) can't be read as a video")
            }
            printJSON(["seconds": duration.seconds, "bytes": bytes])
            exit(0)
        }
    }
}

var recorder: Recorder?
var keep: [AnyObject] = []

// Calls `stop` on the main queue when any of these signals comes, and when the process that
// started this one ends.
func stopOnSignalsAndParent(_ stop: @escaping () -> Void) {
    for signal in [SIGINT, SIGTERM, SIGHUP] {
        Darwin.signal(signal, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: signal, queue: .main)
        source.setEventHandler(handler: stop)
        source.resume()
        keep.append(source)
    }
    let source = DispatchSource.makeProcessSource(identifier: PARENT, eventMask: .exit, queue: .main)
    source.setEventHandler(handler: stop)
    source.resume()
    keep.append(source)
    // It may have ended before the source was made.
    if getppid() != PARENT { DispatchQueue.main.async(execute: stop) }
}

func record(_ file: URL, target: [String], seconds: Double) async {
    var assertion = IOPMAssertionID(0)
    IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                                IOPMAssertionLevel(kIOPMAssertionLevelOn), "Recording a video of Live" as CFString, &assertion)
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    } catch {
        fail("Recording the screen needs Screen Recording for the terminal app: \(error.localizedDescription)")
    }
    let filter: SCContentFilter
    if target[0] == "window" {
        guard let id = UInt32(target[1]), let window = content.windows.first(where: { $0.windowID == id })
        else { fail("No window \(target[1]) is on screen") }
        filter = SCContentFilter(desktopIndependentWindow: window)
    } else {
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
        else { fail("The main display isn't available to record") }
        filter = SCContentFilter(display: display, excludingWindows: [])
    }
    let scale = CGFloat(filter.pointPixelScale)
    let width = Int((filter.contentRect.width * scale).rounded())
    let height = Int((filter.contentRect.height * scale).rounded())
    await MainActor.run {
        let made = Recorder(file: file, seconds: seconds)
        recorder = made
        do {
            try made.start(filter: filter, width: width, height: height)
        } catch {
            fail("The recording couldn't start: \(error.localizedDescription)")
        }
        // After start, which made the stream that stop() stops.
        stopOnSignalsAndParent { made.stop() }
    }
}

let RECORD_USAGE = "usage: video record <out.mov> window <id> | screen <seconds>"
let arguments = CommandLine.arguments
// ScreenCaptureKit needs a connection to the window server, which this makes.
_ = NSApplication.shared

Task {
    switch arguments.count > 1 ? arguments[1] : "" {
    case "record":
        let target = Array(arguments.dropFirst(3).dropLast())
        guard arguments.count >= 5, let seconds = Double(arguments.last!), seconds > 0,
              target == ["screen"] || (target.count == 2 && target[0] == "window" && UInt32(target[1]) != nil)
        else { fail(RECORD_USAGE) }
        await record(URL(fileURLWithPath: arguments[2]), target: target, seconds: seconds)
    default:
        fail(RECORD_USAGE)
    }
}
dispatchMain()
