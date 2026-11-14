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

const USAGE = "usage: cli.js video <file.mov> [--seconds <n>] [--window <id> | --screen] [-- <command...>]";
const FRAME_USAGE = "usage: cli.js video-frame <file.mov> <seconds> <file.png>";

const machine = {
  startedMs: STARTED_MS,
  release: () => os.release(),
  wake: () => mac.wakeDisplay(),
  mainWindow: () => liveMainWindow(),
  windows: () => liveWindows(),
  binary: () => tools.helperBinary(HELPER_SOURCE),
  spawn,
};

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
  if (!options.file || path.extname(options.file) !== ".mov") refuse();
  if (options.screen && options.window !== undefined) refuse();
  if (dash !== -1 && command.length === 0) refuse();
  return options;
}

// Starts recording to `file` (a .mov; its folder is made, a file there replaced) and resolves
// once the helper says it records, with { file, pid, stop(), done() }: `pid` is the helper's,
// stop() ends the recording now, done() waits for it to end by itself, and both resolve with
// { file, seconds, bytes }, the video's length and size, or reject with the helper's reason.
async function recordVideo(file, { window, screen = false, seconds = MAX_SECONDS } = {}, system = machine) {
  const darwin = Number(system.release().split(".")[0]);
  if (!(darwin >= FIRST_DARWIN)) throw new VideoError(`Recording a video needs macOS 15 or later; this Mac runs Darwin ${system.release()}`);
  if (screen && window !== undefined) throw new VideoError("Record a window or the screen, not both");
  if (path.extname(file) !== ".mov") throw new VideoError(`A video is saved as a .mov, not ${path.basename(file)}`);
  if (!(seconds > 0)) throw new VideoError(`A recording lasts more than 0 s, not ${seconds}`);
  let target;
  if (screen) {
    await system.wake();
    target = ["screen"];
  } else if (window === undefined) {
    target = ["window", String((await system.mainWindow()).id)];
  } else {
    if (!(await system.windows()).some((w) => w.id === window)) throw new VideoError(`Live has no window ${window} on screen`);
    target = ["window", String(window)];
  }
  const binary = await system.binary();
  file = path.resolve(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  const child = system.spawn(binary, ["record", file, ...target, String(seconds)], { stdio: ["ignore", "pipe", "pipe"] });
  let [said, complained] = ["", ""];
  child.stdout.on("data", (data) => { said += data; });
  child.stderr.on("data", (data) => { complained += data; });
  const reason = () => complained.trim().split("\n").pop();

  // Settles when the helper has ended: with its last line, the file's length and size.
  const ended = new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new VideoError(`The video helper couldn't run: ${error.message}`)));
    child.on("close", (code, signal) => {
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

// `cli.js video`: records until `command` ends, if one is given (its exit status is returned
// as `status`), or until the length given, Ctrl-C or SIGTERM.
async function runVideoCommand({ file, seconds, window, screen, command = [] }, system = machine) {
  const video = await recordVideo(file, { seconds, window, screen }, system);
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
  // Ctrl-C or SIGTERM goes on to the command, and the recording stops once it has ended.
  let child;
  const pass = (signal) => child?.kill(signal);
  process.on("SIGINT", pass);
  process.on("SIGTERM", pass);
  try {
    const status = await new Promise((resolve) => {
      child = spawn(command[0], command.slice(1), { stdio: "inherit" });
      child.on("error", (error) => {
        console.error(`${command[0]} couldn't run: ${error.message}`);
        resolve(127);
      });
      child.on("close", (code, signal) => resolve(code ?? 128 + os.constants.signals[signal]));
    });
    return { ...(await video.stop()), status };
  } finally {
    process.off("SIGINT", pass);
    process.off("SIGTERM", pass);
  }
}

// The arguments of `cli.js video-frame`, after the command's name.
function parseFrameArgs(argv) {
  const [file, at, png] = [argv[0], Number(argv[1]), argv[2]];
  if (argv.length !== 3 || path.extname(file) !== ".mov" || !(at >= 0) || path.extname(png) !== ".png") throw new VideoError(FRAME_USAGE);
  return { file, at, png };
}

// Saves the frame `file` shows at `at` seconds as the PNG `png` (its folder is made), and
// resolves with { file: png, at, w, h }: the time of that frame, and its size in pixels. For
// an agent to see what a video shows, as it can't watch one.
async function videoFrame(file, at, png, system = machine) {
  if (!fs.existsSync(file)) throw new VideoError(`No video at ${file}`);
  const binary = await system.binary();
  png = path.resolve(png);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  const args = ["frame", path.resolve(file), String(at), png];
  const said = await tools.run(binary, args).catch((error) => {
    // The helper's reason, without the command line run() puts before it.
    throw new VideoError(error.message.replace(`${[binary, ...args].join(" ")} failed: `, ""), { cause: error });
  });
  return { file: png, ...JSON.parse(said) };
}

module.exports = { VideoError, parseVideoArgs, recordVideo, runVideoCommand, parseFrameArgs, videoFrame, MAX_SECONDS };
