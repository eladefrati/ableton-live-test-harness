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
const { liveApp, livePids, liveStartTime, inHarnessTemp } = require("./macos.js");
const { liveVersion, recordBitDepth, describeDepth, sampleRate } = require("./settings.js");
const { installedLives } = require("./relaunch.js");

const LOCAL = path.join(__dirname, "local.json");

// One line per setting in harness/local.json (`text`, null with no file): what is set, and
// what each missing one leaves off. Lives are the paths installedLives() found. The keys
// and their effects: "Settings" in harness/README.md.
function settingsLines(text, installed) {
  const lines = [];
  let local = {};
  if (text === null) lines.push("info no harness/local.json: every setting is unset (\"Settings\" in harness/README.md)");
  else {
    try {
      local = JSON.parse(text);
    } catch (error) {
      return [`warn harness/local.json isn't valid JSON (${error.message}): every setting is read as unset`];
    }
    if (!local || typeof local !== "object" || Array.isArray(local)) return ["warn harness/local.json isn't a JSON object: every setting is read as unset"];
  }
  const set = (key) => typeof local[key] === "string" && local[key] ? local[key] : null;
  const app = set("app");
  if (app) lines.push(fs.existsSync(app) ? `info app: relaunch.js starts ${app}` : `warn app: ${app} isn't installed; relaunch.js will refuse`);
  else if (installed.length > 1) {
    lines.push(`warn app is not set and ${installed.length} Lives are installed: relaunch.js starts the running one, `
      + "and with none running refuses; set \"app\" in harness/local.json to the one to use");
  } else lines.push("info app is not set: relaunch.js starts the running Live, else the only one installed");
  lines.push(set("remote") ? `info remote: remote.sh runs on ${set("remote")}` : "info remote is not set: remote.sh can't run checks on a second Mac");
  lines.push(set("clickHost") ? `info clickHost: device-ui.js clicks without asking on ${set("clickHost")} only`
    : "info clickHost is not set: device-ui.js asks before a run's first click on every machine");
  const unknown = Object.keys(local).filter((key) => !["app", "remote", "clickHost"].includes(key));
  if (unknown.length) lines.push(`warn harness/local.json has keys the harness doesn't read: ${unknown.join(", ")}`);
  return lines;
}

async function main() {
  let failed = 0;
  const line = (ok, text) => {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  };
  const local = fs.existsSync(LOCAL) ? fs.readFileSync(LOCAL, "utf8") : null;
  for (const text of settingsLines(local, installedLives())) console.log(text);

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
  // Live keeps the Remote Script's modules from when it started, so code changed since then
  // runs only after a reload (manager.py: a restart).
  const started = await liveStartTime(pids[0]);
  const repo = path.join(__dirname, "..");
  const changed = started === null ? [] : ["manager.py", ...fs.readdirSync(path.join(repo, "abletonosc")).map((f) => path.join("abletonosc", f))]
    .filter((f) => f.endsWith(".py") && fs.statSync(path.join(repo, f)).mtimeMs > started);
  if (started === null) {
    console.log("warn can't read when Live started, so whether the Remote Script changed since isn't checked");
  } else if (changed.length) {
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
    console.log(`info records at ${describeDepth(depth)} (Settings > Record, Warp & Launch > Bit Depth)`);
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
      console.log("warn Automation Arm is on: recordArrangement turns it off while it records unless asked to write automation, but a parameter "
        + "changed during any other recording is written as automation");
    }
    console.log(`info ${names.length} tracks: ${names.join(", ")}`);
    // Every set the harness opens or saves is in its temp folder (tempFolder); any other set
    // may be the user's, which a check would change.
    const file = await live.get("song", "file_path");
    if (file && inHarnessTemp(file)) console.log(`info open set: ${file} (made by the harness)`);
    else {
      console.log(`warn open set: ${file || "(never saved)"} was not made by the harness: a check changes it. `
        + "Unless the user calls it disposable, ask whether Live is free and run relaunch.js first");
    }
  } finally {
    live.close();
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { settingsLines };
