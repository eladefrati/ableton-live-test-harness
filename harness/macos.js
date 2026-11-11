"use strict";

// What the LOM can't do. Through Live's menus with AppleScript (System Events): saving
// sets, Key/MIDI Map Mode, reading the undo step's name. Through Launch Services, with Live
// left behind other windows: opening sets and starting Live (openInBackground). Needs the
// terminal app allowed under Privacy & Security > Accessibility, and under Automation >
// System Events. Live's process is "Live" for both Suite and Beta.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const tools = require("./tools.js");

class MacError extends Error {}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (error, stdout, stderr) => {
      if (error) reject(new MacError((stderr || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const inLive = (body) => `tell application "System Events" to tell process "Live"\n${body}\nend tell`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isFrontmost = async () =>
  (await osascript(`tell application "System Events" to get frontmost of process "Live"`)) === "true";

const frontmostApp = () => osascript(`tell application "System Events" to get bundle identifier of first process whose frontmost is true`);

// Declares user activity once, which turns a slept display on, as a keypress would. The
// assertion goes with the osascript process, so nothing holds the display on afterwards.
const WAKE_DISPLAY = `ObjC.import("IOKit");
function run() {
  const status = $.IOPMAssertionDeclareUserActivity($("ableton-live-test-harness"), 0, Ref());
  if (status !== 0) throw new Error("IOPMAssertionDeclareUserActivity returned " + status);
}`;

// Wakes the display and waits until some app is frontmost. With the remote Mac's display asleep,
// System Events reported no frontmost process and Live couldn't be brought to the front,
// so menu clicks and Save As timed out; declaring user activity brought both back
// (2026-11-03).
async function wakeDisplay({ timeoutMs = 3000 } = {}) {
  await new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", "-e", WAKE_DISPLAY], (error, stdout, stderr) => {
      if (error) reject(new MacError(`Waking the display failed: ${(stderr || error.message).trim()}`));
      else resolve();
    });
  });
  try {
    await waitFor(async () => Boolean(await frontmostApp().catch(() => "")), "an app to be frontmost", timeoutMs);
  } catch {
    throw new MacError(`No app is frontmost ${timeoutMs} ms after declaring user activity; Live can't be brought to the front`);
  }
}

// Brings Live to the front and waits until it is there; throws if it doesn't come. System
// Events' "set frontmost of process", sent once and not checked, wasn't enough: started
// with Ghostty in front, save-reopen.js failed in 1 of 2 runs, and 0 of 6 with this
// (2026-11-02). Live is addressed by its bundle id, which Suite and Beta don't share.
async function activate({ timeoutMs = 3000 } = {}) {
  if (await isFrontmost()) return;
  await wakeDisplay();
  const id = await osascript(`tell application "System Events" to get bundle identifier of process "Live"`);
  await osascript(`tell application id ${quote(id)} to activate`);
  await waitFor(isFrontmost, "Live to come to the front", timeoutMs);
}

// Sends keystrokes (System Events `keystroke` and `key code` lines) to Live. They go to the
// frontmost app, whatever process the tell block names, so Live is brought to the front
// first, and if it can't be, nothing is typed. A click elsewhere between the check and the
// keys still takes them.
async function typeInLive(body) {
  await activate();
  await osascript(inLive(body));
}

// Brings the app with bundle id `id` back to the front, if Live is still there. Typing
// leaves Live in front, where keys meant for the app the user was in land instead (a space
// starts the transport). If the user has moved to another app meanwhile, it stays there.
async function giveBackFront(id) {
  if (await isFrontmost()) await osascript(`tell application id ${quote(id)} to activate`);
}

// The item names of a menu bar menu, separators left out. Joined with linefeeds, since
// item names (an undo step naming a clip) can contain commas.
async function menuItems(menu) {
  const out = await osascript(`set AppleScript's text item delimiters to linefeed
tell application "System Events" to tell process "Live"
  set names to name of every menu item of menu ${quote(menu)} of menu bar 1
end tell
set out to {}
repeat with n in names
  set end of out to (n as text)
end repeat
return out as text`);
  return out.split("\n").filter((name) => name !== "missing value");
}

// Clicks a menu item: clickMenu("File", "Save Live Set"). After File > New Live Set with
// unsaved changes, Live's "Save changes?" dialog can't be read or pressed through the LOM
// (no message, no buttons; measured): saveSetAs into a temp folder
// first, so Live doesn't ask.
async function clickMenu(menu, item) {
  // Woken first: with the display asleep there is no frontmost app to put back.
  await wakeDisplay();
  const before = await frontmostApp().catch(() => null);
  await activate();
  try {
    await osascript(inLive(`click menu item ${quote(item)} of menu ${quote(menu)} of menu bar 1`));
  } finally {
    if (before) await giveBackFront(before).catch(() => {});
  }
}

async function isChecked(menu, item) {
  const mark = await osascript(inLive(
    `get value of attribute "AXMenuItemMarkChar" of menu item ${quote(item)} of menu ${quote(menu)} of menu bar 1`));
  return mark !== "" && mark !== "missing value";
}

async function undoName() {
  const first = (await menuItems("Edit"))[0];
  return first.startsWith("Undo ") ? first.slice(5) : null;
}

// Sets a toggle menu item and waits for its check mark to follow: Live updates its menus'
// marks about a second after the change.
async function setToggle(menu, item, on, { timeoutMs = 3000 } = {}) {
  if ((await isChecked(menu, item)) === on) return;
  await clickMenu(menu, item);
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(200)) {
    if ((await isChecked(menu, item)) === on) return;
  }
  throw new MacError(`${menu} > ${item} did not turn ${on ? "on" : "off"} within ${timeoutMs} ms`);
}

const setKeyMapMode = (on) => setToggle("Options", "Edit Key Map", on);
const setMidiMapMode = (on) => setToggle("Options", "Edit MIDI Map", on);

async function liveApp() {
  return osascript(`tell application "System Events" to get POSIX path of application file of process "Live"`);
}

async function waitFor(fn, what, timeoutMs) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(200)) {
    const value = await fn();
    if (value) return value;
  }
  throw new MacError(`Timed out after ${timeoutMs} ms waiting for ${what}`);
}

// /var is a link to /private/var on macOS.
function sameFile(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

const mtime = (file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0);

// The folder that holds every temp folder the harness makes (sets saved as, the sets
// relaunch.js starts Live on, plug-in sets). Its own folder, not the system temp folder itself: Go to Folder lists the
// parent of the path typed into it, and with 15,857 entries in the system temp folder it
// was still loading when saveSetAs pressed Return (measured 2026-11-01). relaunch.js
// empties it once Live has quit.
const HARNESS_TEMP = path.join(os.tmpdir(), "ableton-harness");

// Whether `file` is inside `root` (HARNESS_TEMP), where every set the harness makes lives;
// false if either is missing. /var is a link to /private/var, and Live reports the latter.
function inHarnessTemp(file, root = HARNESS_TEMP) {
  try {
    return fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep);
  } catch {
    return false;
  }
}

function tempFolder(prefix) {
  fs.mkdirSync(HARNESS_TEMP, { recursive: true });
  return fs.mkdtempSync(path.join(HARNESS_TEMP, prefix));
}

// Deletes every folder in the harness's temp folder: the sets earlier runs saved or started
// Live on. Call it only with no Live running, since a running Live may have one of them open.
function emptyHarnessTemp(say, root = HARNESS_TEMP) {
  const old = fs.existsSync(root) ? fs.readdirSync(root) : [];
  for (const name of old) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  if (old.length) say(`info deleted ${old.length} folders in ${root}`);
}

// The process ids of the Lives running, Suite and Beta alike.
async function livePids() {
  return (await tools.run("pgrep", ["-x", "Live"]).catch(() => "")).split("\n").filter(Boolean).map(Number);
}

// Saves the set to its file, `file`, and resolves once the file has been rewritten. A set
// never saved opens the Save dialog instead: use saveSetAs. Only after saveSetAs into a
// temp folder: never overwrite the file the user's set was opened from.
async function saveSet(file, { timeoutMs = 10000 } = {}) {
  const before = mtime(file);
  await clickMenu("File", "Save Live Set");
  await waitFor(() => mtime(file) > before, `${file} to be saved`, timeoutMs);
}

async function pressReturnUntil(done, when, what, timeoutMs) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (await when()) await typeInLive("key code 36");
    for (const next = Date.now() + 2000; Date.now() < next; await sleep(200)) {
      if (await done()) return;
    }
  }
  throw new MacError(`Timed out after ${timeoutMs} ms waiting for ${what}`);
}

// Saves the set as <folder>/<name> Project/<name>.als (Live puts a new set in a project
// folder named after it) through File > Save Live Set As..., typing the name into the
// Save panel and the folder into its Go to Folder sheet. Refuses a path that exists, to
// stay clear of the Replace sheet. Resolves with the file once it is written. Make
// `folder` with tempFolder(); a folder in HARNESS_TEMP is deleted if the save fails.
// Whichever app was in front before is put back in front afterwards (giveBackFront).
async function saveSetAs(folder, name, { timeoutMs = 10000 } = {}) {
  const file = path.join(folder, `${name} Project`, `${name}.als`);
  if (fs.existsSync(file)) throw new MacError(`${file} exists`);
  // Live's Save panel is a window of its own named "Save", not a sheet. While it is open
  // the LOM reports a dialog with no message and no buttons, and other requests can fail.
  // Accessibility shows whether its Go to Folder sheet is open, but nothing in it: no
  // text, no "Loading...", no button names.
  const panelOpen = async () => (await osascript(inLive(`exists window "Save"`))) === "true";
  const sheetOpen = async () => (await osascript(inLive(`count of sheets of window "Save"`))) !== "0";
  // Woken first: with the display asleep there is no frontmost app to put back.
  await wakeDisplay();
  const before = await frontmostApp().catch(() => null);
  try {
    await clickMenu("File", "Save Live Set As...");
    await waitFor(panelOpen, "the Save dialog", timeoutMs);
    // The panel exists a moment before it takes keys, so it waits first.
    await sleep(1000);
    await typeInLive(`
      keystroke "a" using command down
      keystroke ${quote(name)}
      keystroke "g" using {command down, shift down}`);
    await waitFor(sheetOpen, "the Go to Folder sheet", timeoutMs);
    // Go to Folder's highlighted suggestion lags the typed path, and Return takes the
    // suggestion: half a second after typing it still named the previous temp folder
    // (measured 2026-10-31).
    await typeInLive(`keystroke ${quote(folder)}\ndelay 2`);
    // A Return pressed while the sheet is still loading the path is lost, so Return is
    // pressed again until the sheet closes, then (Save) until the file is written; never
    // with the panel gone, where Return would go to Live's main window.
    await pressReturnUntil(async () => !(await sheetOpen()), sheetOpen, "Go to Folder to close", timeoutMs);
    await sleep(500);
    await pressReturnUntil(() => fs.existsSync(file),
      async () => !fs.existsSync(file) && (await panelOpen()) && !(await sheetOpen()), `${file} to be written`, timeoutMs);
  } catch (error) {
    if (path.dirname(folder) === HARNESS_TEMP) fs.rmSync(folder, { recursive: true, force: true });
    // Don't leave the panel open: it blocks what the caller does next. It may still be
    // on its way, so give it a moment to appear.
    for (let tries = 0; tries < 10; tries++) {
      if (await panelOpen().catch(() => false)) {
        await typeInLive("key code 53").catch(() => {});
        break;
      }
      await sleep(200);
    }
    throw error;
  } finally {
    if (before) await giveBackFront(before).catch(() => {});
  }
  return file;
}

// Opens `file` with the app at `app`, starting the app if it isn't running, without
// bringing it to the front (ADR-0003): NSWorkspace with activation off, through JXA. Live
// came forward with `open -a` and with `open -g -a`. The request is asynchronous, so the
// script waits for its completion handler: exiting at once dropped the open in 3 of 3
// tries (2026-11-02). Rejects with Launch Services' error, e.g. while the app is quitting.
const OPEN_IN_BACKGROUND = `ObjC.import("AppKit");
function run(argv) {
  const config = $.NSWorkspaceOpenConfiguration.configuration;
  config.activates = false;
  config.addsToRecentItems = false;
  let done = false, failure = null;
  $.NSWorkspace.sharedWorkspace.openURLsWithApplicationAtURLConfigurationCompletionHandler(
    $.NSArray.arrayWithObject($.NSURL.fileURLWithPath(argv[1])), $.NSURL.fileURLWithPath(argv[0]), config,
    (app, error) => { if (error && !error.isNil()) failure = ObjC.unwrap(error.localizedDescription); done = true; });
  const deadline = Date.now() + 15000;
  while (!done && Date.now() < deadline) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  if (failure) throw new Error(failure);
  if (!done) throw new Error("no answer from Launch Services within 15 s");
}`;

function openInBackground(app, file) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", "-e", OPEN_IN_BACKGROUND, app, file], (error, stdout, stderr) => {
      if (error) reject(new MacError(`Opening ${file} with ${app} failed: ${(stderr || error.message).trim()}`));
      else resolve();
    });
  });
}

// Opens a set file in the running Live, leaving Live behind other windows. If the open set
// has unsaved changes, Live asks first; answer with the LOM's
// /live/application/press_current_dialog_button.
async function openSet(file) {
  await openInBackground(await liveApp(), file);
}

// Buttons of Live's "Save changes to ... before closing?" dialog, by index (found by
// pressing each in Live 12.4).
const SAVE_CHANGES = { DONT_SAVE: 0, CANCEL: 1, SAVE: 2 };

// Buttons of "Would you like to delete the temporary files in .../<time> Temp Project?",
// which Live asks on quitting a set never saved that recorded audio, by index (found by
// pressing each in Live 12.4.25b1: 0 quit and kept the folder, 1 kept Live running, 2
// quit and deleted it).
const TEMP_FILES = { LEAVE: 0, CANCEL: 1, DELETE: 2 };

// Buttons of "This action will stop audio. Proceed?", which Live asks when a set is opened
// while the transport plays and the open set has no unsaved changes (with unsaved changes
// it asks "Save changes?" instead), by index (found by pressing each in Live 12.4.25b1).
const STOP_AUDIO = { CANCEL: 0, OK: 1 };

// Opens a set file through a live client and answers Live's "Save changes?" dialog if the
// open set has unsaved changes: saves them with { save: true }, else discards them. Pass
// { save: true } only after saveSetAs into a temp folder, as for saveSet. Resolves once
// Live has replaced the set (its id changes, even when reopening the same file), the new
// set is `file`, and its devices' parameter counts have settled (Max for Live devices load
// after the set).
async function openSetAndWait(live, file, { save = false, timeoutMs = 30000 } = {}) {
  const before = await live.get("song", "id");
  // Stopped, Live doesn't ask "This action will stop audio?"; OK below covers it anyway.
  if (await live.get("song", "is_playing")) {
    live.send("/live/song/stop_playing");
    await waitFor(async () => !(await live.get("song", "is_playing")), "the transport to stop", 5000);
  }
  await openSet(file);
  const deadline = Date.now() + timeoutMs;
  let answered = false;
  let proceeded = false;
  for (;;) {
    if (Date.now() > deadline) throw new MacError(`${file} did not finish opening within ${timeoutMs} ms`);
    await sleep(300);
    let dialog;
    try {
      dialog = await live.dialog();
      if (!dialog && (await live.get("song", "id")) !== before) break;
    } catch {
      continue; // Live is busy loading the set
    }
    if (dialog && !answered && /^Save changes/.test(dialog.message)) {
      await live.pressDialogButton(save ? SAVE_CHANGES.SAVE : SAVE_CHANGES.DONT_SAVE);
      answered = true;
    } else if (dialog && !proceeded && /^This action will stop audio/.test(dialog.message)) {
      await live.pressDialogButton(STOP_AUDIO.OK);
      proceeded = true;
    } else if (dialog) {
      throw new MacError(`Unexpected dialog while opening ${file}: ${dialog.message}`);
    }
  }
  const opened = await live.get("song", "file_path");
  if (!sameFile(opened, file)) throw new MacError(`Live opened ${opened}, not ${file}`);
  await live.settleDevices({ timeoutMs: Math.max(1000, deadline - Date.now()) });
}

// The open set's name.
async function windowTitle() {
  return osascript(inLive(`get name of first window whose subrole is "AXStandardWindow"`));
}

module.exports = {
  MacError, osascript, activate, wakeDisplay, isFrontmost, menuItems, clickMenu, isChecked, undoName,
  setToggle, setKeyMapMode, setMidiMapMode, liveApp, saveSet, saveSetAs, openInBackground, openSet,
  openSetAndWait, windowTitle, sameFile, SAVE_CHANGES, TEMP_FILES, STOP_AUDIO, HARNESS_TEMP, inHarnessTemp, tempFolder,
  emptyHarnessTemp, livePids,
};
