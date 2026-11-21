#!/usr/bin/env node
"use strict";

// Command line access to Live through the fork. Output is JSON on stdout.
//
//   node harness/cli.js ping
//   node harness/cli.js reload
//   node harness/cli.js query /live/song/get/tempo
//   node harness/cli.js send /live/song/set/tempo 120.0
//   node harness/cli.js notes <track> <clip> [--arrangement]
//   node harness/cli.js song-notes <track>
//   node harness/cli.js max-log [since]   Max console messages from Live's Log.txt since a
//                                         time (ms, or a date such as 2026-10-31T11:18), or
//                                         since Live started; needs no OSC, so it runs
//                                         beside a check
//   node harness/cli.js windows           Live's windows on screen, front to back, with their
//                                         layer; a dialog, a panel or a plug-in's window (layer
//                                         3, shown only with Live in front) is one of them;
//                                         needs no OSC either
//   node harness/cli.js capture [<png>] [--window <id>]
//                                         a picture of Live's main window, or of the window
//                                         with that id, taken with Live behind other windows;
//                                         needs no OSC either
//   node harness/cli.js plugin-window <track> <device> [<png>]
//                                         opens the plug-in's own window if it isn't open and
//                                         saves a picture of its editor (ADR-0008), printing the
//                                         editor's size in points; brings Live to the front
//                                         while it captures
//   node harness/cli.js video [<file.mov>] [--seconds <n>] [--window <id> | --screen] [-- <command...>]
//                                         a video of Live's main window, of the window with that
//                                         id, or of the main display (ADR-0016), until the
//                                         command ends, the length given, Ctrl-C or SIGTERM (10
//                                         minutes at most if no length is given); prints its
//                                         length and size, and exits with the command's status;
//                                         needs no OSC either
//   node harness/cli.js video-frame <file.mov> <seconds> [<png>]
//                                         saves the frame the video shows at that time, to see
//                                         what it shows; prints the frame's time and size, and
//                                         the video's length
//   node harness/cli.js midi-port [--seconds <n>]
//                                         opens the harness's MIDI input port (midi.js) and
//                                         holds it open until Ctrl-C or the length given, so
//                                         Remote (and Track) can be turned on for it in Live's
//                                         Settings > Link, Tempo & MIDI; needs no OSC either
//
// A capture given no file goes to the captures folder (captures.js), under the time; each
// command prints the file's path.
//
// Arguments: "12" is an int, "12.0" a float, true/false booleans, anything else a string.

const { connect } = require("./live.js");
const { float } = require("./osc.js");
const { maxMessages } = require("./log.js");
const { captureWindow, liveWindows, openPluginWindow } = require("./device-ui.js");
const { saveCapture } = require("./captures.js");
const { parseVideoArgs, runVideoCommand, parseFrameArgs, videoFrame } = require("./video.js");
const { openMidiPort } = require("./midi.js");

function parseArg(text) {
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return float(Number(text));
  return text;
}

const USAGE = "usage: cli.js ping | reload | query <address> [args] | send <address> [args] | "
  + "notes <track> <clip> [--arrangement] | song-notes <track> | max-log [since] | windows | capture [<png>] [--window <id>] | "
  + "plugin-window <track> <device> [<png>] | video [<file.mov>] [--seconds <n>] [--window <id> | --screen] [-- <command...>] | "
  + "video-frame <file.mov> <seconds> [<png>] | midi-port [--seconds <n>]";

async function run(argv) {
  const [command, ...rest] = argv;
  if (command === "video") {
    const result = await runVideoCommand(parseVideoArgs(rest));
    if (result.status) process.exitCode = result.status;
    return result;
  }
  if (command === "midi-port") {
    const at = rest.indexOf("--seconds");
    const seconds = at === -1 ? Infinity : Number(rest[at + 1]);
    if (rest.length !== (at === -1 ? 0 : 2) || !(seconds > 0)) throw new Error(USAGE);
    const port = await openMidiPort();
    console.error(`MIDI port ${port.name} is open${seconds === Infinity ? " until Ctrl-C" : ` for ${seconds} s`}`);
    let timer;
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
      if (seconds !== Infinity) timer = setTimeout(resolve, seconds * 1000);
    });
    // A pending timer would keep the run alive after a signal.
    clearTimeout(timer);
    await port.close();
    return { port: port.name, closed: true };
  }
  if (command === "video-frame") {
    const { file, at, png } = parseFrameArgs(rest);
    return videoFrame(file, at, png);
  }
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  if (command === "max-log") {
    const since = args[0] === undefined ? undefined : /^\d+$/.test(args[0]) ? Number(args[0]) : new Date(args[0]);
    if (since !== undefined && Number.isNaN(new Date(since).getTime())) throw new Error(`Not a time: ${args[0]}`);
    return maxMessages({ since });
  }
  if (command === "windows") return liveWindows();
  if (command === "capture") {
    const at = rest.indexOf("--window");
    const id = at === -1 ? undefined : Number(rest[at + 1]);
    const files = rest.filter((a, i) => !a.startsWith("--") && (at === -1 || i !== at + 1));
    if (files.length > 1 || (at !== -1 && !Number.isInteger(id))) throw new Error(USAGE);
    const saved = await saveCapture(files[0], { name: id === undefined ? "live-window" : `live-window-${id}`, ext: ".png" },
      (to) => captureWindow(to, { window: id }));
    return { file: saved.file, window: saved.value };
  }
  const live = await connect();
  try {
    switch (command) {
      case "ping": return await live.query("/live/test");
      case "reload": await live.reload(); return "ok";
      case "query": return await live.query(args[0], ...args.slice(1).map(parseArg));
      case "send":
        live.send(args[0], ...args.slice(1).map(parseArg));
        await live.sync();
        return "ok";
      case "notes":
        return await live.notes(Number(args[0]), Number(args[1]), { arrangement: flags.has("--arrangement") });
      case "song-notes": return await live.songNotes(Number(args[0]));
      case "plugin-window": {
        const [track, device] = args.slice(0, 2).map(Number);
        if (!Number.isInteger(track) || !Number.isInteger(device) || args.length > 3) throw new Error(USAGE);
        const window = await openPluginWindow(live, { track, device });
        const saved = await saveCapture(args[2], { name: "plugin-window", ext: ".png" }, (to) => window.capture(to));
        return { file: saved.file, window: window.title, editor: saved.value };
      }
      default: throw new Error(USAGE);
    }
  } finally {
    live.close();
  }
}

run(process.argv.slice(2)).then(
  (result) => console.log(JSON.stringify(result)),
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
