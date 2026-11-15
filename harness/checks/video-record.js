#!/usr/bin/env node
"use strict";

// Checks video.js and its helper in Live (ADR-0016): with Live playing, so its window
// changes, it records Live's main window and the main display for a length of time, a video
// around a command, one around a command given Ctrl-C, one that cli.js video stops on
// SIGTERM, one whose run's stderr closes, as an ssh session's does, one of a window that closes (a panel of its own, pointer-target.swift), and one
// whose run is killed, and saves frames of each; and the captures cli.js makes given no file,
// which it deletes. Every video must be playable, as long as
// asked within a tolerance, and have a frame at each time checked, and two frames of one that
// moved must differ; the frames are left to look at with --out. Leaves the transport stopped.
//
//   node harness/checks/video-record.js [--out <folder>]
//
// Without --out the videos and frames go to a temp folder, deleted at the end. Takes about
// 55 s.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { connect } = require("../live.js");
const mac = require("../macos.js");
const { liveMainWindow } = require("../device-ui.js");
const { recordVideo, runVideoCommand, videoFrame } = require("../video.js");
const { CAPTURES } = require("../captures.js");
const tools = require("../tools.js");

const CLI = path.join(__dirname, "..", "cli.js");
const HELPER = path.join(__dirname, "..", "video.swift");
const TARGET = path.join(__dirname, "pointer-target.swift");
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

// Saves the frames at `times` and says what they are. Live plays while the check records, and
// its position changes many times a second, so each frame differs from the one before: two
// the same are a video that froze between them, as one does while the display sleeps.
// `still` is for a video of something that doesn't move.
async function frames(file, times, { still = false } = {}) {
  const saved = [];
  let before;
  for (const at of times) {
    const frame = await videoFrame(file, at, file.replace(/\.mov$/, `-${at}s.png`));
    const hash = crypto.createHash("sha256").update(fs.readFileSync(frame.file)).digest("hex");
    if (!still && before && hash === before.hash) throw new Error(`The frames at ${before.at} and ${at} s are the same: the video froze`);
    before = { at, hash };
    saved.push(`${path.basename(frame.file)} ${frame.w}x${frame.h}`);
  }
  return saved.join(", ");
}

// Runs Node with `args`, its output collected; resolves, once it has said `line` on stdout or
// stderr (at once without one), with the process and `ended`, which resolves with its exit
// and output. `detached` gives it a process group of its own, as a terminal's job has.
function node(args, line, { detached = false } = {}) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], detached });
  let [out, err] = ["", ""];
  const ended = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, out, err })));
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      out += data;
      if (line && out.includes(line)) resolve({ child, ended });
    });
    child.stderr.on("data", (data) => {
      err += data;
      if (line && err.includes(line)) resolve({ child, ended });
    });
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
      fs.rmSync(file, { force: true });
      const result = await (await recordVideo(file, { seconds: 4 })).done();
      if (!near(result.seconds, 4)) throw new Error(`The video is ${result.seconds} s long`);
      const frame = await videoFrame(file, 1, path.join(folder, "window-1s.png"));
      // Its picture is the window's, at the display's scale.
      if (Math.abs(frame.w / frame.h - window.w / window.h) > 0.01 || frame.w % window.w !== 0) {
        throw new Error(`A frame is ${frame.w}x${frame.h} pixels, the window ${window.w}x${window.h} points`);
      }
      return `${result.seconds.toFixed(2)} s, ${result.bytes} bytes; ${await frames(file, [1, 2, 3])}`;
    },
  },
  {
    name: "the main display, for 4 s",
    async run(folder) {
      const file = path.join(folder, "screen.mov");
      fs.rmSync(file, { force: true });
      const result = await (await recordVideo(file, { screen: true, seconds: 4 })).done();
      if (!near(result.seconds, 4)) throw new Error(`The video is ${result.seconds} s long`);
      return `${result.seconds.toFixed(2)} s, ${result.bytes} bytes; ${await frames(file, [1, 2, 3])}`;
    },
  },
  {
    name: "around a command that runs 3 s and exits 3",
    async run(folder) {
      const file = path.join(folder, "command.mov");
      fs.rmSync(file, { force: true });
      const result = await runVideoCommand({ file, command: [process.execPath, "-e", "setTimeout(() => process.exit(3), 3000)"] });
      if (result.status !== 3) throw new Error(`The command's status came back as ${result.status}`);
      // The recording starts before the command and stops after it.
      if (result.seconds < 3 || result.seconds > 3 + 2 * TOLERANCE_S) throw new Error(`The video is ${result.seconds} s long`);
      return `${result.seconds.toFixed(2)} s; ${await frames(file, [1, 2.5])}`;
    },
  },
  {
    name: "Ctrl-C 2 s into a recording around a command that takes 1 s to clean up and exits 5",
    async run(folder) {
      const file = path.join(folder, "ctrl-c.mov");
      const counted = path.join(folder, "ctrl-c-signals.json");
      fs.rmSync(file, { force: true });
      fs.rmSync(counted, { force: true });
      const command = `let n = 0; process.on("SIGINT", () => { if (n++ === 0) setTimeout(() => {
        require("node:fs").writeFileSync(${JSON.stringify(counted)}, JSON.stringify(n)); process.exit(5); }, 1000); });
        setInterval(() => {}, 1000);`;
      // A group of its own, as a terminal's foreground job: Ctrl-C signals the whole group.
      const { child, ended } = await node([CLI, "video", file, "--", process.execPath, "-e", command], "recording ", { detached: true });
      let out;
      try {
        await sleep(2000);
        process.kill(-child.pid, "SIGINT");
        const run = await ended;
        out = run.out;
        if (run.code !== 5) throw new Error(`cli.js ended with ${run.signal ?? `status ${run.code}`}, not the command's 5: ${run.err.trim()}`);
      } finally {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
      const signals = JSON.parse(fs.readFileSync(counted, "utf8"));
      if (signals !== 1) throw new Error(`The command got ${signals} SIGINTs`);
      const result = JSON.parse(out.trim().split("\n").pop());
      // 2 s before Ctrl-C and 1 s of the command's clean-up, which the video must include.
      if (result.seconds < 3 - TOLERANCE_S) throw new Error(`The video is ${result.seconds} s long: it ended before the command`);
      return `${result.seconds.toFixed(2)} s, the command got 1 SIGINT; ${await frames(file, [1, 2.5])}`;
    },
  },
  {
    name: "cli.js video stopped by SIGTERM after 3 s",
    async run(folder) {
      const file = path.join(folder, "sigterm.mov");
      fs.rmSync(file, { force: true });
      const { child, ended } = await node([CLI, "video", file], "recording ");
      let run;
      try {
        await sleep(3000);
        child.kill("SIGTERM");
        run = await ended;
      } finally {
        // cli.js and its recording, if anything above failed before they ended.
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
      }
      const { code, signal, out, err } = run;
      if (code !== 0) throw new Error(`cli.js ended with ${signal ?? `status ${code}`}: ${err.trim()}`);
      const result = JSON.parse(out.trim().split("\n").pop());
      if (!near(result.seconds, 3)) throw new Error(`The video is ${result.seconds} s long`);
      return `${result.seconds.toFixed(2)} s; ${await frames(file, [1, 2.5])}`;
    },
  },
  {
    name: "cli.js video whose run's stderr closes 2 s in, as an ssh session's does when it ends",
    async run(folder) {
      const file = path.join(folder, "closed-stderr.mov");
      fs.rmSync(file, { force: true });
      const { child, ended } = await node([CLI, "video", file, "--seconds", "30"], "recording ");
      try {
        await sleep(2000);
        child.stderr.destroy();
        const { code, out } = await Promise.race([ended, sleep(10000).then(() => {
          throw new Error("The recording went on 10 s after its run's stderr closed");
        })]);
        if (code !== 0) throw new Error(`cli.js ended with status ${code}`);
        const result = JSON.parse(out.trim().split("\n").pop());
        if (!near(result.seconds, 2)) throw new Error(`The video is ${result.seconds} s long`);
        return `${result.seconds.toFixed(2)} s; ${await frames(file, [1, 1.5])}`;
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
      }
    },
  },
  {
    name: "cli.js video, capture and video-frame with no file, for 2 s",
    async run() {
      // Into the captures folder, under the time, each saying where; deleted here once checked.
      const made = [];
      try {
        const { ended } = await node([CLI, "video", "--seconds", "2"], "recording ");
        const { code, out, err } = await ended;
        if (code !== 0) throw new Error(`cli.js video ended with status ${code}: ${err.trim()}`);
        const video = JSON.parse(out.trim().split("\n").pop()).file;
        made.push(video);
        const still = await node([CLI, "capture"]).then(({ ended }) => ended);
        if (still.code !== 0) throw new Error(`cli.js capture ended with status ${still.code}: ${still.err.trim()}`);
        made.push(JSON.parse(still.out).file);
        const frame = await node([CLI, "video-frame", video, "1"]).then(({ ended }) => ended);
        if (frame.code !== 0) throw new Error(`cli.js video-frame ended with status ${frame.code}: ${frame.err.trim()}`);
        made.push(JSON.parse(frame.out).file);
        const elsewhere = made.filter((file) => path.dirname(file) !== CAPTURES || !fs.existsSync(file));
        if (elsewhere.length) throw new Error(`Not in ${CAPTURES}: ${elsewhere.join(", ")}`);
        if (!err.includes(`recording ${video}`)) throw new Error(`cli.js video didn't say where it records: ${err.trim()}`);
        return made.map((file) => path.basename(file)).join(", ");
      } finally {
        made.forEach((file) => fs.rmSync(file, { force: true }));
      }
    },
  },
  {
    name: "a window that closes 2 s into its recording",
    async run(folder) {
      // A window of the check's own, which it can close: the helper records any window by id.
      const file = path.join(folder, "closed.mov");
      fs.rmSync(file, { force: true });
      const target = spawn(await tools.helperBinary(TARGET), ["200", "200", "300", "200"], { stdio: ["ignore", "pipe", "pipe"] });
      try {
        const shown = await new Promise((resolve, reject) => {
          let said = "";
          target.stdout.on("data", (data) => {
            said += data;
            const line = said.split("\n").find((l) => l.startsWith("{"));
            if (line) resolve(JSON.parse(line));
          });
          target.on("close", (code) => reject(new Error(`pointer-target ended with status ${code}`)));
        });
        const { child, ended } = await node(["-e", `
          const { spawn } = require("node:child_process");
          const helper = spawn(${JSON.stringify(await tools.helperBinary(HELPER))}, ["record", ${JSON.stringify(file)}, "window", "${shown.window}", "10"], { stdio: ["ignore", "pipe", "inherit"] });
          helper.stdout.pipe(process.stdout);
          helper.on("close", (code) => { process.exitCode = code; });`], "recording");
        await sleep(2000);
        target.kill("SIGTERM");
        const { code, out } = await Promise.race([ended, sleep(15000).then(() => { child.kill("SIGINT"); throw new Error("The recording went on after its window closed"); })]);
        if (code !== 0) throw new Error(`The helper ended with status ${code}`);
        const result = JSON.parse(out.trim().split("\n").pop());
        if (!result.early) throw new Error(`The result doesn't say the recording ended early: ${JSON.stringify(result)}`);
        if (!near(result.seconds, 2)) throw new Error(`The video is ${result.seconds} s long`);
        return `${result.seconds.toFixed(2)} s, early: ${result.early}; ${await frames(file, [1], { still: true })}`;
      } finally {
        target.kill("SIGTERM");
      }
    },
  },
  {
    name: "a run killed 3 s into its recording",
    async run(folder) {
      const file = path.join(folder, "killed.mov");
      fs.rmSync(file, { force: true });
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
      // Killed 3 s after it said it recorded: the video holds those 3 s.
      const { seconds } = await videoFrame(file, 1, path.join(folder, "killed-1s.png"));
      if (!near(seconds, 3)) throw new Error(`The video is ${seconds} s long`);
      return `${seconds.toFixed(2)} s; ${await frames(file, [1, 2.5])}`;
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
