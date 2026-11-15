"use strict";

// Records a video of Live (ADR-0016): its main window by default, another of its windows by
// id, or the whole main display, for proof of something that changes over time. A fixed
// state needs a still (`captureWindow` in device-ui.js).
//
//   const video = await recordVideo("/path/to/video.mov");   // resolves once it records
//   ...                                                    // what the video should show
//   await video.stop();                                    // { file, seconds, bytes }
//
//   const video = await recordVideo(file, { seconds: 5 });   // or { window: id }, { screen: true }
//   await video.done();                                    // when the 5 s are up
//
//   await videoFrame(file, 2.5, "/path/to/frame.png");     // what the video shows at 2.5 s
//
// The recording stops after `seconds` (10 minutes if not given), on stop(), or when this
// process ends, however it ends: the helper then finishes the file. A run that doesn't wait
// for the recording can exit while it goes on.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const mac = require("./macos.js");
const tools = require("./tools.js");
const captures = require("./captures.js");
const { liveMainWindow, liveWindows } = require("./device-ui.js");

class VideoError extends Error {}

const HELPER_SOURCE = path.join(__dirname, "video.swift");
// Longest recording when no length is given.
const MAX_SECONDS = 600;
// The helper said "recording" 0.3 to 0.5 s after it started, measured; a first build takes
// longer, but comes before this wait.
const STARTED_MS = 15000;
// macOS 15 is Darwin 24: SCRecordingOutput, which writes the file, came with it.
const FIRST_DARWIN = 24;

const USAGE = "usage: cli.js video [<file.mov>] [--seconds <n>] [--window <id> | --screen] [-- <command...>]";
const FRAME_USAGE = "usage: cli.js video-frame <file.mov> <seconds> [<file.png>]";

const machine = {
  startedMs: STARTED_MS,
  captures: captures.CAPTURES,
  release: () => os.release(),
  wake: () => mac.wakeDisplay(),
  mainWindow: () => liveMainWindow(),
  windows: () => liveWindows(),
  binary: () => tools.helperBinary(HELPER_SOURCE),
  frontmost: () => mac.frontmostApp(),
  spawn,
  say: (text) => console.error(text),
};

// Refuses a Mac before macOS 15, where the helper doesn't build.
function requireMacOS15(system) {
  const darwin = Number(system.release().split(".")[0]);
  if (!(darwin >= FIRST_DARWIN)) throw new VideoError(`Recording a video or reading its frames needs macOS 15 or later; this Mac runs Darwin ${system.release()}`);
}

// The arguments of `cli.js video`, after the command's name.
function parseVideoArgs(argv) {
  const dash = argv.indexOf("--");
  const own = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? [] : argv.slice(dash + 1);
  const options = { file: undefined, seconds: undefined, window: undefined, screen: false, command };
  const refuse = () => { throw new VideoError(USAGE); };
  for (let i = 0; i < own.length; i++) {
    const word = own[i];
    if (word === "--screen") options.screen = true;
    else if (word === "--seconds") {
      options.seconds = Number(own[++i]);
      if (!(options.seconds > 0)) refuse();
    } else if (word === "--window") {
      options.window = Number(own[++i]);
      if (!Number.isInteger(options.window)) refuse();
    } else if (word.startsWith("--") || options.file !== undefined) refuse();
    else options.file = word;
  }
  if (options.file !== undefined && path.extname(options.file) !== ".mov") refuse();
  if (options.screen && options.window !== undefined) refuse();
  if (dash !== -1 && command.length === 0) refuse();
  return options;
}

// Starts recording to `file` (a .mov; its folder is made, a file there replaced), or with no
// `file` to a new one in the captures folder (captures.js), and resolves
// once the helper says it records, with { file, pid, stop(), done() }: `pid` is the helper's,
// stop() ends the recording now, done() waits for it to end by itself, and both resolve with
// { file, seconds, bytes }, the video's length and size, with `early`, the reason, when it
// ended before it was stopped (its window closed), or reject with the helper's reason.
async function recordVideo(file, { window, screen = false, seconds = MAX_SECONDS } = {}, system = machine) {
  requireMacOS15(system);
  if (screen && window !== undefined) throw new VideoError("Record a window or the screen, not both");
  if (file !== undefined && path.extname(file) !== ".mov") throw new VideoError(`A video is saved as a .mov, not ${path.basename(file)}`);
  if (!(seconds > 0)) throw new VideoError(`A recording lasts more than 0 s, not ${seconds}`);
  // Built first: a first build can take most of a minute, long enough for the display to
  // sleep again, and a recording started with it asleep makes no file.
  const binary = await system.binary();
  // Waking waits for System Events to name the frontmost app, and gives up the same way whether
  // the display stayed asleep or System Events refused the terminal app: asked again, it says
  // which.
  await system.wake().catch(async (error) => {
    const refused = await system.frontmost().then(() => null, (e) => (/-1743|Not authorized to send Apple events/.test(e.message) ? e : null));
    if (refused) {
      throw new VideoError(`The display couldn't be woken for the recording: System Events refused the terminal app (${refused.message}). `
        + "Allow it under System Settings > Privacy & Security > Automation", { cause: error });
    }
    throw new VideoError(`The display couldn't be woken for the recording: ${error.message}`, { cause: error });
  });
  let target;
  if (screen) {
    target = ["screen"];
  } else if (window === undefined) {
    target = ["window", String((await system.mainWindow()).id)];
  } else {
    if (!(await system.windows()).some((w) => w.id === window)) throw new VideoError(`Live has no window ${window} on screen`);
    target = ["window", String(window)];
  }
  // One given no file prunes the captures folder once it has ended (captures.js).
  const named = file === undefined;
  file = named ? captures.capturePath(screen ? "live-screen" : "live-window", ".mov", { root: system.captures }) : path.resolve(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  // In the captures folder it is written under a hidden name, which the helper renames to `file`
  // once it is finished, however the recording ends (captures.js).
  const hide = path.dirname(file) === path.resolve(system.captures);
  const writing = hide ? captures.unfinished(file) : file;
  // A process group of its own: Ctrl-C in a terminal signals the run's whole group, and the
  // recording must end when the run says, after a command it wraps has ended. The run's stderr
  // goes as fd 3, which the helper watches: over ssh, a session that ends closes it.
  const child = system.spawn(binary, ["record", writing, ...target, String(seconds), ...(hide ? ["then", file] : [])],
    { stdio: ["ignore", "pipe", "pipe", 2], detached: true });
  let [said, complained] = ["", ""];
  child.stdout.on("data", (data) => { said += data; });
  child.stderr.on("data", (data) => { complained += data; });
  const reason = () => complained.trim().split("\n").pop();

  // Settles when the helper has ended: with its last line, the file's length and size.
  const ended = new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new VideoError(`The video helper couldn't run: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (named) captures.pruneCaptures(system.captures);
      const last = said.trim().split("\n").pop();
      if (code === 0 && last.startsWith("{")) resolve({ file, ...JSON.parse(last) });
      else reject(new VideoError(reason() || `The video helper ended with ${signal ?? `status ${code}`}`));
    });
  });
  // Nothing may be waiting for it yet.
  ended.catch(() => {});

  let timer;
  try {
    await Promise.race([
      new Promise((resolve) => child.stdout.on("data", () => { if (/^recording$/m.test(said)) resolve(); })),
      ended.then(() => { throw new VideoError("The video helper ended before it recorded"); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new VideoError(`The video helper didn't start recording within ${system.startedMs} ms`));
        }, system.startedMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }

  // The run may exit while the helper records; the helper then finishes the file itself. A
  // caller that waits for the recording holds the run until it ends.
  const handles = [child, child.stdout, child.stderr];
  handles.forEach((h) => h.unref());
  const wait = () => {
    handles.forEach((h) => h.ref());
    return ended;
  };
  return {
    file,
    pid: child.pid,
    stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
      return wait();
    },
    done: wait,
  };
}

// `cli.js video`: says "recording <file>" on stderr once it records, then records until
// `command` ends, if one is given (its exit status is returned as `status`), or until the
// length given, Ctrl-C or SIGTERM. The command runs in a process
// group of its own, with no input: each Ctrl-C, SIGTERM, SIGHUP or SIGQUIT the run gets reaches
// that whole group once, from here, as a terminal's would, and the recording goes on until the
// command has ended. However the run ends, short of SIGKILL, the command's group is sent
// SIGTERM as it does. A recording that fails as it stops is reported as `error`, with the
// command's status still returned.
async function runVideoCommand({ file, seconds, window, screen, command = [] }, system = machine) {
  const video = await recordVideo(file, { seconds, window, screen }, system);
  // Until this line, what happens isn't in the video.
  system.say(`recording ${video.file}`);
  if (command.length === 0) {
    const stop = () => video.stop().catch(() => {});
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      return await video.done();
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
  let child;
  // The command leads its group: a shell or a runner it starts has processes of its own.
  const pass = (signal) => {
    try {
      if (child?.pid) process.kill(-child.pid, signal);
    } catch {}
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
  signals.forEach((signal) => process.on(signal, pass));
  const end = () => pass("SIGTERM");
  process.on("exit", end);
  try {
    const status = await new Promise((resolve) => {
      child = spawn(command[0], command.slice(1), { stdio: ["ignore", "inherit", "inherit"], detached: true });
      child.on("error", (error) => {
        console.error(`${command[0]} couldn't run: ${error.message}`);
        resolve(127);
      });
      child.on("close", (code, signal) => resolve(code ?? 128 + os.constants.signals[signal]));
    });
    // The command's status is the run's result: a recording that fails as it stops (its
    // window closed, say) doesn't replace it.
    try {
      return { ...(await video.stop()), status };
    } catch (error) {
      system.say(error.message);
      return { file: video.file, status, error: error.message };
    }
  } finally {
    signals.forEach((signal) => process.off(signal, pass));
    process.off("exit", end);
    // What the command left running in its group.
    end();
  }
}

// The arguments of `cli.js video-frame`, after the command's name.
function parseFrameArgs(argv) {
  const [file, at, png] = [argv[0], Number(argv[1]), argv[2]];
  if (![2, 3].includes(argv.length) || path.extname(file) !== ".mov" || argv[1] === "" || !(at >= 0)
    || (png !== undefined && path.extname(png) !== ".png")) throw new VideoError(FRAME_USAGE);
  return { file, at, png };
}

// Saves the frame `file` shows at `at` seconds as the PNG `png` (its folder is made), or with no
// `png` in the captures folder, named by the time, the video's name and `at` (captures.js), and
// resolves with { file: png, at, w, h, seconds }: the time of that frame, its size in pixels,
// and the video's length. For an agent to see what a video shows, as it can't watch one.
async function videoFrame(file, at, png, system = machine) {
  requireMacOS15(system);
  if (!fs.existsSync(file)) throw new VideoError(`No video at ${file}`);
  const binary = await system.binary();
  const save = async (to) => {
    const args = ["frame", path.resolve(file), String(at), to];
    const said = await tools.run(binary, args).catch((error) => {
      // The helper's reason, without the command line run() puts before it.
      throw new VideoError(error.message.replace(`${[binary, ...args].join(" ")} failed: `, ""), { cause: error });
    });
    return JSON.parse(said);
  };
  if (png === undefined) {
    let frame;
    const saved = await captures.saveCapture(`${path.basename(file, ".mov")}-${at}s`, ".png", async (to) => { frame = await save(to); },
      { root: system.captures });
    return { file: saved, ...frame };
  }
  png = path.resolve(png);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  return { file: png, ...(await save(png)) };
}

module.exports = { VideoError, parseVideoArgs, recordVideo, runVideoCommand, parseFrameArgs, videoFrame, MAX_SECONDS };
