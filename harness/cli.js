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
//   node harness/cli.js capture <png> [--window <id>]
//                                         a picture of Live's main window, or of the window
//                                         with that id, taken with Live behind other windows;
//                                         needs no OSC either
//   node harness/cli.js plugin-window <track> <device> <png>
//                                         opens the plug-in's own window if it isn't open and
//                                         saves a picture of its editor (ADR-0008); brings Live
//                                         to the front while it captures
//
// Arguments: "12" is an int, "12.0" a float, true/false booleans, anything else a string.

const { connect } = require("./live.js");
const { float } = require("./osc.js");
const { maxMessages } = require("./log.js");
const { captureWindow, liveWindows, openPluginWindow } = require("./device-ui.js");

function parseArg(text) {
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return float(Number(text));
  return text;
}

const USAGE = "usage: cli.js ping | reload | query <address> [args] | send <address> [args] | "
  + "notes <track> <clip> [--arrangement] | song-notes <track> | max-log [since] | windows | capture <png> [--window <id>] | "
  + "plugin-window <track> <device> <png>";

async function run(argv) {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  if (command === "max-log") {
    const since = args[0] === undefined ? undefined : /^\d+$/.test(args[0]) ? Number(args[0]) : new Date(args[0]);
    if (since !== undefined && Number.isNaN(new Date(since).getTime())) throw new Error(`Not a time: ${args[0]}`);
    return maxMessages({ since });
  }
  if (command === "windows") return liveWindows();
  if (command === "capture") {
    // --window's id is the argument after the file
    const id = flags.has("--window") ? Number(args[1]) : undefined;
    if (!args[0] || (flags.has("--window") && !Number.isInteger(id))) throw new Error(USAGE);
    return { file: args[0], window: await captureWindow(args[0], { window: id }) };
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
        if (!Number.isInteger(track) || !Number.isInteger(device) || !args[2]) throw new Error(USAGE);
        const window = await openPluginWindow(live, { track, device });
        await window.capture(args[2]);
        return { file: args[2], window: window.title };
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
