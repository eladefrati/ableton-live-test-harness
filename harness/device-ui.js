"use strict";

// Presses a device's controls with real mouse events, for controls the LOM can't reach and to
// prove that a click lands on one (ADR-0004), and captures the device's panel. A Max for Live
// device's controls come from its build; any other device's or plug-in's from points measured
// in Live (ADR-0007). On the machine
// harness/local.json names as its "clickHost" (ADR-0005); on any other, a run's first press
// asks the person at it with a dialog and clicks only after Allow (ADR-0006).
//
//   const ui = await openDeviceUi(live, { track, device, build: "/path/to/Device.amxd" });
//   await ui.press("Button");
//   await ui.press("Tab", "B");            // one item of a live.tab
//   await ui.text([0, 0, 200, 100]);       // the text shown in part of the panel, device units
//   await ui.capture("/path/to/device.png"); // the device, title bar and frame included
//
//   // any device or plug-in, at points measured from the panel's corner, in points:
//   await openDeviceUi(live, { track, device, controls: { Knob: { x: 50, y: 36, info: "Knob" } }, width: 300 });
//   // a device whose points the harness has measured (MEASURED_DEVICES), Auto Filter's knobs:
//   await openDeviceUi(live, { track, device });
//
// A press clicks only after the checks in ADR-0004 pass, and throws DeviceUiError otherwise.
// It says nothing about what the click did: the check reads that from Live.
//
// A plug-in's own window, the one its editor opens in (ADR-0008), at points measured in the
// editor from its top left, given with the editor's size in points:
//
//   const editor = await openPluginWindow(live, { track, device, size: [400, 120],
//     controls: { Button: { x: 100, y: 40 } } });
//   await editor.press("Button");
//   await editor.capture("/path/to/editor.png");   // the editor, without Live's title bar
//   await editor.close();

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
// A plug-in's title bar has two more buttons before its title (Unfold Device Parameters and
// the plug-in window's), so its title starts this much further right, in points (measured on
// the remote Mac, 2026-11-11).
const PLUGIN_TITLE_SHIFT = 32;
const isPlugin = (className) => /PluginDevice$/.test(className); // AuPluginDevice, PluginDevice
// The Info View's title is on the same row as the device titles, left of them. The Info View
// and the browser's lists are left of this; the device titles right of it.
const INFO_VIEW_RIGHT = 240; // points from the window's left edge
const ROW_TOLERANCE = 4; // points
// Long enough for Live to show the control under the pointer in the Info View.
const INFO_VIEW_SETTLE_MS = 350;
// A device's frame around its panel, in points at 100% zoom: left of and above the panel's
// corner (the title bar), right of the panel, and the whole height (measured on the remote
// Mac, 2026-11-11).
const FRAME = { left: 5, top: 20, right: 17, height: 192 };

// Devices measured in Live, by class name (/live/device/get/class_name): each control's
// centre in points from the panel's corner, with its Info View title, and the panel's width.
// Live 12.4.25b1 at 100% zoom, on the remote Mac, 2026-11-11.
const MEASURED_DEVICES = {
  // Auto Filter's knobs, by parameter name
  AutoFilter2: {
    width: 428,
    controls: {
      Frequency: { x: 50.5, y: 33.5, info: "Filter Frequency" },
      Resonance: { x: 50.5, y: 142.5, info: "Filter Resonance" },
      "LFO Amount": { x: 109, y: 141.5, info: "LFO Amount" },
      // The Rate knob, while the LFO's rate is in Hz; in other modes the Info View names
      // another parameter and a press is refused.
      "LFO Freq": { x: 170, y: 141.5, info: "LFO Frequency" },
      "Env Amount": { x: 337, y: 141.5, info: "Envelope Amount" },
      Drive: { x: 409.5, y: 29.5, info: "Drive" },
      "Dry/Wet": { x: 409.5, y: 141.5, info: "Dry/Wet" },
    },
  },
};

// Text recognition reads 0 as O and 1 as I or l.
const normalized = (text) => text.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");

// The patcher from an .amxd's bytes (amxd.js); a frozen device's patcher isn't JSON.
function readPatcher(amxd) {
  const patch = patcherChunk(amxd);
  if (!patch) throw new DeviceUiError("The .amxd has no patcher chunk");
  if (patch[0] !== 0x7b) throw new DeviceUiError("The .amxd's patcher isn't plain JSON (a frozen device?)");
  return JSON.parse(patch.toString("utf8").replace(/\0+$/, "")).patcher;
}

const presented = (patcher) => patcher.boxes.map(({ box }) => box).filter((box) => box.presentation && box.presentation_rect);

// The patcher's controls by parameter long name (or scripting name), from an .amxd's bytes.
function readControls(amxd) {
  const controls = new Map();
  for (const box of presented(readPatcher(amxd))) {
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

// The panel's width in points: the right edge of its rightmost object in presentation.
function readPanelWidth(amxd) {
  return Math.max(0, ...presented(readPatcher(amxd)).map((box) => box.presentation_rect[0] + box.presentation_rect[2]));
}

// Controls given as points, { name: { x, y, info } } with x and y each control's centre in
// points from the panel's corner, in the form readControls returns.
function pointControls(points) {
  return new Map(Object.entries(points).map(([name, { x, y, info }]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DeviceUiError(`${name} needs x and y in points`);
    return [name, { name, x, y, w: 0, h: 0, info: info ?? null, items: null, rows: 1, spacing: 0 }];
  }));
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

const SHORTENED_MIN = 3;
const ELLIPSIS = /(\.\.\.|…)$/;

// Whether the recognized words, from the first, read as the title: all its words, or its start
// cut short with an ellipsis.
function matchesTitle(words, wanted) {
  for (let i = 0; i < wanted.length && i < words.length; i++) {
    if (ELLIPSIS.test(words[i])) {
      const stem = words[i].replace(ELLIPSIS, "");
      const shown = [...wanted.slice(0, i), stem].join(" ");
      return wanted[i].startsWith(stem) && shown.replace(/ /g, "").length >= SHORTENED_MIN;
    }
    if (words[i] !== wanted[i]) return false;
  }
  return words.length >= wanted.length;
}

// Where the device's title is in the recognized lines: its first word's left edge and the
// line's top, in pixels. Text starting left of `fromX` (pixels) is skipped: the Info View and
// the browser, which can show the same name. Exactly one must match, or the wrong device could
// be pressed. A title too long for its device, which Live cuts short with an ellipsis
// ("Long Na..."), matches by its start, of at least SHORTENED_MIN characters.
function findTitle(lines, title, fromX = 0) {
  const wanted = title.split(" ").map(normalized);
  const found = [];
  for (const line of lines) {
    const words = line.words.map((word) => normalized(word.text));
    for (let start = 0; start < words.length; start++) {
      if (line.words[start].x < fromX) continue;
      if (matchesTitle(words.slice(start), wanted)) found.push({ x: line.words[start].x, y: line.y });
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
  // Crops a capture of the window to [x, y, w, h], in pixels.
  async captureCrop(windowId, [x, y, w, h], file) {
    const folder = mac.tempFolder("device-ui-");
    try {
      const image = path.join(folder, "window.png");
      await machine.capture(windowId, image);
      await exec("sips", ["-c", h, w, "--cropOffset", y, x, image, "--out", file]);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
  hover: (windowId, x, y) => helper("hover", windowId, x, y),
  click: (windowId, x, y) => helper("click", windowId, x, y),
  // A plug-in's window (ADR-0008): its button's state, opened or closed; where it and its
  // editor are; a click in the editor.
  pluginWindow: async (action, device) => JSON.parse(await helper("plugin-window", action, device)).open,
  editor: async (title) => JSON.parse(await helper("plugin-editor", title)),
  clickEditor: (title, x, y, [w, h]) => helper("click-editor", title, x, y, w, h),
  frontmost: () => mac.frontmostApp(),
  giveBack: (id) => mac.giveBackFront(id),
  // Crops a capture of the window, `width` points wide, to [x, y, w, h] in points.
  async captureRect(windowId, width, rect, file) {
    const folder = mac.tempFolder("device-ui-");
    try {
      const image = path.join(folder, "window.png");
      await machine.capture(windowId, image);
      const pixels = Number(/pixelWidth: (\d+)/.exec(await exec("sips", ["-g", "pixelWidth", image]))?.[1]);
      if (!pixels) throw new DeviceUiError(`Could not read the width of ${image}`);
      await helper("crop", image, ...rect.map((points) => Math.round((points * pixels) / width)), file);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
};

// Before a run's first hover: on the click host at once, on any other machine after the
// person at it allows the run's clicks (ADR-0006). The answer holds for the rest of the run.
async function permit(system) {
  if (system.allowed) return;
  const host = system.hostname();
  if (host !== system.clickHost() && !(await system.ask())) {
    throw new DeviceUiError(`Clicks in Live on ${host} weren't allowed (ADR-0006). Not clicked`);
  }
  system.allowed = true;
}

// Live's windows on screen, front to back: [{ id, title, layer, x, y, w, h }] in points. A
// dialog, a panel (the Save panel) or a plug-in's window (layer 3) is a window of its own.
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
  constructor(live, { track, device, title, controls, width, plugin = false }, system) {
    Object.assign(this, { live, track, device, title, controls, width, plugin, system });
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
    const title = findTitle(lines, this.title, INFO_VIEW_RIGHT * scale);
    return {
      window, scale, title,
      x: window.x + title.x / scale + TITLE_TO_PANEL.x - (this.plugin ? PLUGIN_TITLE_SHIFT : 0),
      y: window.y + title.y / scale + TITLE_TO_PANEL.y,
    };
  }

  async press(name, item) {
    const control = this.controls.get(name);
    if (!control) throw new DeviceUiError(`${this.title} has no control named ${name}`);
    if (!control.info) throw new DeviceUiError(`${name} has no Info View title to confirm (annotation_name, or info for a point). Not clicked`);
    const [ux, uy] = controlPoint(control, item);

    await permit(this.system);
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

  // Saves a picture of the device, its title bar and frame included, to `file` (PNG). Like
  // ui.text, it rests on the device being selected and its title unique on screen.
  async capture(file) {
    if (!this.width) throw new DeviceUiError(`The width of ${this.title}'s panel isn't known: give openDeviceUi a width`);
    const at = await this.locate();
    const rect = [
      at.x - at.window.x - FRAME.left,
      at.y - at.window.y - FRAME.top,
      this.width + FRAME.left + FRAME.right,
      FRAME.height,
    ].map((points) => String(Math.round(points * at.scale)));
    await this.system.captureCrop(at.window.id, rect, file);
  }
}

// A device's controls come from `build`, a Max for Live device's .amxd; from `controls`, points
// measured on any device or plug-in (pointControls); or, with neither, from MEASURED_DEVICES.
// `width` is the panel's width in points, for capture: read from a build, measured for a
// device in MEASURED_DEVICES, and given with `controls`.
async function openDeviceUi(live, { track, device, build, controls, width }, system = machine) {
  const names = await live.query("/live/track/get/devices/name", track);
  const title = names[device + 1];
  if (!title) throw new DeviceUiError(`Track ${track} has no device ${device}`);
  let panel;
  if (build) {
    const amxd = fs.readFileSync(build);
    panel = { controls: readControls(amxd), width: readPanelWidth(amxd) };
  } else {
    const [, , className] = await live.query("/live/device/get/class_name", track, device);
    if (controls) {
      panel = { controls: pointControls(controls), width: null };
    } else {
      const measured = MEASURED_DEVICES[className];
      if (!measured) throw new DeviceUiError(`The harness has no measured points for ${title} (${className}): give openDeviceUi a build or controls`);
      panel = { controls: pointControls(measured.controls), width: measured.width };
    }
    panel.plugin = isPlugin(className);
  }
  return new DeviceUi(live, {
    track, device, title, controls: panel.controls, width: width ?? panel.width, plugin: panel.plugin,
  }, system);
}

// How long a plug-in's window takes to show once Live is in front.
const EDITOR_WAIT_MS = 2000;

// A plug-in's own window (ADR-0008). Live titles it "<device>/<track>" and shows it only
// while Live is in front and the display is on.
class PluginWindow {
  constructor(live, { track, device, name, title, size, controls }, system) {
    Object.assign(this, { live, track, device, name, title, size, controls, system });
  }

  // The Show/Hide Plug-In Window button is found among the selected track's devices.
  async setOpen(open) {
    await this.system.wake();
    this.live.send("/live/view/set/selected_track", this.track);
    this.live.send("/live/view/set/selected_device", this.track, this.device);
    await this.live.sync();
    if ((await this.system.pluginWindow(open ? "open" : "close", this.name)) !== open) {
      throw new DeviceUiError(`${this.name}'s window didn't ${open ? "open" : "close"}`);
    }
  }

  close() {
    return this.setOpen(false);
  }

  // Brings Live to the front and waits for the window: { id, x, y, w, h, editor: { x, y, w, h } }.
  async locate() {
    await this.system.focus();
    for (const deadline = Date.now() + EDITOR_WAIT_MS; ; await sleep(200)) {
      try {
        return await this.system.editor(this.title);
      } catch (error) {
        if (Date.now() > deadline || !/isn't on screen/.test(error.message)) throw error;
      }
    }
  }

  // Clicks a control. The helper clicks only if the editor is this.size, the point inside it
  // and the window topmost there, checked just before the click.
  async press(name) {
    const control = this.controls.get(name);
    if (!control) throw new DeviceUiError(`${this.title} has no control named ${name}`);
    if (!this.size) throw new DeviceUiError(`The size of ${this.name}'s editor isn't known: give openPluginWindow a size. Not clicked`);
    const [x, y] = controlPoint(control);
    await permit(this.system);
    await this.locate();
    await this.system.clickEditor(this.title, x, y, this.size);
  }

  // Saves a picture of the editor, without Live's title bar, to `file` (PNG), then gives the
  // front back to the app that had it.
  async capture(file) {
    await this.system.wake();
    const before = await this.system.frontmost().catch(() => null);
    try {
      const window = await this.locate();
      const { editor } = window;
      await this.system.captureRect(window.id, window.w, [editor.x - window.x, editor.y - window.y, editor.w, editor.h], file);
    } finally {
      if (before) await this.system.giveBack(before).catch(() => {});
    }
  }
}

// Opens the window of the plug-in `device` on `track` (indices), if it isn't open. `size` is
// the editor's [w, h] and `controls` its controls' points ({ name: { x, y } }, from the
// editor's top left), both in points; a press needs both.
async function openPluginWindow(live, { track, device, size, controls = {} }, system = machine) {
  const names = await live.query("/live/track/get/devices/name", track);
  const name = names[device + 1];
  if (!name) throw new DeviceUiError(`Track ${track} has no device ${device}`);
  const [, , className] = await live.query("/live/device/get/class_name", track, device);
  if (!isPlugin(className)) throw new DeviceUiError(`${name} is not a plug-in (${className})`);
  const [, trackName] = await live.query("/live/track/get/name", track);
  if (size && !(size.length === 2 && size.every((n) => Number.isFinite(n) && n > 0))) {
    throw new DeviceUiError(`size must be [w, h] in points, got ${JSON.stringify(size)}`);
  }
  const window = new PluginWindow(live, {
    track, device, name, title: `${name}/${trackName}`, size, controls: pointControls(controls),
  }, system);
  await window.setOpen(true);
  return window;
}

module.exports = {
  DeviceUiError, openDeviceUi, openPluginWindow, captureWindow, liveWindows, readControls, readPanelWidth, pointControls, controlPoint,
  findTitle, infoTitle, readClickHost, runName, MEASURED_DEVICES,
};
