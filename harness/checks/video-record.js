#!/usr/bin/env node
"use strict";

// Checks video.js and its helper in Live (ADR-0016): with Live playing, so its window
// changes, it records Live's main window and the main display for a length of time, a video
// around a command, one that cli.js video stops on SIGTERM, and one whose run is killed, and
// saves frames of each. Every video must be playable, as long as asked within a tolerance,
// and have a frame at each time checked; the frames are left to look at with --out. Leaves
// the transport stopped.
//
//   node harness/checks/video-record.js [--out <folder>]
//
// Without --out the videos and frames go to a temp folder, deleted at the end. Takes about
// 40 s.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { connect } = require("../live.js");
const mac = require("../macos.js");
const { liveMainWindow } = require("../device-ui.js");
const { recordVideo, runVideoCommand, videoFrame } = require("../video.js");

const CLI = path.join(__dirname, "..", "cli.js");
const VIDEO = path.join(__dirname, "..", "video.js");
// A recording stops within this of when it was asked to (the helper says it started 0.3 to
// 0.5 s after it ran, and the length counts from there).
const TOLERANCE_S = 0.6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const near = (actual, expected) => Math.abs(actual - expected) <= TOLERANCE_S;

// Waits up to `ms` for `fn` to resolve, trying again every 250 ms; rejects with its last error.
async function retry(fn, ms) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() > until) throw error;
      await sleep(250);
    }
  }
}

// Saves the frames at `times` and says what they are.
async function frames(file, times) {
  const saved = [];
  for (const at of times) {
    const frame = await videoFrame(file, at, file.replace(/\.mov$/, `-${at}s.png`));
    saved.push(`${path.basename(frame.file)} ${frame.w}x${frame.h}`);
  }
  return saved.join(", ");
}

// Runs Node with `args`, its output collected; resolves, once it has said `line` (at once
// without one), with the process and `ended`, which resolves with its exit and output.
function node(args, line) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let [out, err] = ["", ""];
  const ended = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, out, err })));
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      out += data;
      if (line && out.includes(line)) resolve({ child, ended });
    });
    child.stderr.on("data", (data) => { err += data; });
    if (!line) resolve({ child, ended });
    ended.then(({ code, signal }) => reject(new Error(`It ended before it said "${line}" (${signal ?? `status ${code}`}): ${err.trim()}`)));
  });
}

const CASES = [
  {
    name: "Live's main window, for 4 s",
    async run(folder) {
      const window = await liveMainWindow();
      const file = path.join(folder, "window.mov");
      const result = await (await recordVideo(file, { seconds: 4 })).done();
      if (!near(result.seconds, 4)) throw new Error(`The video is ${result.seconds} s long`);
      const frame = await videoFrame(file, 1, path.join(folder, "window-1s.png"));
      // Its picture is the window's, at the display's scale.
      if (Math.abs(frame.w / frame.h - window.w / window.h) > 0.01 || frame.w % window.w !== 0) {
        throw new Error(`A frame is ${frame.w}x${frame.h} pixels, the window ${window.w}x${window.h} points`);
      }
      return `${result.seconds.toFixed(2)} s, ${result.bytes} bytes; ${await frames(file, [1, 3])}`;
    },
  },
  {
    name: "the main display, for 4 s",
    async run(folder) {
      const file = path.join(folder, "screen.mov");
      const result = await (await recordVideo(file, { screen: true, seconds: 4 })).done();
      if (!near(result.seconds, 4)) throw new Error(`The video is ${result.seconds} s long`);
      return `${result.seconds.toFixed(2)} s, ${result.bytes} bytes; ${await frames(file, [1, 3])}`;
    },
  },
  {
    name: "around a command that runs 3 s and exits 3",
    async run(folder) {
      const file = path.join(folder, "command.mov");
      const result = await runVideoCommand({ file, command: [process.execPath, "-e", "setTimeout(() => process.exit(3), 3000)"] });
      if (result.status !== 3) throw new Error(`The command's status came back as ${result.status}`);
      // The recording starts before the command and stops after it.
      if (result.seconds < 3 || result.seconds > 3 + 2 * TOLERANCE_S) throw new Error(`The video is ${result.seconds} s long`);
      return `${result.seconds.toFixed(2)} s; ${await frames(file, [1, 2.5])}`;
    },
  },
  {
    name: "cli.js video stopped by SIGTERM after 3 s",
    async run(folder) {
      const file = path.join(folder, "sigterm.mov");
      const { child, ended } = await node([CLI, "video", file]);
      // The file appears when the helper starts writing it.
      await retry(async () => { if (!fs.existsSync(file)) throw new Error(`No ${file} after 10 s`); }, 10000);
      await sleep(3000);
      child.kill("SIGTERM");
      const { code, signal, out, err } = await ended;
      if (code !== 0) throw new Error(`cli.js ended with ${signal ?? `status ${code}`}: ${err.trim()}`);
      const result = JSON.parse(out.trim().split("\n").pop());
      if (!near(result.seconds, 3)) throw new Error(`The video is ${result.seconds} s long`);
      return `${result.seconds.toFixed(2)} s; ${await frames(file, [1, 2.5])}`;
    },
  },
  {
    name: "a run killed 3 s into its recording",
    async run(folder) {
      const file = path.join(folder, "killed.mov");
      const { child, ended } = await node(["-e", `require(${JSON.stringify(VIDEO)}).recordVideo(${JSON.stringify(file)})
        .then((video) => { console.log("recording " + video.pid); setInterval(() => {}, 1000); })`], "recording ");
      await sleep(3000);
      child.kill("SIGKILL");
      const helper = Number((await ended).out.match(/recording (\d+)/)[1]);
      // The helper finishes the file once it sees the run gone, and ends; one that doesn't is
      // stopped here, so it doesn't record on for 10 minutes.
      await retry(async () => {
        try {
          process.kill(helper, 0);
        } catch {
          return;
        }
        throw new Error(`The helper (process ${helper}) was still recording 15 s after its run was killed`);
      }, 15000).catch((error) => {
        process.kill(helper, "SIGINT");
        throw error;
      });
      return frames(file, [1, 2.5]);
    },
  },
];

async function main() {
  const out = process.argv.indexOf("--out");
  const keep = out !== -1;
  if (keep && !process.argv[out + 1]) throw new Error("usage: video-record.js [--out <folder>]");
  const folder = keep ? path.resolve(process.argv[out + 1]) : mac.tempFolder("video-record-");
  fs.mkdirSync(folder, { recursive: true });
  const live = await connect({ timeout: 5000 });
  let failed = 0;
  try {
    live.send("/live/song/start_playing");
    await live.sync();
    for (const c of CASES) {
      const started = Date.now();
      try {
        const said = await c.run(folder);
        console.log(`PASS ${c.name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${said}`);
      } catch (error) {
        failed++;
        console.log(`FAIL ${c.name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${error.message}`);
      }
    }
  } finally {
    try {
      live.send("/live/song/stop_playing");
      await live.sync();
    } finally {
      live.close();
      if (keep) console.log(`videos and frames in ${folder}`);
      else fs.rmSync(folder, { recursive: true, force: true });
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
