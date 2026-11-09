#!/usr/bin/env node
"use strict";

// Starts Live, quitting the running one first, and answers its dialogs so the run never
// stops at one: the open set is a test set, so unsaved changes and recordings are discarded.
// Live starts, behind other windows, on a fresh copy of sets/empty.als (one MIDI track,
// unarmed, no devices, no returns, nothing on Main, Main at -inf dB so runs are silent;
// recordings take tracks' Post FX, before Main), not the user's template, which can
// hold armed tracks and plug-ins; or, with --plugin, on a set holding only that plug-in.
// The set is in a folder of its own in the harness's temp folder (HARNESS_TEMP in
// macos.js), which every relaunch empties once Live has quit. Resolves once AbletonOSC
// answers in the new Live, the set is the open one, no dialog is open, Live has made (and
// deleted) a track of each kind once (warmUp) and, with --plugin, Live runs the plug-in with
// every parameter listed. Refuses an option it doesn't know.
//
//   node harness/relaunch.js          quit Live if it runs, then start Ableton Live 12 Beta
//   node harness/relaunch.js --kill   kill Live without asking it to quit (it hangs), then start it
//   node harness/relaunch.js --suite  start Ableton Live 12 Suite instead, for a task that needs it
//   node harness/relaunch.js --app <path>  start the Live at <path> instead
//   node harness/relaunch.js --plugin <name>
//                                     start on a set holding only the Audio Unit effect named
//                                     <name>, every parameter listed (plugin.js, ADR-0003)
//
// On quitting, "Save changes?" gets Don't Save and "delete the temporary files?" gets
// Delete. Any other dialog stops the run with Live left as it is: answering it needs a
// person. If Live is still running 10 s after the quit or the last answer (a plug-in can
// hang it), it is killed. Once it has exited, the Temp Projects it made are deleted: a
// set outside a Live project, as the copy is, records into one, and Live asks about
// deleting it only for a set never saved (measured in Live 12.4.25b1).
//
// After a kill, Live would start at "Live unexpectedly quit... recover your work?", which
// isn't a LOM dialog and takes no keys unless Live is the frontmost app. Live asks because
// its recovery data is still in its preferences folder (CrashRecoveryInfo.cfg, Undo,
// BaseFiles): moved into the folder's Crash folder, where Live keeps earlier ones, Live
// starts without asking (measured in Live 12.4.25b1), as if answered No. CrashDetection.cfg
// there exists only while Live runs and after it crashed or was killed (a clean quit
// deletes it), so with no Live running it says the recovery data must go, whoever stopped
// that Live.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { connect } = require("./live.js");
const { osascript, liveApp, sameFile, openInBackground, SAVE_CHANGES, TEMP_FILES, HARNESS_TEMP, tempFolder } = require("./macos.js");
const { preferencesFolder } = require("./settings.js");
const { buildPluginSet, checkPluginLoaded, writeSet } = require("./plugin.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
});

const HANG_MS = 10000; // Live exited about 3 s after the last answer in every run measured
const START_MS = 90000;
const WARM_MS = 30000;
const BETA = "/Applications/Ableton Live 12 Beta.app";
const SUITE = "/Applications/Ableton Live 12 Suite.app";
const RECOVERY_DATA = ["CrashRecoveryInfo.cfg", "Undo", "BaseFiles"];
// Saved by Live 12.4.25b1; Suite 12.4.3 opens it too.
const EMPTY_SET = path.join(__dirname, "sets", "empty.als");
// Live's default Temporary Folder; a different one set in Live's settings isn't followed.
const RECORDINGS = path.join(os.homedir(), "Music", "Ableton", "Live Recordings");

function answerFor(message) {
  if (/^Save changes to .* before closing\?$/s.test(message)) return SAVE_CHANGES.DONT_SAVE;
  if (/^Would you like to delete the temporary files in .*Temp Project\?$/s.test(message)) return TEMP_FILES.DELETE;
  return null;
}

// The Temp Projects among folder names that a Live started at `started` (ms) made: Live
// names one "YYYY-MM-DD HHMMSS Temp Project", in local time, some seconds after it starts.
function tempProjectsSince(names, started) {
  const from = Math.floor(started / 1000) * 1000;
  return names.filter((name) => {
    const m = name.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d)(\d\d)(\d\d) Temp Project$/);
    return m && new Date(m[1], m[2] - 1, m[3], m[4], m[5], m[6]).getTime() >= from;
  });
}

// "YYYY_MM_DD__HH_MM_SS_", the prefix Live gives what it keeps in its Crash folder.
function crashPrefix(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}__`
    + `${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}_`;
}

async function livePids() {
  return (await run("pgrep", ["-x", "Live"]).catch(() => "")).split("\n").filter(Boolean).map(Number);
}

const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitExit(pid, ms) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(200)) {
    if (!running(pid)) return true;
  }
  return !running(pid);
}

// Resolves true once Live has exited, false if it is still running HANG_MS after the quit or the last answer.
async function quit(live, app, pid, say) {
  // Playing, Live asked "This action will stop audio. Proceed?" before quitting a set with
  // no unsaved changes (2 of 2, 2026-11-02), so the transport is stopped first. A Live that
  // doesn't answer is quit as it is.
  try {
    if (await live.get("song", "is_playing")) {
      live.send("/live/song/stop_playing");
      await live.sync();
      say("info stopped the transport");
    }
  } catch {
    // no answer: quit anyway
  }
  // ignoring application responses: Live replies to quit only once its dialogs are
  // answered, and osascript would wait for that.
  await osascript(`ignoring application responses
tell application ${JSON.stringify(path.basename(app, ".app"))} to quit
end ignoring`);
  say("info asked Live to quit");
  let deadline = Date.now() + HANG_MS;
  while (Date.now() < deadline) {
    if (!running(pid)) return true;
    let dialog;
    try {
      dialog = await live.dialog();
    } catch {
      await sleep(300);
      continue; // Live is busy quitting, or has stopped answering
    }
    if (!dialog) {
      await sleep(300);
      continue;
    }
    const button = answerFor(dialog.message);
    if (button === null) {
      throw new Error(`Live is asking "${dialog.message || "(no message: e.g. the Save panel)"}" `
        + `(${dialog.buttons} buttons), which relaunch.js doesn't answer. Live is left running with it open: `
        + "ask the user to answer it");
    }
    await live.pressDialogButton(button);
    say(`info answered "${dialog.message}" with button ${button}`);
    deadline = Date.now() + HANG_MS;
  }
  return !running(pid);
}

async function kill(pid, say) {
  process.kill(pid, "SIGTERM");
  if (!(await waitExit(pid, 5000))) {
    process.kill(pid, "SIGKILL");
    if (!(await waitExit(pid, 5000))) throw new Error(`Live (pid ${pid}) is still running after SIGKILL`);
  }
  say(`info killed Live (pid ${pid})`);
}

// Moves the recovery data of a Live that crashed or was killed into its preferences
// folder's Crash folder, so the next start doesn't ask to recover. Call it with no Live
// running.
function discardRecovery(prefs, say) {
  if (!fs.existsSync(path.join(prefs, "CrashDetection.cfg"))) return;
  const prefix = crashPrefix(Date.now());
  fs.mkdirSync(path.join(prefs, "Crash"), { recursive: true });
  for (const name of RECOVERY_DATA) {
    const from = path.join(prefs, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(prefs, "Crash", prefix + name));
  }
  // As a clean quit leaves it; a second call then has nothing to do.
  fs.rmSync(path.join(prefs, "CrashDetection.cfg"), { force: true });
  say(`info moved Live's recovery data into ${path.join(prefs, "Crash")}, so it starts without asking to recover`);
}

function deleteTempProjects(started, say) {
  const names = fs.existsSync(RECORDINGS) ? fs.readdirSync(RECORDINGS) : [];
  for (const name of tempProjectsSince(names, started)) {
    fs.rmSync(path.join(RECORDINGS, name), { recursive: true, force: true });
    say(`info deleted the old Live's ${path.join(RECORDINGS, name)}`);
  }
}

// The set Live starts on, in a folder of its own, after emptying HARNESS_TEMP of earlier
// ones and sets saved as: a copy of the empty set, or `plugin`'s xml (buildPluginSet). Call
// it only once Live has quit, since the old Live had one of them open; holding UDP 11001
// keeps checks from making new ones meanwhile.
function freshSet(say, plugin) {
  const old = fs.existsSync(HARNESS_TEMP) ? fs.readdirSync(HARNESS_TEMP) : [];
  for (const name of old) fs.rmSync(path.join(HARNESS_TEMP, name), { recursive: true, force: true });
  if (old.length) say(`info deleted ${old.length} folders in ${HARNESS_TEMP}`);
  const file = path.join(tempFolder("relaunch-"), plugin ? "harness-plugin.als" : "empty.als");
  if (plugin) writeSet(file, plugin.xml);
  else fs.copyFileSync(EMPTY_SET, file);
  return file;
}

// The options: { kill, suite, plugin } (plugin: the name after --plugin, or null). Refuses
// anything else, since a relaunch discards the running Live's set: a mistyped option must
// not restart Live on the wrong set.
function parseArgs(argv) {
  const options = { kill: false, suite: false, plugin: null, app: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--kill") options.kill = true;
    else if (argv[i] === "--suite") options.suite = true;
    else if (argv[i] === "--app" && argv[i + 1] && !argv[i + 1].startsWith("--")) options.app = argv[++i];
    else if (argv[i] === "--app") throw new Error("--app needs the path of a Live app");
    else if (argv[i] === "--plugin" && argv[i + 1] && !argv[i + 1].startsWith("--")) options.plugin = argv[++i];
    else if (argv[i] === "--plugin") throw new Error("--plugin needs the plug-in's name, e.g. --plugin AUDelay");
    else throw new Error(`Unknown option ${argv[i]}: relaunch.js takes --kill, --suite, --app <path> and --plugin <name>`);
  }
  return options;
}

// Starts Live on `file`, behind other windows (openInBackground). open -a failed with
// error -600 for a few seconds after a kill, so a failed start is retried for 15 s.
async function start(app, file) {
  for (const deadline = Date.now() + 15000; ; await sleep(1000)) {
    try {
      await openInBackground(app, file);
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
  }
}

async function waitUp(live, began, file) {
  for (const deadline = Date.now() + START_MS; Date.now() < deadline; await sleep(1000)) {
    try {
      await live.query("/live/test");
    } catch {
      continue;
    }
    // While Live finishes starting, AbletonOSC can already answer and the LOM reports a
    // dialog with no message for a moment (seen in 2 of 3 starts, gone a second later).
    const dialog = await live.dialog().catch(() => ({ message: "" }));
    if (dialog && dialog.message) throw new Error(`Live started with a dialog open: ${dialog.message}`);
    if (dialog) continue;
    // A reply can still go missing while Live finishes starting: /live/test answered, then
    // file_path didn't within 1 s (1 of 8 relaunches, 2026-11-02).
    let opened;
    try {
      opened = await live.get("song", "file_path");
    } catch {
      continue;
    }
    if (!sameFile(opened, file)) throw new Error(`Live opened ${opened || "a new set"}, not ${file}`);
    return Date.now() - began;
  }
  throw new Error(`AbletonOSC didn't answer within ${START_MS / 1000} s of starting Live: AbletonOSC may not be `
    + "a Control Surface in this Live (ask the user to select it), or a window Live shows at startup may be "
    + "waiting (capture Live's window to see it)");
}

// Live builds a new track from the user's default track (User Library, Defaults/Creating
// Tracks) and loads its plug-ins. The first time after Live starts, that held Live's main
// thread 2.2 s (with plug-ins on the default audio track, Live 12.4.25b1, 2026-11-03 and
// -04), so a check's first get after creating a track got no reply within 2 s; later
// creations took 0.3 s. Creating and deleting one track of each kind pays that cost here,
// waiting up to `timeout` ms for each.
async function warmUp(live, timeout = WARM_MS) {
  for (const kind of ["audio", "midi"]) {
    live.send(`/live/song/create_${kind}_track`, -1);
    const [tracks] = await live.request("/live/song/get/num_tracks", [], (args) => args, { timeout });
    live.send("/live/song/delete_track", tracks - 1);
  }
  await live.request("/live/test", [], (args) => args, { timeout });
}

async function stop(live, pid, forceKill, say) {
  const old = await liveApp();
  const started = Date.parse(await run("ps", ["-o", "lstart=", "-p", String(pid)]));
  const exited = !forceKill && (await quit(live, old, pid, say));
  if (exited) say("info Live quit");
  else {
    if (!forceKill) say(`info Live still running ${HANG_MS / 1000} s after the quit or the last answer`);
    await kill(pid, say);
  }
  discardRecovery(await preferencesFolder(old), say);
  deleteTempProjects(started, say);
}

async function main(argv) {
  const say = (text) => console.log(text);
  const { kill: forceKill, suite, plugin: name, app: chosen } = parseArgs(argv);
  const app = chosen || (suite ? SUITE : BETA);
  // Before anything else: stopping Live discards its unsaved work.
  if (!fs.existsSync(app)) throw new Error(`${app} isn't installed: name the Live to start with --app <path>`);
  const pids = await livePids();
  if (pids.length > 1) throw new Error("More than one Live is running: the harness can't tell them apart");
  // Built before Live is quit, so a plug-in that can't be found or read leaves Live as it is.
  const plugin = name ? await buildPluginSet(name) : null;
  // Holding UDP 11001 across the relaunch also keeps other clients out until Live is back.
  const live = await connect({ timeout: 1000 });
  try {
    if (pids.length === 1) await stop(live, pids[0], forceKill, say);
    else say("info Live is not running");
    discardRecovery(await preferencesFolder(app), say);
    const file = freshSet(say, plugin);
    const began = Date.now();
    await start(app, file);
    const ms = await waitUp(live, began, file);
    const warming = Date.now();
    await warmUp(live);
    say(`info created and deleted an audio and a MIDI track, so Live has loaded the default tracks' devices `
      + `(${((Date.now() - warming) / 1000).toFixed(1)} s)`);
    let loaded = "";
    if (plugin) {
      await live.settleDevices();
      const { track } = await checkPluginLoaded(live, name, plugin.parameters);
      loaded = `, ${name} on track ${track} with ${plugin.parameters.length} parameters listed`;
    }
    say(`ok   Live is back (${path.basename(app, ".app")}) on ${file}${loaded}, ${(ms / 1000).toFixed(1)} s after the start`);
  } finally {
    live.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { answerFor, tempProjectsSince, crashPrefix, parseArgs, warmUp, livePids, stop };
