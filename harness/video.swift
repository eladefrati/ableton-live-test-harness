// Records a video of one of Live's windows, or of the main display, with ScreenCaptureKit, and
// saves a frame of a video as a PNG (ADR-0016). macOS 15 or later (SCRecordingOutput).
//
//   video record <out.mov> window <id> | screen <seconds> [then <finished.mov>]
//   video frame <in.mov> <seconds> <out.png>
//
// record writes H.264 in a .mov, renamed to <finished.mov> once it is finished if that is given
// (the captures folder writes in a hidden folder until then), at most 30 frames a second, the pointer included. A window is
// recorded alone, behind other windows too; the display with everything on it. It prints
// "recording" once the file has started, and on stopping one JSON line: {"seconds", "bytes"},
// with "early", the reason, when the stream ended before it was stopped (its window closed).
// It stops after <seconds>, on SIGINT, SIGTERM or SIGHUP, when the process that started it
// ends, or when nothing reads the run's output any more (fd 3, below), and finishes the file
// each time. A file it was writing when it was killed is whole up
// to then: SCRecordingOutput writes it as it goes (a recorder killed 5 s in left 5 s). While
// it records the display is kept on: a display that sleeps leaves the video on its last
// picture.
//
// frame saves the frame shown at <seconds> and prints {"at", "w", "h", "seconds"}: the time of
// that frame, its size in pixels, and the video's length.
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

// fputs, not FileHandle: with SIGPIPE ignored, FileHandle's write raises an exception, which
// aborts this, when nothing reads stderr any more.
func complain(_ message: String) {
    fputs(message + "\n", stderr)
}

func fail(_ message: String) -> Never {
    complain(message)
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
    // What the file is renamed to once it is finished, if anything.
    let finished: URL?
    var stream: SCStream?
    var output: SCRecordingOutput?
    var stopping = false
    // Why the stream ended before it was stopped, if it did: set on ScreenCaptureKit's queue
    // and read on another, so under a lock.
    private let lock = NSLock()
    private var endedEarly: String?
    var early: String? {
        get { lock.withLock { endedEarly } }
        set { lock.withLock { endedEarly = newValue } }
    }

    init(file: URL, seconds: Double, finished: URL?) {
        self.file = file
        self.seconds = seconds
        self.finished = finished
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

    // A window that closes ends the stream: the file is finished as on a stop, and the result
    // says why it ended early.
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        complain("The recording stopped: \(error.localizedDescription)")
        // Here, before anything that finishes the file, which reads it.
        early = error.localizedDescription
        DispatchQueue.main.async {
            if !self.stopping { self.awaitFinish() }
        }
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
        let finished = self.finished
        Task {
            let bytes = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            guard let duration = try? await AVURLAsset(url: file).load(.duration) else {
                fail("The recording finished, but \(file.path) can't be read as a video")
            }
            if let finished {
                do {
                    try FileManager.default.moveItem(at: file, to: finished)
                } catch {
                    fail("The recording finished, but \(file.path) couldn't be renamed \(finished.path): \(error.localizedDescription)")
                }
            }
            var result: [String: Any] = ["seconds": duration.seconds, "bytes": bytes]
            // Read once the file has been read, the latest it can be.
            if let early = self.early { result["early"] = early }
            printJSON(result)
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
    stopWhenRunOutputCloses(stop)
}

// fd 3, when given, is the run's own stderr. Over ssh it is a pipe or socket to sshd, and an ssh
// session that ends (Ctrl-C on remote.sh) closes its other end and sends no signal: the run
// goes on, so its recording stops here. A terminal or a file is left alone.
func stopWhenRunOutputCloses(_ stop: @escaping () -> Void) {
    var info = stat()
    guard fstat(3, &info) == 0, (info.st_mode & S_IFMT) == S_IFIFO || (info.st_mode & S_IFMT) == S_IFSOCK else { return }
    let queue = kqueue()
    // Edge-triggered: it reports once that it can be written, then only on a change, such as
    // its reader going (EV_EOF).
    var watch = kevent(ident: 3, filter: Int16(EVFILT_WRITE), flags: UInt16(EV_ADD | EV_CLEAR), fflags: 0, data: 0, udata: nil)
    guard queue >= 0, kevent(queue, &watch, 1, nil, 0, nil) == 0 else { return }
    Thread.detachNewThread {
        var event = kevent()
        while kevent(queue, nil, 0, &event, 1, nil) >= 0 {
            if event.flags & UInt16(EV_EOF) != 0 {
                DispatchQueue.main.async(execute: stop)
                return
            }
        }
    }
}

func record(_ file: URL, target: [String], seconds: Double, then finished: URL?) async {
    // Process 1 from the start: the run ended before this got going, and nothing would stop
    // the recording before its length.
    if PARENT == 1 { fail("The run that started the recording had already ended") }
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
        let made = Recorder(file: file, seconds: seconds, finished: finished)
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

func frame(_ video: URL, at seconds: Double, to png: URL) async {
    let asset = AVURLAsset(url: video)
    let duration: CMTime
    do {
        duration = try await asset.load(.duration)
    } catch {
        fail("Can't read \(video.path) as a video: \(error.localizedDescription)")
    }
    guard seconds <= duration.seconds else {
        fail(String(format: "%@ is %.2f s long, so it has no frame at %g s", video.path, duration.seconds, seconds))
    }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    do {
        let (image, actual) = try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else { fail("Couldn't encode the frame at \(seconds) s as a PNG") }
        try data.write(to: png)
        printJSON(["at": actual.seconds, "w": image.width, "h": image.height, "seconds": duration.seconds])
        exit(0)
    } catch {
        fail("Couldn't save the frame at \(seconds) s: \(error.localizedDescription)")
    }
}

let USAGE = "usage: video record <out.mov> window <id> | screen <seconds> [then <finished.mov>]\n       video frame <in.mov> <seconds> <out.png>"
let arguments = CommandLine.arguments
// ScreenCaptureKit needs a connection to the window server, which this makes.
_ = NSApplication.shared
// The run may be gone, with its end of the pipes: a write to them must not end this before
// the file is finished.
signal(SIGPIPE, SIG_IGN)

Task {
    switch arguments.count > 1 ? arguments[1] : "" {
    case "record":
        // <out.mov>, the target, <seconds>, and then <finished.mov> if given.
        var words = Array(arguments.dropFirst(2))
        var finished: URL?
        if words.count >= 2, words[words.count - 2] == "then" {
            finished = URL(fileURLWithPath: words[words.count - 1])
            words.removeLast(2)
        }
        let target = Array(words.dropFirst().dropLast())
        guard words.count >= 3, let seconds = Double(words.last!), seconds > 0,
              target == ["screen"] || (target.count == 2 && target[0] == "window" && UInt32(target[1]) != nil)
        else { fail(USAGE) }
        await record(URL(fileURLWithPath: words[0]), target: target, seconds: seconds, then: finished)
    case "frame":
        guard arguments.count == 5, let seconds = Double(arguments[3]), seconds >= 0 else { fail(USAGE) }
        await frame(URL(fileURLWithPath: arguments[2]), at: seconds, to: URL(fileURLWithPath: arguments[4]))
    default:
        fail(USAGE)
    }
}
dispatchMain()
