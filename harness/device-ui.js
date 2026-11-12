"use strict";

// Presses a Max for Live device's controls with real mouse events, for controls the LOM
// can't reach and to prove that a click lands on one (ADR-0004). On the machine
// harness/local.json names as its "clickHost" (ADR-0005); on any other, a run's first press
// asks the person at it with a dialog and clicks only after Allow (ADR-0006).
//
//   const ui = await openDeviceUi(live, { track, device, build: "/path/to/Device.amxd" });
//   await ui.press("Button");
//   await ui.press("Tab", "B");            // one item of a live.tab
//   await ui.text([0, 0, 200, 100]);       // the text shown in part of the panel, device units
//
// A press clicks only after the checks in ADR-0004 pass, and throws DeviceUiError otherwise.
// It says nothing about what the click did: the check reads that from Live.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mac = require("./macos.js");
const tools = require("./tools.js");
const { patcherChunk } = require("./amxd.js");
const { checkLocation } = require("./run-log.js");

class DeviceUiError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// From the left edge of the device title's first word to the panel's corner, in points, at
// Live's 100% zoom (measured on the remote Mac, 2026-11-08). A line's own left edge won't
// do: icons in the title bar are read as characters.
const TITLE_TO_PANEL = { x: -17, y: 14 };
// The Info View's title is on the same row as the device titles, left of them.
const INFO_VIEW_RIGHT = 240; // points from the window's left edge
const ROW_TOLERANCE = 4; // points
// Long enough for Live to show the control under the pointer in the Info View.
const INFO_VIEW_SETTLE_MS = 350;

// Text recognition reads 0 as O and 1 as I or l.
const normalized = (text) => text.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");

// The patcher's controls by parameter long name (or scripting name), from an .amxd's bytes
// (amxd.js); a frozen device's patcher isn't JSON.
function readControls(amxd) {
  const patch = patcherChunk(amxd);
  if (!patch) throw new DeviceUiError("The .amxd has no patcher chunk");
  if (patch[0] !== 0x7b) throw new DeviceUiError("The .amxd's patcher isn't plain JSON (a frozen device?)");
  const { patcher } = JSON.parse(patch.toString("utf8").replace(/\0+$/, ""));
  const controls = new Map();
  for (const { box } of patcher.boxes) {
    if (!box.presentation || !box.presentation_rect) continue;
    const valueof = box.saved_attribute_attributes?.valueof ?? {};
    const name = valueof.parameter_longname ?? box.varname;
    if (!name) continue;
    const [x, y, w, h] = box.presentation_rect;
    controls.set(name, {
      name, x, y, w, h,
      info: box.annotation_name ?? null,
      items: box.maxclass === "live.tab" ? valueof.parameter_enum : null,
      rows: box.num_lines_presentation ?? 1,
      spacing: box.spacing_y ?? 0,
    });
  }
  return controls;
}

// The point to press, in device units.
function controlPoint(control, item) {
  const centre = control.x + control.w / 2;
  if (item === undefined) {
    if (control.items) throw new DeviceUiError(`${control.name} is a live.tab: say which item to press`);
    return [centre, control.y + control.h / 2];
  }
  if (!control.items) throw new DeviceUiError(`${control.name} has no items`);
  const index = control.items.indexOf(item);
  if (index < 0) throw new DeviceUiError(`${control.name} has no item ${item}`);
  if (control.rows !== control.items.length) {
    throw new DeviceUiError(`${control.name} isn't a single column of items, the only layout supported`);
  }
  const rowHeight = (control.h - (control.rows - 1) * control.spacing) / control.rows;
  return [centre, control.y + index * (rowHeight + control.spacing) + rowHeight / 2];
}

// Where the device's title is in the recognized lines: its first word's left edge and the
// line's top, in pixels. Exactly one must match, or the wrong device could be pressed.
function findTitle(lines, title) {
  const wanted = title.split(" ").map(normalized);
  const found = [];
  for (const line of lines) {
    const words = line.words.map((word) => normalized(word.text));
    for (let start = 0; start + wanted.length <= words.length; start++) {
      if (wanted.every((word, i) => words[start + i] === word)) found.push({ x: line.words[start].x, y: line.y });
    }
  }
  if (found.length === 0) throw new DeviceUiError(`The title "${title}" isn't on screen: is the device in view, at 100% zoom? Not clicked`);
  if (found.length > 1) throw new DeviceUiError(`The title "${title}" is on screen ${found.length} times. Not clicked`);
  return found[0];
}

function infoTitle(lines, title, scale) {
  const row = lines
    .filter((line) => Math.abs(line.y - title.y) <= ROW_TOLERANCE * scale && line.x < INFO_VIEW_RIGHT * scale)
    .sort((a, b) => a.x - b.x);
  return row.length ? row[0].text : "";
}

const HELPER_SOURCE = path.join(__dirname, "device-ui.swift");

const exec = (cmd, args) => tools.run(cmd, args).catch((e) => {
  throw new DeviceUiError(e.message, { cause: e });
});

const helperBinary = () => tools.helperBinary(HELPER_SOURCE).catch((e) => {
  throw new DeviceUiError(e.message, { cause: e });
});

async function helper(...args) {
  return exec(await helperBinary(), args);
}

// The one machine clicks are allowed on without asking: "clickHost" in harness/local.json,
// which is not in git (see local.example.json). Null with no file or no key. Never from the
// environment: a variable would lift the guard for a single command (ADR-0005).
const LOCAL = path.join(__dirname, "local.json");
function readClickHost(file = LOCAL) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new DeviceUiError(`Could not read ${file}: ${error.message}`);
  }
  let local;
  try {
    local = JSON.parse(text);
  } catch (error) {
    throw new DeviceUiError(`${file} isn't valid JSON: ${error.message}`);
  }
  return local && typeof local.clickHost === "string" && local.clickHost ? local.clickHost : null;
}

// How long the dialog asking to click waits for an answer (ADR-0006).
const ASK_SECONDS = 120;

// The running script as the dialog names it: tests/live/<name> for a project's check.
function runName(script = process.argv[1] || "node") {
  const location = checkLocation(script);
  return location ? `tests/live/${location.name}` : path.basename(script);
}

// Asks the person at this Mac whether the run may click; true only for Allow. Don't Allow is
// the cancel button, which osascript reports as error -128.
async function askToClick(script) {
  const text = `${script} wants to click in Live on this Mac. It moves the pointer until the check ends.`;
  const dialog = [
    "on run argv",
    "  activate",
    '  display dialog (item 1 of argv) with title "Live test harness" buttons {"Don\'t Allow", "Allow"} '
      + `default button "Don't Allow" cancel button "Don't Allow" giving up after ${ASK_SECONDS}`,
    "end run",
  ].flatMap((line) => ["-e", line]);
  let answer;
  try {
    answer = await tools.run("osascript", [...dialog, text]);
  } catch (error) {
    if (/\(-128\)/.test(error.message)) return false;
    throw new DeviceUiError(`Could not ask to click: ${error.message}`, { cause: error });
  }
  return /button returned:Allow/.test(answer) && !/gave up:true/.test(answer);
}

const machine = {
  hostname: () => os.hostname().replace(/\.local$/, ""),
  clickHost: () => readClickHost(),
  ask: () => askToClick(runName()),
  // A slept display has no windows to capture.
  wake: () => mac.wakeDisplay(),
  // The display first: activate() returns at once if Live is already in front, even asleep.
  async focus() {
    await mac.wakeDisplay();
    await mac.activate();
    if (!(await mac.isFrontmost())) throw new DeviceUiError("Live isn't frontmost. Not clicked");
  },
  window: async () => JSON.parse(await helper("window")),
  windows: async () => JSON.parse(await helper("windows")),
  capture: (windowId, file) => exec("screencapture", ["-x", "-o", "-l", windowId, file]),
  async read(windowId) {
    const folder = mac.tempFolder("device-ui-");
    try {
      const image = path.join(folder, "window.png");
      await machine.capture(windowId, image);
      return JSON.parse(await helper("text", image));
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
  hover: (windowId, x, y) => helper("hover", windowId, x, y),
  click: (windowId, x, y) => helper("click", windowId, x, y),
};

// Live's windows on screen, front to back: [{ id, title, x, y, w, h }] in points. A dialog
// or a panel (the Save panel) is a window of its own.
async function liveWindows(system = machine) {
  await system.wake();
  return system.windows();
}

// Saves a picture of one of Live's windows to `file` (PNG), with Live left where it is: the
// capture works behind other windows. The window is Live's main one, or the one with the id
// `window` (from liveWindows); a window that isn't Live's is refused. Needs Screen Recording
// for the terminal app, not the click host. Resolves with the window captured.
async function captureWindow(file, { window: id } = {}, system = machine) {
  await system.wake();
  const window = id === undefined ? await system.window() : (await system.windows()).find((w) => w.id === id);
  if (!window) throw new DeviceUiError(`Live has no window ${id} on screen`);
  await system.capture(window.id, file);
  return window;
}

class DeviceUi {
  constructor(live, { track, device, title, controls }, system) {
    Object.assign(this, { live, track, device, title, controls, system });
  }

  // Where the panel is now. Every press looks again: selecting a device can scroll the view.
  async locate() {
    await this.system.wake();
    this.live.send("/live/view/set/selected_track", this.track);
    this.live.send("/live/view/set/selected_device", this.track, this.device);
    await this.live.sync();
    const window = await this.system.window();
    const { width, lines } = await this.system.read(window.id);
    const scale = width / window.w; // pixels per point
    const title = findTitle(lines, this.title);
    return {
      window, scale, title,
      x: window.x + title.x / scale + TITLE_TO_PANEL.x,
      y: window.y + title.y / scale + TITLE_TO_PANEL.y,
    };
  }

  async press(name, item) {
    const control = this.controls.get(name);
    if (!control) throw new DeviceUiError(`The build has no control named ${name}`);
    if (!control.info) throw new DeviceUiError(`${name} has no annotation_name for the Info View to confirm. Not clicked`);
    const [ux, uy] = controlPoint(control, item);

    await this.permit();
    await this.system.focus();
    const at = await this.locate();
    const [x, y] = [at.x + ux, at.y + uy];
    await this.system.hover(at.window.id, x, y);
    await sleep(this.system.settleMs ?? INFO_VIEW_SETTLE_MS);
    const { lines } = await this.system.read(at.window.id);
    const shown = infoTitle(lines, at.title, at.scale);
    if (normalized(shown) !== normalized(control.info)) {
      throw new DeviceUiError(`The Info View reads "${shown}" over ${name}, expected "${control.info}" (is it visible?). Not clicked`);
    }
    await this.system.focus();
    await this.system.click(at.window.id, x, y);
  }

  // Before the first hover: on the click host at once, on any other machine after the person
  // at it allows the run's clicks (ADR-0006). The answer holds for the rest of the run.
  async permit() {
    if (this.system.allowed) return;
    const host = this.system.hostname();
    if (host !== this.system.clickHost() && !(await this.system.ask())) {
      throw new DeviceUiError(`Clicks in Live on ${host} weren't allowed (ADR-0006). Not clicked`);
    }
    this.system.allowed = true;
  }

  // The lines of text shown inside a rectangle of the panel, [x, y, w, h] in device units.
  async text([rx, ry, rw, rh]) {
    const at = await this.locate();
    const { lines } = await this.system.read(at.window.id);
    const inside = lines.map((line) => ({
      text: line.text,
      x: (line.x + line.w / 2) / at.scale + at.window.x - at.x,
      y: (line.y + line.h / 2) / at.scale + at.window.y - at.y,
    })).filter(({ x, y }) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
    return inside.sort((a, b) => a.y - b.y || a.x - b.x).map((line) => line.text);
  }
}

async function openDeviceUi(live, { track, device, build }, system = machine) {
  const names = await live.query("/live/track/get/devices/name", track);
  const title = names[device + 1];
  if (!title) throw new DeviceUiError(`Track ${track} has no device ${device}`);
  return new DeviceUi(live, { track, device, title, controls: readControls(fs.readFileSync(build)) }, system);
}

module.exports = { DeviceUiError, openDeviceUi, captureWindow, liveWindows, readControls, controlPoint, findTitle, infoTitle, readClickHost, runName };
