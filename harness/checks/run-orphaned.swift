// Runs a command whose parent has ended before it begins, for pointer-guards.js: as the click
// helper runs when its run died before the helper got going, with process 1 for a parent from
// its first instruction.
//
//   run-orphaned <command> [<argument>...]
//
// It starts the command suspended and a second copy of itself to watch it (--watch <pid>),
// and ends. The watcher lets the command go on once process 1 is its parent and, when the
// command has ended, prints {"status": <its exit status, or "signal <number>" if a signal
// ended it>}. Only a process's parent can wait for it, so the watcher has the status from
// the kernel's event queue. The command's output and the watcher's line go to this
// program's stdout and stderr.

import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// Starts `command` and returns its process id; suspended, it runs nothing until SIGCONT.
func start(_ command: [String], suspended: Bool) -> pid_t? {
    var attributes: posix_spawnattr_t?
    posix_spawnattr_init(&attributes)
    if suspended { posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_START_SUSPENDED)) }
    var pid: pid_t = 0
    let words = command.map { strdup($0) } + [nil]
    return posix_spawn(&pid, command[0], nil, &attributes, words, environ) == 0 ? pid : nil
}

// The parent of the process `pid`, or 0 if the system doesn't say.
func parent(of pid: pid_t) -> pid_t {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? pid_t(info.pbi_ppid) : 0
}

// Ends the suspended command, which would stay so, and this program.
func abandon(_ command: pid_t, _ message: String) -> Never {
    kill(command, SIGKILL)
    fail(message)
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.count == 2, arguments[0] == "--watch", let command = pid_t(arguments[1]), command > 0 {
    let queue = kqueue()
    var ended = kevent(ident: UInt(command), filter: Int16(EVFILT_PROC), flags: UInt16(EV_ADD),
                      fflags: UInt32(NOTE_EXIT) | UInt32(NOTE_EXITSTATUS), data: 0, udata: nil)
    guard kevent(queue, &ended, 1, nil, 0, nil) == 0 else { abandon(command, "Cannot watch the process \(command)") }
    while parent(of: command) != 1 {
        if kill(command, 0) != 0 { fail("The process \(command) ended before it was let go") }
        usleep(1000)
    }
    kill(command, SIGCONT)
    guard kevent(queue, nil, 0, &ended, 1, nil) == 1 else { fail("The process \(command) ended unseen") }
    // The status as wait reports it: the signal in the low 7 bits, or else the exit status
    // in the next 8.
    let (signal, status) = (ended.data & 0x7f, (ended.data >> 8) & 0xff)
    print(signal == 0 ? "{\"status\": \(status)}" : "{\"status\": \"signal \(signal)\"}")
} else {
    guard !arguments.isEmpty, arguments[0] != "--watch" else { fail("usage: run-orphaned <command> [<argument>...]") }
    guard let command = start(arguments, suspended: true) else { fail("Cannot start \(arguments[0])") }
    guard start([CommandLine.arguments[0], "--watch", String(command)], suspended: false) != nil
    else { abandon(command, "Cannot start the watcher of \(arguments[0])") }
}
