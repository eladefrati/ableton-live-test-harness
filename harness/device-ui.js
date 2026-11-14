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
//   await ui.drag("Knob", { up: 40 });     // turns a control: whole points with the button down (ADR-0013)
//   await ui.choose("Menu", "Item");       // an item of the menu a control opens (ADR-0014)
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
//   await editor.drag("Button", { right: -60 });   // a horizontal slider; { up: 40 } a knob
//   await editor.capture("/path/to/editor.png");   // the editor, without Live's title bar;
//                                                  // resolves with its size: { w, h }
//   await editor.close();

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mac = require("./macos.js");
const { spawn } = require("node:child_process");
const tools = require("./tools.js");
const { patcherChunk } = require("./amxd.js");
const { checkLocation } = require("./run-log.js");

// `done` is true on the error of a press that was stopped (ADR-0012) with only its button's
// release left: it throws as any stopped press does, and the click or the drag happened.
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
// How often a press looks for Stop while it waits on a read of Live's window.
const STOP_POLL_MS = 100;
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

const exec = (cmd, args, options) => tools.run(cmd, args, options).catch((e) => {
  throw new DeviceUiError(e.message, { cause: e });
});

const helperBinary = () => tools.helperBinary(HELPER_SOURCE).catch((e) => {
  throw new DeviceUiError(e.message, { cause: e });
});

// How the helper exits when Stop caught it with only a button's release left
// (device-ui.swift): the click or the drag happened, and the error says so with `done`.
const HAPPENED_STATUS = 4;

async function helper(...args) {
  const binary = await helperBinary();
  let child;
  try {
    return await exec(binary, args, {
      env: helperEnvironment(),
      started(spawned) {
        child = spawned;
        runningHelpers.add(child);
      },
    });
  } catch (error) {
    const ended = error.cause?.cause;
    // The helper handles the signal from its start: one that the signal ended got it before
    // that, so before it posted anything.
    if (ended?.signal === "SIGUSR2") throw new DeviceUiError(`${STOPPED_FROM_PILL}, and the helper had posted nothing`, { cause: error });
    if (ended?.code === HAPPENED_STATUS) error.done = true;
    throw error;
  } finally {
    runningHelpers.delete(child);
  }
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

// The script node was started with, or null for code given inline (node -e, -p or -pe), where
// process.argv[1] is the first argument passed to that code, or on stdin (node -), where it
// is "-".
function runScript(execArgv = process.execArgv, argv = process.argv) {
  if (execArgv.some((arg) => /^(-e|-p|-pe|--eval|--print)(=|$)/.test(arg)) || argv[1] === "-") return null;
  return argv[1] || null;
}

// The running script as harness-computer-use names it: tests/live/<name> for a project's
// check, the file's name for another script, null for inline code.
function runName(script = runScript()) {
  if (!script) return null;
  const location = checkLocation(script);
  return location ? `tests/live/${location.name}` : path.basename(script);
}

// Asks the person at this Mac whether the run may click; true only for Allow. Don't Allow is
// the cancel button, which osascript reports as error -128. `border` is whether the border
// was built: with none, the person is told so before they answer (ADR-0012). Exported for the
// tests.
async function askToClick(script, border) {
  const text = `harness-computer-use wants to click in Live on this Mac${script ? ` for ${script}` : ""}. `
    + (border ? "It moves the pointer until the run ends, while a purple glow shows around the screen."
      : "It moves the pointer until the run ends. Nothing on screen will show that it may take the pointer, and there will be no Stop.");
  const dialog = [
    "on run argv",
    "  activate",
    '  display dialog (item 1 of argv) with title "harness-computer-use" buttons {"Don\'t Allow", "Allow"} '
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

// harness-computer-use's overlay (ADR-0012): a purple border around the screen until this
// process ends, then a notification. It watches this process itself, so it goes also when the
// run is killed.
const OVERLAY_SOURCE = path.join(__dirname, "computer-use-overlay.swift");

// What a run that Stop on its pill stopped says, and its helper.
const STOPPED_FROM_PILL = "harness-computer-use was stopped from its pill: this run clicks no more";

// Stop's last resort (ADR-0012): when Stop can't remove the run's click token it sends the
// run SIGUSR2. The run then counts as stopped for good, whatever its token says, and passes
// the signal on to the helpers it has running, which stop as after Stop. Nothing ends here:
// a check fails at the press that throws and still cleans up.
let stopSignalled = false;
const runningHelpers = new Set();
function onStopSignal() {
  stopSignalled = true;
  for (const child of runningHelpers) child.kill("SIGUSR2");
}

// The run's click token (ADR-0012), a file that exists while the run may click and that the
// pill's Stop removes: one for the run, in a folder of its own, made when first needed and
// kept here, so that Stop on any pill the run shows stops it. It is never made again: a run
// whose token has gone stays stopped. From when it is made, the run listens for the signal
// of Stop's last resort. Exported for the tests.
let clickTokenPath = null;
function clickToken() {
  if (!clickTokenPath) {
    // Not in the harness's temp folder, which relaunch.js and quit.js empty.
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "harness-computer-use-"));
    // A folder that can't be removed, as one that can't be written to, stays: an error
    // thrown as the process ends would be printed and become the run's exit status.
    process.on("exit", () => {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch {}
    });
    process.on("SIGUSR2", onStopSignal);
    const token = path.join(folder, "token");
    fs.writeFileSync(token, "");
    clickTokenPath = token;
  }
  return clickTokenPath;
}

// Why the run may click no more, or null while it may: while Stop hasn't signalled it, its
// token can be opened for reading and the token's folder can be written to and searched, so
// that Stop can remove the token. Anything else counts as stopped, since the run can't tell
// that it wasn't; device-ui.swift reads the token the same way. A run with no token, one that
// showed no border, has no Stop to obey.
function stopped(token = clickTokenPath) {
  if (stopSignalled) return STOPPED_FROM_PILL;
  if (token === null) return null;
  const folder = path.dirname(token);
  const cantTell = (why) => `harness-computer-use can't tell that it wasn't stopped (${why}), which counts as stopped: this run clicks no more`;
  try {
    fs.accessSync(folder, fs.constants.W_OK | fs.constants.X_OK);
  } catch (error) {
    return cantTell(error.code === "ENOENT" ? `the token's folder ${folder} is gone`
      : `the folder ${folder} can't be written to, so Stop couldn't remove the token`);
  }
  try {
    fs.closeSync(fs.openSync(token, "r"));
    return null;
  } catch (error) {
    return error.code === "ENOENT" ? STOPPED_FROM_PILL : cantTell(`the token ${token} can't be read`);
  }
}

// The variable that names the run's click token to a helper (device-ui.swift), and to nothing
// else. This process's own environment is neither read nor written: a token named there
// belongs to the run that started this one, whose Stop isn't this run's, and one written
// there would reach every process this run starts.
const CLICK_TOKEN = "HARNESS_COMPUTER_USE_TOKEN";
function helperEnvironment() {
  const env = { ...process.env };
  if (clickTokenPath) env[CLICK_TOKEN] = clickTokenPath;
  else delete env[CLICK_TOKEN];
  return env;
}

// One line, whatever the reason: a failed build's is the compiler's whole output.
const warnNoBorder = (reason) => console.error(`warn harness-computer-use couldn't show its border: ${reason.split("\n")[0]}. The run clicks without it`);

// How long the overlay has to say that its windows are on screen. By itself it gives up
// after 2 s.
const OVERLAY_SHOWN_MS = 5000;

// Builds the helper and the overlay, ahead of the dialog: the wait for a build comes before
// the person is asked, and the border shows as soon as they allow. Resolves with the
// overlay's binary, or with null, after a warning, if only the overlay can't be built.
async function buildComputerUse() {
  await helperBinary();
  return tools.helperBinary(OVERLAY_SOURCE).catch((error) => {
    warnNoBorder(error.message);
    return null;
  });
}

// Starts the overlay and resolves once it says its windows are on screen. Rejects with the
// reason the overlay gives if it ends before that, and ends it and rejects if it says nothing
// for `shownMs`. One that goes later, however it ends, while the run goes on and wasn't
// stopped, is warned of: the person has lost the pill and its Stop. Nothing of the overlay
// keeps this process running.
async function showComputerUse(binary, { shownMs = OVERLAY_SHOWN_MS } = {}) {
  const run = runName();
  const overlay = spawn(binary, [String(process.pid), clickToken(), ...(run ? [run] : [])], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let [said, complained] = ["", ""];
  overlay.stderr.on("data", (data) => { complained += data; });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        overlay.kill();
        reject(new Error(`it didn't show within ${shownMs} ms`));
      }, shownMs);
      overlay.stdout.on("data", (data) => {
        said += data;
        if (/^shown$/m.test(said)) resolve();
      });
      overlay.on("error", reject);
      // The overlay's reason is the last thing it writes.
      overlay.on("close", (code, signal) => reject(new Error(complained.trim().split("\n").pop() || `it ended with ${signal ?? `status ${code}`}`)));
    });
  } finally {
    clearTimeout(timer);
    overlay.stdout.destroy();
    overlay.stderr.destroy();
    overlay.unref();
  }
  // Not after Stop, when the border goes by itself and the run clicks no more.
  const gone = (code, signal) => {
    if (!stopped()) console.error(`warn harness-computer-use's border has gone (${signal ?? `status ${code}`}). The run clicks without it`);
  };
  // It may have ended already, its exit known here before its last words were read.
  if (overlay.exitCode !== null || overlay.signalCode !== null) gone(overlay.exitCode, overlay.signalCode);
  else overlay.on("exit", gone);
}

// This machine's name, as "clickHost" gives one.
const hostname = () => os.hostname().replace(/\.local$/, "");

// Not exported: its pointer calls skip the dialog, the Info View check and Stop.
const machine = {
  hostname,
  clickHost: () => readClickHost(),
  ask: (border) => askToClick(runName(), border),
  buildComputerUse,
  showComputerUse,
  stopped,
  // A slept display has no windows to capture.
  wake: () => mac.wakeDisplay(),
  // The display first: activate() returns at once if Live is already in front, even asleep.
  // `refuse` is called just before Live is told to activate, and throws if it must not be.
  async focus(refuse) {
    await mac.wakeDisplay();
    await mac.activate({ refuse });
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
  // Crops a capture of the window to [x, y, w, h], in pixels, which must lie inside it.
  async captureCrop(windowId, rect, file) {
    const folder = mac.tempFolder("device-ui-");
    try {
      const image = path.join(folder, "window.png");
      await machine.capture(windowId, image);
      await helper("crop", image, ...rect, file);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
  hover: (windowId, x, y) => helper("hover", windowId, x, y),
  click: (windowId, x, y) => helper("click", windowId, x, y),
  drag: (windowId, x, y, dx, dy) => helper("drag", windowId, x, y, dx, dy),
  // A plug-in's window (ADR-0008): its button's state, opened or closed; where it and its
  // editor are; a click in the editor.
  pluginWindow: async (action, device) => JSON.parse(await helper("plugin-window", action, device)).open,
  editor: async (title) => JSON.parse(await helper("plugin-editor", title)),
  clickEditor: (title, x, y, [w, h]) => helper("click-editor", title, x, y, w, h),
  dragEditor: (title, x, y, [w, h], dx, dy) => helper("drag-editor", title, x, y, w, h, dx, dy),
  frontmost: () => mac.frontmostApp(),
  // Escape, which closes an open menu: `escape` brings Live to the front first, calling
  // `refuse` before that and before it types; `escapeIfInFront` types it only if Live is in
  // front, and doesn't bring it there.
  escape: (refuse) => mac.typeInLive("key code 53", { refuse }),
  escapeIfInFront: () => mac.typeIfLiveInFront("key code 53"),
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

// The system's calls that move the pointer or press its button.
const POINTER_CALLS = ["hover", "click", "drag", "clickEditor", "dragEditor"];
// Every call of the machine, by name: a test requires each to be classified.
const MACHINE_CALLS = Object.keys(machine);

// The systems whose run may use the pointer.
const allowed = new WeakSet();

// Before a run's first hover: on the click host at once, on any other machine after the
// person at it allows the run's clicks (ADR-0006). The answer holds for the rest of the run,
// and while it does a purple border shows there (ADR-0012), built before the person is asked.
// The border only informs: a run that can't show it still clicks, with a warning. Once the
// run is stopped (ADR-0012), by Stop on the pill or because it can't tell that it wasn't, it
// throws, saying which: the run goes on, so a check fails there and still cleans up.
async function permit(system) {
  if (!allowed.has(system)) {
    const host = system.hostname();
    if (host !== system.clickHost()) {
      const overlay = await system.buildComputerUse();
      if (!(await system.ask(overlay !== null))) throw new DeviceUiError(`Clicks in Live on ${host} weren't allowed (ADR-0006). Not clicked`);
      if (overlay) await system.showComputerUse(overlay).catch((error) => warnNoBorder(error.message));
    }
    allowed.add(system);
  }
  const why = system.stopped();
  if (why) throw new DeviceUiError(`${why}. Not clicked`);
}

// Resolves as `reading` does, a read of Live's window, unless `system`'s run is stopped
// (ADR-0012) before it ends: then rejects within STOP_POLL_MS. A read takes seconds and
// posts nothing, so it is left to end on its own, and what it ends with is dropped.
async function readUnlessStopped(system, reading) {
  let timer;
  const stopped = new Promise((resolve, reject) => {
    const look = () => {
      const why = system.stopped();
      if (why) reject(new DeviceUiError(`${why}. Not clicked`));
      else timer = setTimeout(look, STOP_POLL_MS);
    };
    look();
  });
  reading.catch(() => {});
  try {
    return await Promise.race([reading, stopped]);
  } finally {
    clearTimeout(timer);
  }
}

// The system as DeviceUi and PluginWindow hold it: each call that moves the pointer passes
// permit first, so none can skip the dialog or Stop. `permit` asks ahead of such a call.
// After Stop the run takes nothing more from the person, the front included: Escape is typed
// only while Live is still in front, and Live isn't brought there, which `focus` refuses.
// It doesn't pass permit: a run that only captures brings Live forward too, and must not
// start asking to click. Stop may come while Live is being brought forward, so the system
// is handed the refusal, to call again just before it tells Live to activate, and before
// it types.
function guarded(system) {
  const guard = Object.create(system);
  guard.permit = () => permit(system);
  const refuseIfStopped = () => {
    const why = system.stopped();
    if (why) throw new DeviceUiError(`${why}. Live not brought to the front`);
  };
  guard.focus = async () => {
    refuseIfStopped();
    return system.focus(refuseIfStopped);
  };
  guard.escape = async () => {
    if (!system.stopped()) {
      try {
        return await system.escape(refuseIfStopped);
      } catch (error) {
        // Stopped meanwhile: as after Stop.
        if (!system.stopped()) throw error;
      }
    }
    await system.escapeIfInFront();
  };
  for (const call of POINTER_CALLS) {
    guard[call] = async (...args) => {
      await permit(system);
      return system[call](...args);
    };
  }
  return guard;
}

// How long a menu takes to open after its click.
const MENU_WAIT_MS = 2000;

// How far left of the column a menu's rows start their texts in a word can begin and still be
// text, in points. Text recognition put the texts' left edges up to 2.3 points apart, and the
// nearest icon 6.3 points left of the rightmost of them (live-notes.md).
const COLUMN_TOLERANCE = 4;

// The left edge, in pixels, that a menu's rows start their texts at: the one the most rows
// have a word at, and the rightmost of those. Text recognition reads a row's icon as a word
// left of it ("w Wander") or not at all, so the icons outnumber the texts in no column.
function textColumn(lines, tolerance) {
  let column = null, most = 0;
  for (const edge of lines.flatMap((line) => line.words.map((word) => word.x)).sort((a, b) => a - b)) {
    const rows = lines.filter((line) => line.words.some((word) => Math.abs(word.x - edge) <= tolerance)).length;
    if (rows >= most) [column, most] = [edge, rows];
  }
  return column;
}

// The menu's rows that read the item: by their words from the texts' column on, which leaves
// out an icon whatever it reads and never the start of a row's own text ("S& H" doesn't read
// "H"). Or by their whole text, for a menu with no icons whose second words line up.
function rowsReading(lines, item, tolerance) {
  const column = textColumn(lines, tolerance);
  const wanted = normalized(item);
  return lines.filter((line) => {
    const text = line.words.filter((word) => word.x >= column - tolerance).map((word) => word.text).join(" ");
    return normalized(text) === wanted || normalized(line.text) === wanted;
  });
}

// The longest drag either way, in points (ADR-0013); device-ui.swift holds the same limit.
const MAX_DRAG = 400;

// { up, right } in whole points as the helper's [dx, dy] (right, down), refused before
// anything moves when it has a fraction of a point, is under 1 point on its longer axis or
// over MAX_DRAG on either.
function dragDistance({ up = 0, right = 0 } = {}) {
  const ok = (n) => Number.isInteger(n) && Math.abs(n) <= MAX_DRAG;
  if (!ok(up) || !ok(right) || Math.max(Math.abs(up), Math.abs(right)) < 1) {
    throw new DeviceUiError(`A drag needs { up, right } in whole points, at least 1 on the longer axis and at most ${MAX_DRAG} on either. Not dragged`);
  }
  return [right, -up];
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
  // `read` reads Live's window: a press's gives up on Stop.
  async locate(read = (id) => this.system.read(id)) {
    await this.system.wake();
    this.live.send("/live/view/set/selected_track", this.track);
    this.live.send("/live/view/set/selected_device", this.track, this.device);
    await this.live.sync();
    const window = await this.system.window();
    const { width, lines } = await read(window.id);
    const scale = width / window.w; // pixels per point
    const title = findTitle(lines, this.title, INFO_VIEW_RIGHT * scale);
    return {
      window, scale, title,
      x: window.x + title.x / scale + TITLE_TO_PANEL.x - (this.plugin ? PLUGIN_TITLE_SHIFT : 0),
      y: window.y + title.y / scale + TITLE_TO_PANEL.y,
    };
  }

  async press(name, item) {
    const { window, x, y } = await this.aim(name, item);
    await this.system.click(window, x, y);
  }

  // Drags a control by { up, right } whole points with the button down, after the same checks
  // as a press (ADR-0013): a knob turns with up, a horizontal slider with right.
  async drag(name, distance) {
    const [dx, dy] = dragDistance(distance);
    const { window, x, y } = await this.aim(name);
    await this.system.drag(window, x, y, dx, dy);
  }

  // Opens the menu `name` and clicks its item `item`, confirmed by its text (ADR-0014): the
  // menu's own window is read, and exactly one row must read `item`. Whatever fails once the
  // menu's control was clicked, the menu is closed with Escape (after Stop, only while Live
  // is still in front) and nothing more is clicked. A click that Stop caught with only its
  // release left throws, and happened all the same (its error says `done`): on the control
  // it opened the menu, which is closed; on the item it chose it, and the menu has closed.
  async choose(name, item) {
    if (typeof item !== "string" || !item) throw new DeviceUiError(`Choosing from ${name} needs the item's text. Not clicked`);
    const { window, x, y } = await this.aim(name);
    const before = new Set((await this.system.windows()).map((w) => w.id));
    // Whether the menu is open: from the click on its control until the click on an item.
    let open = false;
    const click = async (opens, ...at) => {
      try {
        await this.system.click(...at);
      } catch (error) {
        if (error.done) open = opens;
        throw error;
      }
      open = opens;
    };
    try {
      await click(true, window, x, y);
      let menu;
      for (const deadline = Date.now() + MENU_WAIT_MS; !menu; await sleep(150)) {
        menu = (await this.system.windows()).find((w) => !before.has(w.id) && w.layer > 0);
        if (!menu && Date.now() > deadline) throw new DeviceUiError(`No menu opened over ${name}. Not chosen`);
      }
      const { width, lines } = await this.system.read(menu.id);
      const scale = width / menu.w;
      const rows = rowsReading(lines, item, COLUMN_TOLERANCE * scale);
      if (rows.length !== 1) {
        throw new DeviceUiError(`The menu over ${name} has ${rows.length} items reading "${item}" (it reads: ${lines.map((l) => l.text).join(", ")}). Not chosen`);
      }
      const row = rows[0];
      await click(false, menu.id, menu.x + menu.w / 2, menu.y + (row.y + row.h / 2) / scale);
    } catch (error) {
      // The failure thrown is the one that stopped the choice, not Escape's.
      if (open) {
        await this.system.escape().catch((failed) => console.error(`warn harness-computer-use couldn't close the menu over ${name}: ${failed.message}`));
      }
      throw error;
    }
  }

  // Puts the pointer on a control once the Info View names it, with Live in front, and
  // resolves with the window and the point, for the click or the drag that follows. Stop
  // during either read of Live's window rejects at once, not when the read ends.
  async aim(name, item) {
    const control = this.controls.get(name);
    if (!control) throw new DeviceUiError(`${this.title} has no control named ${name}`);
    if (!control.info) throw new DeviceUiError(`${name} has no Info View title to confirm (annotation_name, or info for a point). Not clicked`);
    const [ux, uy] = controlPoint(control, item);

    await this.system.permit();
    await this.system.focus();
    const read = (id) => readUnlessStopped(this.system, this.system.read(id));
    const at = await this.locate(read);
    const [x, y] = [at.x + ux, at.y + uy];
    await this.system.hover(at.window.id, x, y);
    await sleep(this.system.settleMs ?? INFO_VIEW_SETTLE_MS);
    const { lines } = await read(at.window.id);
    const shown = infoTitle(lines, at.title, at.scale);
    if (normalized(shown) !== normalized(control.info)) {
      throw new DeviceUiError(`The Info View reads "${shown}" over ${name}, expected "${control.info}" (is it visible?). Not clicked`);
    }
    await this.system.focus();
    return { window: at.window.id, x, y };
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
  }, guarded(system));
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
    return this.shown();
  }

  // Waits for the window, which Live shows once it is in front.
  async shown() {
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
    const [x, y] = await this.aim(name);
    await this.system.clickEditor(this.title, x, y, this.size);
  }

  // Drags a control by { up, right } whole points with the button down (ADR-0013). The helper
  // checks the start as for a click.
  async drag(name, distance) {
    const [dx, dy] = dragDistance(distance);
    const [x, y] = await this.aim(name);
    await this.system.dragEditor(this.title, x, y, this.size, dx, dy);
  }

  // The control's point in the editor, once the run may click and Live is in front.
  async aim(name) {
    const control = this.controls.get(name);
    if (!control) throw new DeviceUiError(`${this.title} has no control named ${name}`);
    if (!this.size) throw new DeviceUiError(`The size of ${this.name}'s editor isn't known: give openPluginWindow a size. Not clicked`);
    const point = controlPoint(control);
    await this.system.permit();
    await this.locate();
    return point;
  }

  // Saves a picture of the editor, without Live's title bar, to `file` (PNG), then gives the
  // front back to the app that had it. Resolves with the editor's size in points, { w, h }:
  // the size a press needs.
  async capture(file) {
    await this.system.wake();
    const before = await this.system.frontmost().catch(() => null);
    // Outside the try: a capture that didn't bring Live forward, as one refused after Stop,
    // has no front to give back.
    await this.system.focus();
    try {
      const window = await this.shown();
      const { editor } = window;
      await this.system.captureRect(window.id, window.w, [editor.x - window.x, editor.y - window.y, editor.w, editor.h], file);
      return { w: editor.w, h: editor.h };
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
  }, guarded(system));
  await window.setOpen(true);
  return window;
}

module.exports = {
  DeviceUiError, openDeviceUi, openPluginWindow, captureWindow, liveWindows, readControls, readPanelWidth, pointControls, controlPoint,
  findTitle, infoTitle, readClickHost, hostname, runName, runScript, MEASURED_DEVICES, POINTER_CALLS, MACHINE_CALLS,
  stopped, clickToken, buildComputerUse, showComputerUse, askToClick,
};
