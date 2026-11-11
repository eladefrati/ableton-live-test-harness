#!/usr/bin/env node
"use strict";

// Read-only: is Live worth driving right now? Prints one line per check and exits 1 if any
// check fails. Changes nothing in Live. Whether Live sees a build is checked by
// device-checks.js before each run, for the build it is about to load.
//
//   node harness/doctor.js

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { connect } = require("./live.js");
const { liveApp } = require("./macos.js");
const { liveVersion, recordBitDepth, describeDepth, sampleRate } = require("./settings.js");
const { livePids } = require("./relaunch.js");
const { run } = require("./tools.js");

async function main() {
  let failed = 0;
  const line = (ok, text) => {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  };

  const pids = await livePids();
  if (pids.length === 0) {
    const relaunch = path.join(__dirname, "relaunch.js").replace(os.homedir(), "~");
    line(false, `Live is not running: start it with node ${relaunch} (--suite or --app <path> for another Live)`);
    return 1;
  }
  if (pids.length > 1) {
    line(false, "More than one Live is running (Suite and Beta?): the harness can't tell them apart. Ask the user to quit one.");
    return 1;
  }
  // Live keeps the Remote Script's modules from when it started: code changed since then
  // runs only after a reload (manager.py: a restart).
  const started = Date.parse(await run("ps", ["-o", "lstart=", "-p", pids[0]]));
  const repo = path.join(__dirname, "..");
  const changed = ["manager.py", ...fs.readdirSync(path.join(repo, "abletonosc")).map((f) => path.join("abletonosc", f))]
    .filter((f) => f.endsWith(".py") && fs.statSync(path.join(repo, f)).mtimeMs > started);
  if (changed.length) {
    console.log(`warn changed since Live started (${new Date(started).toLocaleTimeString()}): ${changed.join(", ")}; `
      + "if not reloaded since, run node harness/cli.js reload" + (changed.includes("manager.py") ? "; manager.py needs a Live restart" : ""));
  }
  // System Events names the app; it refuses without Accessibility and Automation permission.
  let appError = "";
  const app = await liveApp().catch((error) => {
    appError = error.message;
    return null;
  });
  const version = app ? await liveVersion(app).catch(() => null) : null;
  line(Boolean(app), app ? `Live running: ${app} ${version || ""}`.trim()
    : `Live is running, but System Events can't name its app: ${appError} (see "What Live needs" in harness/README.md)`);
  // Checks that need a bit depth refuse to record at another; this only reports it.
  try {
    const depth = await recordBitDepth();
    console.log(`info records at ${describeDepth(depth)} (Settings > Record/Warp/Launch > Bit Depth)`);
  } catch (error) {
    console.log(`warn can't read the record bit depth: ${error.message}`);
  }
  try {
    const { rate } = await sampleRate();
    console.log(`info runs at ${rate} Hz (Settings > Audio > In/Out Sample Rate)`);
  } catch (error) {
    console.log(`warn can't read the sample rate: ${error.message}`);
  }

  let live;
  try {
    live = await connect({ timeout: 1500 });
  } catch (error) {
    line(false, `${error.message}. Another session may be driving Live: ask before taking over.`);
    return 1;
  }
  try {
    try {
      await live.query("/live/test");
      line(true, "AbletonOSC answers on UDP 11000");
    } catch {
      line(false, "AbletonOSC does not answer: in Live, Settings > Link, Tempo & MIDI, set a Control Surface to AbletonOSC");
      return 1;
    }
    const dialog = await live.dialog();
    line(!dialog, dialog ? `A Live dialog is open: ${dialog.message || "no message (e.g. the Save panel)"}` : "No Live dialog open");
    const tracks = await live.trackData("name", "arm");
    const names = tracks.map(([name]) => name);
    const armed = tracks.filter(([, arm]) => arm).map(([name]) => name);
    line(armed.length === 0, armed.length ? `Armed tracks (recording checks will refuse): ${armed.join(", ")}` : "No armed tracks");
    if (await live.get("song", "session_automation_record")) {
      console.log("warn Automation Arm is on: recordArrangement turns it off while it records, but a parameter "
        + "changed during any other recording is written as automation");
    }
    console.log(`info ${names.length} tracks: ${names.join(", ")}`);
    console.log(`info open set: ${(await live.get("song", "file_path")) || "(never saved)"}`);
  } finally {
    live.close();
  }
  return failed ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
