"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DeviceUiError, openDeviceUi, readControls, readPanelWidth, pointControls, controlPoint, findTitle, infoTitle, readClickHost, runName, runScript,
  MEASURED_DEVICES, machine, POINTER_CALLS,
} = require("../device-ui.js");

const chunk = (tag, payload) => {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from(tag), size, payload]);
};

const button = (name, rect, info) => ({
  box: {
    maxclass: "live.text", presentation: 1, presentation_rect: rect, annotation_name: info,
    saved_attribute_attributes: { valueof: { parameter_longname: name } },
  },
});
const TAB = {
  box: {
    maxclass: "live.tab", presentation: 1, presentation_rect: [200, 10, 60, 46], annotation_name: "Tab",
    num_lines_presentation: 3, spacing_y: 2,
    saved_attribute_attributes: { valueof: { parameter_longname: "Tab", parameter_enum: ["A", "B", "C"] } },
  },
};
const PATCHER = {
  patcher: {
    boxes: [
      TAB,
      button("Button", [200, 70, 60, 20], "Button"),
      button("Button Two", [200, 100, 60, 20], undefined),
      { box: { maxclass: "newobj", text: "v8", patching_rect: [0, 0, 10, 10] } },
    ],
  },
};
const amxd = (patch = Buffer.from(JSON.stringify(PATCHER) + "\0")) =>
  Buffer.concat([chunk("ampf", Buffer.from("aaaa")), chunk("meta", Buffer.alloc(4)), chunk("ptch", patch)]);

const line = (text, x, y) => ({
  text, x, y, w: 100, h: 22,
  words: text.split(" ").map((word, i) => ({ text: word, x: x + i * 30 })),
});

const WINDOW = { id: 7, x: 0, y: 25, w: 1440, h: 875 };
const TITLE = "Device 2030.11.08.1";

function fakeMachine({ info = "Button", titles = [line(`> ${TITLE}`, 1800, 1400)], onFocus = () => {} } = {}) {
  const calls = [];
  return {
    calls,
    settleMs: 0,
    hostname: () => "click-mac",
    clickHost: () => "click-mac",
    wake: async () => {},
    buildComputerUse: async () => "border binary",
    showComputerUse: async () => { calls.push("border"); },
    stopped: () => false,
    focus: async () => { calls.push("focus"); onFocus(calls); },
    window: async () => WINDOW,
    read: async () => ({ width: 2880, lines: [line(info, 26, 1400), ...titles, line("text", 2000, 1560)] }),
    captureCrop: async (id, rect, file) => { calls.push(["crop", id, rect, file]); },
    hover: async (id, x, y) => { calls.push(["hover", id, x, y]); },
    click: async (id, x, y) => { calls.push(["click", id, x, y]); },
    drag: async (id, x, y, dx, dy) => { calls.push(["drag", id, x, y, dx, dy]); },
  };
}

// Makes the machine one that asks, and returns the function that stops its run, as Stop on
// the pill does.
function stoppable(system) {
  Object.assign(system, { hostname: () => "another-mac", ask: async () => true });
  return () => { system.stopped = () => true; };
}

// Runs `body` and resolves with what the harness warned meanwhile: its lines start "warn".
async function warningsOf(body) {
  const error = console.error;
  const warnings = [];
  console.error = (...said) => (String(said[0]).startsWith("warn ") ? warnings.push(said[0]) : error(...said));
  try {
    await body();
  } finally {
    console.error = error;
  }
  return warnings;
}

const fakeLive = (className = "MxDeviceAudioEffect") => ({
  send: () => {},
  sync: async () => {},
  query: async (address) => (address === "/live/device/get/class_name" ? [1, 1, className] : [1, "Drum Rack", TITLE]),
});

async function open(system) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
  const build = path.join(folder, "Device.amxd");
  fs.writeFileSync(build, amxd());
  try {
    return await openDeviceUi(fakeLive(), { track: 1, device: 1, build }, system);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

// The panel's corner in the fake window, in points, from the title at 1830 px, 1400 px.
const PANEL = { x: 1830 / 2 - 17, y: 25 + 1400 / 2 + 14 };

const clicks = (system) => system.calls.filter((call) => call[0] === "click");

test("readControls takes rectangles, Info View titles and a tab's items from the patcher", () => {
  const controls = readControls(amxd());
  assert.deepEqual([...controls.keys()], ["Tab", "Button", "Button Two"]);
  assert.equal(controls.get("Button").info, "Button");
  assert.equal(controls.get("Button").items, null);
  assert.deepEqual(controls.get("Tab").items, ["A", "B", "C"]);
});

test("readControls refuses a frozen device and a file with no patcher", () => {
  assert.throws(() => readControls(amxd(Buffer.from("mx@c...."))), DeviceUiError);
  assert.throws(() => readControls(chunk("ampf", Buffer.from("aaaa"))), DeviceUiError);
});

test("controlPoint finds a button's centre and each row of a tab", () => {
  const controls = readControls(amxd());
  assert.deepEqual(controlPoint(controls.get("Button")), [230, 80]);
  assert.deepEqual(controlPoint(controls.get("Tab"), "A"), [230, 17]);
  assert.deepEqual(controlPoint(controls.get("Tab"), "B"), [230, 33]);
  assert.deepEqual(controlPoint(controls.get("Tab"), "C"), [230, 49]);
});

test("controlPoint refuses a missing item, an item on a button and a layout it can't work out", () => {
  const controls = readControls(amxd());
  assert.throws(() => controlPoint(controls.get("Tab")), DeviceUiError);
  assert.throws(() => controlPoint(controls.get("Tab"), "Nope"), DeviceUiError);
  assert.throws(() => controlPoint(controls.get("Button"), "A"), DeviceUiError);
  assert.throws(() => controlPoint({ ...controls.get("Tab"), rows: 1 }, "A"), DeviceUiError);
});

test("findTitle uses the first word's edge, past icons read as characters, and allows misread digits", () => {
  assert.deepEqual(findTitle([line(`> ${TITLE} V`, 1800, 1400)], TITLE), { x: 1830, y: 1400 });
  assert.deepEqual(findTitle([line("Dev1ce 2O3O.11.08.I", 100, 50)], TITLE), { x: 100, y: 50 });
});

test("findTitle skips a match left of the given edge, as the browser's or the Info View's", () => {
  const lines = [line(TITLE, 26, 1400), line(TITLE, 260, 400), line(`> ${TITLE}`, 1800, 1400)];
  assert.deepEqual(findTitle(lines, TITLE, 480), { x: 1830, y: 1400 });
  assert.throws(() => findTitle(lines, TITLE), /3 times/);
});

test("findTitle matches a title Live cut short with an ellipsis by its start", () => {
  assert.deepEqual(findTitle([line("© AUD...", 567, 1450)], "AUDelay"), { x: 597, y: 1450 });
  assert.deepEqual(findTitle([line("Device 20...", 100, 50)], TITLE), { x: 100, y: 50 });
  assert.deepEqual(findTitle([line("Device 2030.11.08.1…", 100, 50)], TITLE), { x: 100, y: 50 });
});

test("findTitle refuses a shortened start that differs, is under 3 characters, or is on screen twice", () => {
  assert.throws(() => findTitle([line("AUF...", 0, 0)], "AUDelay"), /isn't on screen/);
  assert.throws(() => findTitle([line("AU...", 0, 0)], "AUDelay"), /isn't on screen/);
  assert.throws(() => findTitle([line("Device 21...", 0, 0)], TITLE), /isn't on screen/);
  assert.throws(() => findTitle([line("AUD...", 0, 0), line("AUDelay", 900, 0)], "AUDelay"), /2 times/);
});

test("findTitle refuses a title that is missing or on screen twice", () => {
  assert.throws(() => findTitle([line("Drum Rack", 0, 0)], TITLE), /isn't on screen/);
  assert.throws(() => findTitle([line(TITLE, 0, 0), line(TITLE, 900, 0)], TITLE), /2 times/);
});

test("infoTitle reads the leftmost text on the titles' row, left of the devices", () => {
  const title = { x: 1830, y: 1400 };
  assert.equal(infoTitle([line(TITLE, 1800, 1400), line("Tab", 26, 1401), line("Other", 26, 1600)], title, 2), "Tab");
  assert.equal(infoTitle([line("Drum Rack", 562, 1400)], title, 2), "");
});

test("a press clicks the control at the point worked out from the title, last, after a second focus", async () => {
  const system = fakeMachine();
  const ui = await open(system);
  await ui.press("Button");
  const expected = [7, 0 + 1800 / 2 + 15 - 17 + 230, 25 + 1400 / 2 + 14 + 80];
  assert.deepEqual(system.calls, ["focus", ["hover", ...expected], "focus", ["click", ...expected]]);
});

test("a press on a tab's item goes to its row", async () => {
  const system = fakeMachine({ info: "Tab" });
  const ui = await open(system);
  await ui.press("Tab", "C");
  assert.equal(clicks(system)[0][3], 25 + 1400 / 2 + 14 + 49);
});

test("no click when the Info View names something else or nothing", async () => {
  for (const info of ["Something", ""]) {
    const system = fakeMachine({ info });
    const ui = await open(system);
    await assert.rejects(ui.press("Button"), /Not clicked/);
    assert.equal(clicks(system).length, 0);
  }
});

test("no click when Live loses the front after the hover", async () => {
  const system = fakeMachine({
    onFocus: (calls) => { if (calls.filter((c) => c === "focus").length === 2) throw new DeviceUiError("Live isn't frontmost. Not clicked"); },
  });
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), /frontmost/);
  assert.equal(clicks(system).length, 0);
});

test("no click when the hover is refused", async () => {
  const system = fakeMachine();
  system.hover = async () => { throw new DeviceUiError("The window at the point is Finder 3, not 7"); };
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), /Finder/);
  assert.equal(clicks(system).length, 0);
});

test("no click on a control the build lacks or one with no Info View title", async () => {
  const system = fakeMachine();
  const ui = await open(system);
  await assert.rejects(ui.press("Nope"), /no control/);
  await assert.rejects(ui.press("Button Two"), /annotation_name/);
  assert.equal(system.calls.length, 0);
});

test("a press on the click host doesn't ask, and builds nothing ahead of the press", async () => {
  const system = {
    ...fakeMachine(),
    ask: async () => assert.fail("asked on the click host"),
    buildComputerUse: async () => assert.fail("built on the click host"),
  };
  const ui = await open(system);
  await ui.press("Button");
  assert.equal(clicks(system).length, 1);
});

test("a press on another machine builds, asks and shows the border it built, once, before the hover, and clicks after Allow", async () => {
  const system = fakeMachine();
  Object.assign(system, {
    hostname: () => "another-mac",
    buildComputerUse: async () => { system.calls.push("build"); return "border binary"; },
    ask: async () => { system.calls.push("ask"); return true; },
    showComputerUse: async (binary) => { system.calls.push(`border from ${binary}`); },
  });
  const ui = await open(system);
  await ui.press("Button");
  await ui.press("Button");
  assert.deepEqual(system.calls.slice(0, 3), ["build", "ask", "border from border binary"]);
  const times = (name) => system.calls.filter((call) => call === name).length;
  assert.deepEqual([times("build"), times("ask"), times("border from border binary")], [1, 1, 1]);
  assert.equal(clicks(system).length, 2);
});

test("a helper that can't be built fails the press before anyone is asked", async () => {
  const system = fakeMachine();
  Object.assign(system, {
    hostname: () => "another-mac",
    buildComputerUse: async () => { throw new DeviceUiError("swiftc failed"); },
    ask: async () => assert.fail("asked with no helper to click with"),
  });
  await assert.rejects((await open(system)).press("Button"), /swiftc failed/);
  assert.equal(system.calls.length, 0);
});

test("a border that can't be built is left out, and the run asks and clicks without it", async () => {
  const system = fakeMachine();
  Object.assign(system, { hostname: () => "another-mac", ask: async () => true, buildComputerUse: async () => null });
  await (await open(system)).press("Button");
  assert.equal(system.calls.includes("border"), false);
  assert.equal(clicks(system).length, 1);
});

test("after Stop on the pill, no press of the run hovers or clicks again", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  const ui = await open(system);
  await ui.press("Button");
  stop();
  const before = system.calls.length;
  await assert.rejects(ui.press("Button"), /stopped from its pill/);
  assert.equal(system.calls.length, before);
  assert.equal(clicks(system).length, 1);
});

test("after Stop on the pill, no press in a plug-in's window clicks", async () => {
  const system = fakePluginMachine();
  const stop = stoppable(system);
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.press("Button");
  stop();
  await assert.rejects(window.press("Button"), /stopped from its pill/);
  assert.equal(clicks(system).length, 1);
});

test("Stop between a press's hover and its click stops the click", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  const hover = system.hover;
  system.hover = async (...args) => { await hover(...args); stop(); };
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), /stopped from its pill/);
  assert.equal(clicks(system).length, 0);
});

// The machine's calls that never move the pointer or press its button, so need no permit.
const OTHER_CALLS = [
  "hostname", "clickHost", "ask", "buildComputerUse", "showComputerUse", "stopped", "wake", "focus", "window", "windows", "capture", "read", "captureCrop",
  "pluginWindow", "editor", "frontmost", "escape", "liveInFront", "typeEscape", "giveBack", "captureRect",
];

test("every call of the machine is either one that takes the pointer, which passes permit, or listed as one that never does", () => {
  assert.deepEqual(Object.keys(machine).sort(), [...POINTER_CALLS, ...OTHER_CALLS].sort());
});

test("the run is stopped once the file named as its stop marker exists", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
  const before = process.env.HARNESS_COMPUTER_USE_STOP;
  try {
    delete process.env.HARNESS_COMPUTER_USE_STOP;
    assert.equal(machine.stopped(), false);
    process.env.HARNESS_COMPUTER_USE_STOP = path.join(folder, "stopped");
    assert.equal(machine.stopped(), false);
    fs.writeFileSync(process.env.HARNESS_COMPUTER_USE_STOP, "");
    assert.equal(machine.stopped(), true);
  } finally {
    if (before === undefined) delete process.env.HARNESS_COMPUTER_USE_STOP;
    else process.env.HARNESS_COMPUTER_USE_STOP = before;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("the click host shows no border, and a border that fails to show doesn't stop the clicks", async () => {
  const host = fakeMachine();
  await (await open(host)).press("Button");
  assert.equal(host.calls.includes("border"), false);
  const other = fakeMachine();
  Object.assign(other, { hostname: () => "another-mac", ask: async () => true, showComputerUse: async () => { throw new Error("no window server"); } });
  const warnings = await warningsOf(async () => (await open(other)).press("Button"));
  assert.deepEqual(warnings, ["warn harness-computer-use couldn't show its border: no window server. The run clicks without it"]);
  assert.equal(clicks(other).length, 1);
});

test("no hover or click when the person at another machine doesn't allow it", async () => {
  const system = fakeMachine();
  Object.assign(system, { hostname: () => "another-mac", ask: async () => false });
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), /Clicks in Live on another-mac weren't allowed \(ADR-0006\)\. Not clicked/);
  assert.equal(system.calls.length, 0);
});

test("with no click host set, every machine asks", async () => {
  let asked = 0;
  const system = { ...fakeMachine(), clickHost: () => null, ask: async () => { asked += 1; return true; } };
  const ui = await open(system);
  await ui.press("Button");
  assert.equal(asked, 1);
});

test("runName names a project's check from tests/live, any other script by its file, and inline code not at all", () => {
  assert.equal(runName("/a/repo/tests/live/sub/check.js"), "tests/live/sub/check.js");
  assert.equal(runName("/a/repo/harness/cli.js"), "cli.js");
  assert.equal(runName(null), null);
});

test("runScript is null for code given with -e or -p or on stdin, whatever argument follows it", () => {
  assert.equal(runScript([], ["node", "/a/check.js"]), "/a/check.js");
  assert.equal(runScript([], ["node", "-", "a", "b"]), null);
  assert.equal(runScript([], ["node"]), null);
  assert.equal(runScript(["-e"], ["node", "/tmp/all"]), null);
  assert.equal(runScript(["--eval=1"], ["node"]), null);
  assert.equal(runScript(["-p"], ["node", "x"]), null);
  assert.equal(runScript(["-pe", "1"], ["node", "a", "b"]), null);
  assert.equal(runScript(["--enable-source-maps"], ["node", "/a/check.js"]), "/a/check.js");
});

test("the click host is read from local.json; no file or no key is none", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
  const file = path.join(folder, "local.json");
  assert.equal(readClickHost(file), null);
  fs.writeFileSync(file, '{"remote": "user@click-mac"}');
  assert.equal(readClickHost(file), null);
  fs.writeFileSync(file, '{"remote": "user@click-mac", "clickHost": "click-mac"}');
  assert.equal(readClickHost(file), "click-mac");
  fs.writeFileSync(file, "{");
  assert.throws(() => readClickHost(file), /local\.json isn't valid JSON/);
});

test("text returns the lines inside a rectangle of the panel, top first", async () => {
  const system = fakeMachine();
  const ui = await open(system);
  assert.deepEqual(await ui.text([0, 0, 190, 160]), ["text"]);
  assert.deepEqual(await ui.text([200, 0, 60, 20]), []);
});

test("captureWindow captures Live's main window, or one of Live's windows by id, and refuses another id", async () => {
  const { captureWindow } = require("../device-ui.js");
  const captured = [];
  const system = {
    wake: async () => {},
    window: async () => ({ id: 7, x: 0, y: 0, w: 800, h: 600 }),
    windows: async () => [{ id: 9, title: "Save", x: 10, y: 10, w: 300, h: 200 }, { id: 7, title: "Set", x: 0, y: 0, w: 800, h: 600 }],
    capture: async (id, file) => { captured.push([id, file]); },
  };
  assert.equal((await captureWindow("/tmp/main.png", {}, system)).id, 7);
  assert.equal((await captureWindow("/tmp/panel.png", { window: 9 }, system)).title, "Save");
  await assert.rejects(captureWindow("/tmp/other.png", { window: 4 }, system), /Live has no window 4 on screen/);
  assert.deepEqual(captured, [[7, "/tmp/main.png"], [9, "/tmp/panel.png"]]);
});

test("readPanelWidth is the right edge of the rightmost object in presentation", () => {
  assert.equal(readPanelWidth(amxd()), 260);
});

test("pointControls takes each point as a control's centre, and refuses one without x and y", () => {
  const controls = pointControls({ Knob: { x: 50, y: 36, info: "Knob" } });
  assert.deepEqual(controlPoint(controls.get("Knob")), [50, 36]);
  assert.equal(controls.get("Knob").info, "Knob");
  assert.throws(() => pointControls({ Knob: { x: 50 } }), /needs x and y/);
});

test("a press on a device given as points clicks the point from the panel's corner", async () => {
  const system = fakeMachine({ info: "Knob" });
  const ui = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Knob: { x: 50, y: 36, info: "Knob" } } }, system);
  await ui.press("Knob");
  assert.deepEqual(clicks(system), [["click", 7, PANEL.x + 50, PANEL.y + 36]]);
});

test("a plug-in's panel corner is left of its title by the two extra title-bar buttons", async () => {
  for (const className of ["AuPluginDevice", "PluginDevice"]) {
    const system = fakeMachine({ info: "Knob" });
    const ui = await openDeviceUi(fakeLive(className), { track: 1, device: 1, controls: { Knob: { x: 50, y: 36, info: "Knob" } } }, system);
    await ui.press("Knob");
    assert.deepEqual(clicks(system), [["click", 7, PANEL.x - 32 + 50, PANEL.y + 36]]);
  }
});

test("a point with no Info View title is never clicked", async () => {
  const system = fakeMachine({ info: "Knob" });
  const ui = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Knob: { x: 50, y: 36 } } }, system);
  await assert.rejects(ui.press("Knob"), /no Info View title/);
  assert.equal(system.calls.length, 0);
});

test("with neither build nor controls, a measured device's points come from its class", async () => {
  const system = fakeMachine({ info: "Filter Frequency" });
  const ui = await openDeviceUi(fakeLive("AutoFilter2"), { track: 1, device: 1 }, system);
  await ui.press("Frequency");
  const { x, y } = MEASURED_DEVICES.AutoFilter2.controls.Frequency;
  assert.deepEqual(clicks(system), [["click", 7, PANEL.x + x, PANEL.y + y]]);
  assert.equal(ui.width, MEASURED_DEVICES.AutoFilter2.width);
});

test("with neither build nor controls, a device the harness hasn't measured is refused", async () => {
  await assert.rejects(openDeviceUi(fakeLive("Compressor2"), { track: 1, device: 1 }, fakeMachine()), /no measured points for .* \(Compressor2\)/);
});

test("capture crops the window to the device's frame, in pixels, its width from the build", async () => {
  const system = fakeMachine();
  const ui = await open(system);
  await ui.capture("/out/device.png");
  const rect = [PANEL.x - 5, PANEL.y - 25 - 20, 260 + 22, 192].map((points) => String(Math.round(points * 2)));
  assert.deepEqual(system.calls, [["crop", 7, rect, "/out/device.png"]]);
});

test("capture uses the width given, and refuses a device whose width isn't known", async () => {
  const system = fakeMachine();
  const given = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: {}, width: 300 }, system);
  await given.capture("/out/device.png");
  assert.equal(system.calls[0][2][2], String((300 + 22) * 2));
  const unknown = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: {} }, system);
  await assert.rejects(unknown.capture("/out/device.png"), /give openDeviceUi a width/);
});

const pluginLive = (className = "AuPluginDevice") => ({
  sent: [],
  send(...message) { this.sent.push(message); },
  sync: async () => {},
  query: async (address) => ({
    "/live/track/get/devices/name": [0, "Plugin"],
    "/live/device/get/class_name": [0, 0, className],
    "/live/track/get/name": [0, "1-MIDI"],
  })[address],
});

const EDITOR = { id: 11, x: 40, y: 60, w: 400, h: 139, editor: { x: 40, y: 79, w: 400, h: 120 } };

function fakePluginMachine({ open = false, shown = [EDITOR] } = {}) {
  const calls = [];
  const system = {
    calls,
    hostname: () => "click-mac",
    clickHost: () => "click-mac",
    wake: async () => {},
    buildComputerUse: async () => "border binary",
    showComputerUse: async () => { calls.push("border"); },
    stopped: () => false,
    focus: async () => { calls.push("focus"); },
    pluginWindow: async (action, device) => {
      calls.push(["button", action, device]);
      if (action !== "state") open = action === "open";
      return open;
    },
    editor: async (title) => {
      calls.push(["editor", title]);
      const next = shown.length > 1 ? shown.shift() : shown[0];
      if (!next) throw new DeviceUiError(`The plug-in window ${title} isn't on screen`);
      return next;
    },
    clickEditor: async (title, x, y, size) => { calls.push(["click", title, x, y, size]); },
    dragEditor: async (title, x, y, size, dx, dy) => { calls.push(["drag", title, x, y, size, dx, dy]); },
    frontmost: async () => "com.example.terminal",
    giveBack: async (id) => { calls.push(["give back", id]); },
    captureRect: async (id, width, rect, file) => { calls.push(["capture", id, width, rect, file]); },
  };
  return system;
}

const { openPluginWindow } = require("../device-ui.js");
const PLUGIN = { track: 0, device: 0, size: [400, 120], controls: { Button: { x: 100, y: 40 } } };

test("openPluginWindow selects the device, opens its window and names it <device>/<track>", async () => {
  const live = pluginLive();
  const system = fakePluginMachine();
  const window = await openPluginWindow(live, PLUGIN, system);
  assert.equal(window.title, "Plugin/1-MIDI");
  assert.deepEqual(live.sent, [["/live/view/set/selected_track", 0], ["/live/view/set/selected_device", 0, 0]]);
  assert.deepEqual(system.calls, [["button", "open", "Plugin"]]);
});

test("openPluginWindow refuses a device that isn't a plug-in, a missing device and a bad size", async () => {
  await assert.rejects(openPluginWindow(pluginLive("AutoFilter2"), PLUGIN, fakePluginMachine()), /not a plug-in \(AutoFilter2\)/);
  await assert.rejects(openPluginWindow(pluginLive(), { ...PLUGIN, device: 3 }, fakePluginMachine()), /no device 3/);
  await assert.rejects(openPluginWindow(pluginLive(), { ...PLUGIN, size: [400] }, fakePluginMachine()), /size must be/);
});

test("a press in the editor goes to the helper with the point from the editor's corner and the size", async () => {
  const system = fakePluginMachine();
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.press("Button");
  assert.deepEqual(system.calls.slice(1), ["focus", ["editor", "Plugin/1-MIDI"], ["click", "Plugin/1-MIDI", 100, 40, [400, 120]]]);
});

test("a press waits for the window to show once Live is in front", async () => {
  const system = fakePluginMachine({ shown: [null, EDITOR] });
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.press("Button");
  assert.equal(system.calls.filter((call) => call[0] === "editor").length, 2);
  assert.equal(clicks(system).length, 1);
});

test("no press without a size, on an unknown control, or when the person at another machine says no", async () => {
  const system = fakePluginMachine();
  const sizeless = await openPluginWindow(pluginLive(), { ...PLUGIN, size: undefined }, system);
  await assert.rejects(sizeless.press("Button"), /give openPluginWindow a size/);
  await assert.rejects(sizeless.press("Nope"), /no control named Nope/);
  Object.assign(system, { hostname: () => "another-mac", ask: async () => false });
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await assert.rejects(window.press("Button"), /weren't allowed/);
  assert.equal(clicks(system).length, 0);
});

test("capture crops to the editor, in points from the window's corner, gives the front back and resolves with the size", async () => {
  const system = fakePluginMachine();
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  assert.deepEqual(await window.capture("/out/editor.png"), { w: 400, h: 120 });
  assert.deepEqual(system.calls.slice(-2), [["capture", 11, 400, [0, 19, 400, 120], "/out/editor.png"], ["give back", "com.example.terminal"]]);
});

test("close asks the helper to close the window", async () => {
  const system = fakePluginMachine();
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.close();
  assert.deepEqual(system.calls.at(-1), ["button", "close", "Plugin"]);
});

test("a drag goes from the control's point after the Info View check, up as negative dy", async () => {
  const system = fakeMachine();
  const ui = await open(system);
  await ui.drag("Button", { up: 40 });
  const point = [7, 0 + 1800 / 2 + 15 - 17 + 230, 25 + 1400 / 2 + 14 + 80];
  assert.deepEqual(system.calls, ["focus", ["hover", ...point], "focus", ["drag", ...point, 0, -40]]);
});

test("no drag when the Info View names something else", async () => {
  const system = fakeMachine({ info: "Something" });
  const ui = await open(system);
  await assert.rejects(ui.drag("Button", { up: 40 }), /Not clicked/);
  assert.equal(system.calls.some((call) => call[0] === "drag"), false);
});

test("a drag that is under 1 point, too long or a fraction of a point is refused before the pointer moves", async () => {
  const system = fakeMachine();
  const ui = await open(system);
  for (const distance of [{}, { up: 0, right: 0 }, { up: 401 }, { right: -500 }, { up: Number.NaN },
    { up: 0.4 }, { right: -0.9 }, { up: -1e-15 }, { up: 0.5, right: 0.5 }, { up: 1.4 }, { up: 10.5 }, { right: 7.5, up: -3 }]) {
    await assert.rejects(ui.drag("Button", distance), /in whole points, at least 1 on the longer axis and at most 400 on either\. Not dragged/);
  }
  assert.equal(system.calls.length, 0);
});

test("a drag in a plug-in's editor goes to the helper with the point, the size and right, down", async () => {
  const system = fakePluginMachine();
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.drag("Button", { right: -60, up: 10 });
  assert.deepEqual(system.calls.at(-1), ["drag", "Plugin/1-MIDI", 100, 40, [400, 120], -60, -10]);
});

test("after Stop on the pill, no drag", async () => {
  const system = fakePluginMachine();
  const stop = stoppable(system);
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.drag("Button", { up: 10 });
  stop();
  await assert.rejects(window.drag("Button", { up: 10 }), /stopped from its pill/);
  assert.equal(system.calls.filter((call) => call[0] === "drag").length, 1);
});

// A device whose menu control opens a window of its own, as a Live chooser does.
function menuMachine(rows, { opens = true, front = true } = {}) {
  const system = fakeMachine({ info: "Menu" });
  const menu = { id: 9, title: "", layer: 101, x: 600, y: 900, w: 88, h: 122 };
  let open = false;
  Object.assign(system, {
    windows: async () => (open ? [menu, { ...WINDOW, layer: 0 }] : [{ ...WINDOW, layer: 0 }]),
    click: async (id, x, y) => { system.calls.push(["click", id, x, y]); if (id === 7 && opens) open = true; },
    escape: async () => { system.calls.push("escape"); },
    liveInFront: async () => front,
    typeEscape: async () => { system.calls.push("typeEscape"); },
  });
  const read = system.read;
  system.read = async (id) => (id === 9 ? { width: 176, lines: rows } : read(id));
  return system;
}

// A menu's row as text recognition reads it: its words, each with its left edge in pixels.
const row = (y, ...words) => ({
  text: words.map(([text]) => text).join(" "), x: words[0][1], y, w: 160, h: 24,
  words: words.map(([text, x]) => ({ text, x })),
});
// As read from a chooser's menu in Live, 176 pixels wide: each icon a word left of the column
// the rows' texts start in, and one row's icon not read.
const MENU_ROWS = [
  row(4, ["N", 10], ["Sine", 47.5]),
  row(34, ["Saw", 46.4]),
  row(184, ["w", 8], ["Wander", 48.5]),
  row(214, ["JF", 8], ["S&", 45.5], ["H", 85.5]),
];

test("choose opens the menu after the Info View check and clicks the row reading the item", async () => {
  const system = menuMachine(MENU_ROWS);
  const ui = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Menu: { x: 10, y: 10, info: "Menu" } } }, system);
  await ui.choose("Menu", "Wander");
  assert.deepEqual(clicks(system).at(-1), ["click", 9, 600 + 88 / 2, 900 + (184 + 12) / 2]);
  assert.equal(clicks(system).length, 2);
});

test("choose closes the menu and clicks nothing more when no row, or two, read the item", async () => {
  for (const rows of [MENU_ROWS, [...MENU_ROWS, row(244, ["Wander", 47])]]) {
    const system = menuMachine(rows);
    const ui = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Menu: { x: 10, y: 10, info: "Menu" } } }, system);
    await assert.rejects(ui.choose("Menu", rows === MENU_ROWS ? "Triangle" : "Wander"), /Not chosen/);
    assert.equal(clicks(system).length, 1);
    assert.equal(system.calls.at(-1), "escape");
  }
});

test("choose refuses when no menu opens", async () => {
  const system = menuMachine(MENU_ROWS, { opens: false });
  const ui = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Menu: { x: 10, y: 10, info: "Menu" } } }, system);
  await assert.rejects(ui.choose("Menu", "Wander"), /No menu opened/);
});

const openMenu = (system) => openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Menu: { x: 10, y: 10, info: "Menu" } } }, system);

// Chooses `item` from a menu reading `rows`, and resolves with the y of the row clicked.
async function chosenRow(rows, item) {
  const system = menuMachine(rows);
  await (await openMenu(system)).choose("Menu", item);
  assert.equal(clicks(system).length, 2);
  return (clicks(system).at(-1)[3] - 900) * 2 - 12;
}

test("choose takes a row's text from the column the rows' texts start in, leaving out the icon left of it", async () => {
  const refused = menuMachine(MENU_ROWS);
  await assert.rejects((await openMenu(refused)).choose("Menu", "H"), /0 items reading "H"/);
  assert.equal(clicks(refused).length, 1);
  for (const [item, y] of [["Sine", 4], ["Saw", 34], ["Wander", 184], ["S& H", 214]]) {
    assert.equal(await chosenRow(MENU_ROWS, item), y);
  }
});

test("choose never takes the start of a row's own text as its icon, however short", async () => {
  const rows = [
    row(4, ["N", 10], ["Sine", 47.5]),
    row(34, ["w", 8], ["Wander", 48.5]),
    row(64, ["S&", 45.5], ["H", 85.5]),
    row(94, ["Hi", 46], ["Shelf", 70]),
  ];
  for (const item of ["H", "Shelf"]) {
    const system = menuMachine(rows);
    await assert.rejects((await openMenu(system)).choose("Menu", item), new RegExp(`0 items reading "${item}"`));
    assert.equal(clicks(system).length, 1);
  }
  assert.equal(await chosenRow(rows, "S& H"), 64);
  assert.equal(await chosenRow(rows, "Hi Shelf"), 94);
});

test("choose leaves out an icon whatever it reads: three characters, two words, or close to the text", async () => {
  const rows = [
    row(4, ["==>", 8], ["Ramp", 48], ["Down", 108]),
    row(34, ["-", 9], ["1", 20], ["Ramp", 48.5], ["Up", 109]),
    row(64, ["•", 35.9], ["Triangle", 46.9]),
    row(94, ["Saw", 43.9]),
  ];
  for (const [item, y] of [["Ramp Down", 4], ["Ramp Up", 34], ["Triangle", 64], ["Saw", 94]]) {
    assert.equal(await chosenRow(rows, item), y);
  }
});

test("choose finds the texts' column when every icon is read and when the menu has none", async () => {
  const icons = [row(4, ["/", 10], ["Sine", 47.5]), row(34, ["^", 11.9], ["Triangle", 47.6]), row(64, ["1", 16], ["Saw", 48.5])];
  assert.equal(await chosenRow(icons, "Triangle"), 34);
  const plain = [row(4, ["Low", 46], ["Pass", 80]), row(34, ["Band", 46], ["Pass", 92]), row(64, ["Notch", 46])];
  assert.equal(await chosenRow(plain, "Low Pass"), 4);
  const system = menuMachine(plain);
  await assert.rejects((await openMenu(system)).choose("Menu", "Pass"), /0 items reading "Pass"/);
});

test("choose closes the menu when its read fails or its item's click is refused", async () => {
  const reading = menuMachine(MENU_ROWS);
  const read = reading.read;
  reading.read = async (id) => { if (id === 9) throw new DeviceUiError("could not create image from window"); return read(id); };
  await assert.rejects((await openMenu(reading)).choose("Menu", "Wander"), /could not create image/);
  assert.equal(reading.calls.at(-1), "escape");

  const clicking = menuMachine(MENU_ROWS);
  const click = clicking.click;
  clicking.click = async (id, x, y) => { if (id === 9) throw new DeviceUiError("The window at the point is Finder 3, not 9"); return click(id, x, y); };
  await assert.rejects((await openMenu(clicking)).choose("Menu", "Wander"), /Finder 3/);
  assert.equal(clicking.calls.at(-1), "escape");
});

test("choose refuses a missing item before anything is clicked", async () => {
  const system = menuMachine(MENU_ROWS);
  const ui = await openMenu(system);
  for (const item of [undefined, "", 3]) {
    await assert.rejects(ui.choose("Menu", item), (error) => error instanceof DeviceUiError && /Not clicked/.test(error.message));
  }
  assert.equal(system.calls.length, 0);
});

// Stops the run while choose reads the menu it opened, and resolves with the system's calls.
async function stoppedWhileReading(front) {
  const system = menuMachine(MENU_ROWS, { front });
  const stop = stoppable(system);
  const read = system.read;
  system.read = async (id) => { if (id === 9) stop(); return read(id); };
  await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), /stopped from its pill/);
  assert.equal(clicks(system).length, 1);
  return system.calls;
}

test("Stop while choose reads the menu closes it with Live still in front, without bringing Live forward", async () => {
  const calls = await stoppedWhileReading(true);
  assert.equal(calls.at(-1), "typeEscape");
  assert.equal(calls.includes("escape"), false);
});

test("Stop while choose reads the menu types nothing once Live is no longer in front", async () => {
  const calls = await stoppedWhileReading(false);
  assert.equal(calls.includes("typeEscape"), false);
  assert.equal(calls.includes("escape"), false);
});

test("choose keeps its failure, with a warning, when Escape fails too", async () => {
  const system = menuMachine(MENU_ROWS);
  system.escape = async () => { throw new Error("System Events got an error"); };
  const warnings = [];
  const warn = console.error;
  console.error = (message) => warnings.push(message);
  try {
    await assert.rejects((await openMenu(system)).choose("Menu", "Triangle"), /0 items reading "Triangle"/);
  } finally {
    console.error = warn;
  }
  assert.match(warnings.join("\n"), /couldn't close the menu over Menu: System Events got an error/);
});

test("Stop between choose's Info View check and its opening click stops the click", async () => {
  const system = menuMachine(MENU_ROWS);
  const stop = stoppable(system);
  const windows = system.windows;
  system.windows = async () => { stop(); return windows(); };
  await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), /stopped from its pill/);
  assert.equal(clicks(system).length, 0);
});

const tools = require("../tools.js");

// Runs `body` with the build of the Swift source named `failing` failing, and every other
// build resolving with its source's name. Resolves with what was warned meanwhile.
async function withBuilds(failing, body) {
  const [build, warn] = [tools.helperBinary, console.error];
  const warnings = [];
  tools.helperBinary = async (source) => {
    if (path.basename(source) === failing) throw new Error(`swiftc failed on ${failing}\n  error: the rest of what the compiler said`);
    return path.basename(source, ".swift");
  };
  console.error = (message) => warnings.push(message);
  try {
    await body();
  } finally {
    [tools.helperBinary, console.error] = [build, warn];
  }
  return warnings;
}

test("buildComputerUse resolves with the border's binary once the helper and the border are built", async () => {
  const warnings = await withBuilds(null, async () => assert.equal(await machine.buildComputerUse(), "computer-use-overlay"));
  assert.deepEqual(warnings, []);
});

test("buildComputerUse warns and resolves with no border when only the border can't be built", async () => {
  const warnings = await withBuilds("computer-use-overlay.swift", async () => assert.equal(await machine.buildComputerUse(), null));
  assert.deepEqual(warnings, ["warn harness-computer-use couldn't show its border: swiftc failed on computer-use-overlay.swift. The run clicks without it"]);
});

test("buildComputerUse rejects when the helper can't be built", async () => {
  const warnings = await withBuilds("device-ui.swift", async () => {
    await assert.rejects(machine.buildComputerUse(), (error) => error instanceof DeviceUiError && /swiftc failed on device-ui\.swift/.test(error.message));
  });
  assert.deepEqual(warnings, []);
});

// A stand-in for the overlay: a shell script of `lines`, run with the overlay's arguments,
// that first writes its pid beside itself. Returns its path.
const STAND_INS = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
process.on("exit", () => fs.rmSync(STAND_INS, { recursive: true, force: true }));
let standIns = 0;
function standIn(...lines) {
  const file = path.join(STAND_INS, `overlay-${standIns++}`);
  fs.writeFileSync(file, ["#!/bin/sh", 'echo $$ > "$0.pid"', ...lines, ""].join("\n"), { mode: 0o755 });
  return file;
}
// Stays until the run it was given, its first argument, has gone, as the overlay does.
const STAYS = 'while kill -0 "$1" 2>/dev/null; do sleep 0.1; done';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(done) {
  for (const deadline = Date.now() + 3000; !done(); await pause(20)) {
    if (Date.now() > deadline) throw new Error("Not within 3 s");
  }
}
const gone = (file) => {
  const pid = Number(fs.readFileSync(`${file}.pid`, "utf8"));
  try { process.kill(pid, 0); return false; } catch { return true; }
};

test("showComputerUse resolves once the border says it has shown, having given it the stop marker the run reads", async () => {
  const slow = standIn("sleep 0.3", ': > "$0.shown"', "echo shown", ': > "$2"', STAYS);
  try {
    const warnings = await warningsOf(async () => {
      await machine.showComputerUse(slow);
      assert.equal(fs.existsSync(`${slow}.shown`), true);
      await until(() => machine.stopped());
    });
    assert.deepEqual(warnings, []);
  } finally {
    delete process.env.HARNESS_COMPUTER_USE_STOP;
  }
});

test("showComputerUse rejects with the reason a border gives as it ends, or else with how it ended", async () => {
  const sessionless = standIn("echo a line from the system >&2", "echo this process has no desktop session >&2", "exit 1");
  await assert.rejects(machine.showComputerUse(sessionless), { message: "this process has no desktop session" });
  await assert.rejects(machine.showComputerUse(standIn("exit 1")), { message: "it ended with status 1" });
  await assert.rejects(machine.showComputerUse(standIn("kill -9 $$")), { message: "it ended with SIGKILL" });
});

test("showComputerUse ends a border that says nothing in time, and rejects", async () => {
  const silent = standIn("exec sleep 30");
  await assert.rejects(machine.showComputerUse(silent, { shownMs: 500 }), { message: "it didn't show within 500 ms" });
  await until(() => gone(silent));
});

test("a border that goes after it has shown is warned of once, unless it ended as it does by itself", async () => {
  for (const [ends, warning] of [
    [["sleep 0.2", "exit 1"], "warn harness-computer-use's border has gone (status 1). The run clicks without it"],
    [["exit 1"], "warn harness-computer-use's border has gone (status 1). The run clicks without it"],
    [["sleep 0.2", "kill -9 $$"], "warn harness-computer-use's border has gone (SIGKILL). The run clicks without it"],
    [["sleep 0.2", "exit 0"], null],
  ]) {
    const shown = standIn("echo shown", ...ends);
    const warnings = await warningsOf(async () => {
      await machine.showComputerUse(shown);
      await until(() => gone(shown));
      await pause(100);
    });
    assert.deepEqual(warnings, warning ? [warning] : []);
  }
});

test("a run that has shown its border still ends by itself", async () => {
  const run = `require(${JSON.stringify(path.join(__dirname, "..", "device-ui.js"))}).machine.showComputerUse(process.argv[1]).then(() => console.log("shown"))`;
  const printed = await new Promise((resolve, reject) => {
    require("node:child_process").execFile(process.execPath, ["-e", run, standIn("echo shown", STAYS)], { timeout: 10000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
  assert.equal(printed, "shown\n");
});

const hasDeveloperTools = (() => {
  try { require("node:child_process").execFileSync("xcode-select", ["-p"], { stdio: "ignore" }); return true; } catch { return false; }
})();

// Runs the real helper, built with swiftc if it isn't cached. A drag refused for its distance
// posts no event; nor would one that got past that check, as no window has the id -1.
test("the helper refuses a drag under 1 point or by a fraction of a point", { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async () => {
  const helper = await tools.helperBinary(path.join(__dirname, "..", "device-ui.swift"));
  for (const [dx, dy] of [[0, -1e-15], [0, -0.4], [0.9, 0], [0.5, -0.5], [0, -1.4], [0, -10.5], [7.5, -3]]) {
    await assert.rejects(tools.run(helper, ["drag", -1, 100, 100, dx, dy]), /whole points, at least 1 on its longer axis and at most 400 on either/);
  }
});
