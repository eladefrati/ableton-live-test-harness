"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DeviceUiError, openDeviceUi, readControls, readPanelWidth, pointControls, controlPoint, findTitle, infoTitle, readClickHost, runName,
  MEASURED_DEVICES,
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
    focus: async () => { calls.push("focus"); onFocus(calls); },
    window: async () => WINDOW,
    read: async () => ({ width: 2880, lines: [line(info, 26, 1400), ...titles, line("text", 2000, 1560)] }),
    captureCrop: async (id, rect, file) => { calls.push(["crop", id, rect, file]); },
    hover: async (id, x, y) => { calls.push(["hover", id, x, y]); },
    click: async (id, x, y) => { calls.push(["click", id, x, y]); },
  };
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

test("a press on the click host doesn't ask", async () => {
  const system = { ...fakeMachine(), ask: async () => assert.fail("asked on the click host") };
  const ui = await open(system);
  await ui.press("Button");
  assert.equal(clicks(system).length, 1);
});

test("a press on another machine asks once, before the hover, and clicks after Allow", async () => {
  const system = fakeMachine();
  Object.assign(system, { hostname: () => "another-mac", ask: async () => { system.calls.push("ask"); return true; } });
  const ui = await open(system);
  await ui.press("Button");
  await ui.press("Button");
  assert.equal(system.calls.filter((call) => call === "ask").length, 1);
  assert.equal(system.calls[0], "ask");
  assert.equal(clicks(system).length, 2);
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

test("runName names a project's check from tests/live, and any other script by its file", () => {
  assert.equal(runName("/a/repo/tests/live/sub/check.js"), "tests/live/sub/check.js");
  assert.equal(runName("/a/repo/harness/cli.js"), "cli.js");
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
