"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DeviceUiError, openDeviceUi, readControls, readPanelWidth, pointControls, controlPoint, findTitle, infoTitle, readClickHost, runName, runScript,
  MEASURED_DEVICES, POINTER_CALLS, MACHINE_CALLS, stopped, clickToken, buildComputerUse, showComputerUse, liveWindows, askToClick, stopKeyOf,
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
    stopped: () => null,
    focus: async () => { calls.push("focus"); onFocus(calls); },
    window: async () => WINDOW,
    read: async () => ({ width: 2880, lines: [line(info, 26, 1400), ...titles, line("text", 2000, 1560)] }),
    captureRect: async (id, width, rect, file) => { calls.push(["capture", id, width, rect, file]); },
    hover: async (id, x, y) => { calls.push(["hover", id, x, y]); },
    click: async (id, x, y) => { calls.push(["click", id, x, y]); },
    drag: async (id, x, y, dx, dy) => { calls.push(["drag", id, x, y, dx, dy]); },
  };
}

// What a run says once Stop on its pill has removed its click token, and once it can't tell
// that it wasn't stopped, for a reason.
const STOPPED = "harness-computer-use was stopped from its pill: this run clicks no more";
const cantTell = (why) => `harness-computer-use can't tell that it wasn't stopped (${why}), which counts as stopped: this run clicks no more`;

// Makes the machine one that asks, and returns the function that stops its run, as Stop on
// the pill does.
function stoppable(system) {
  Object.assign(system, { hostname: () => "another-mac", ask: async () => true });
  return () => { system.stopped = () => STOPPED; };
}

// The error of a click or a drag that Stop caught with only its release left (ADR-0012).
const happened = () => Object.assign(new DeviceUiError(STOPPED), { done: true });
const isHappened = (error) => error instanceof DeviceUiError && error.done === true && /stopped from its pill/.test(error.message);

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

test("the run gives the dialog its border's program, or null when none was built", async () => {
  for (const binary of ["border binary", null]) {
    const system = fakeMachine();
    const told = [];
    Object.assign(system, { hostname: () => "another-mac", buildComputerUse: async () => binary, ask: async (...given) => { told.push(given); return true; } });
    await (await open(system)).press("Button");
    assert.deepEqual(told, [[binary]]);
  }
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

test("Stop between a press's hover and its click stops the click, and Live isn't brought to the front again", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  const hover = system.hover;
  system.hover = async (...args) => { await hover(...args); stop(); };
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), (error) => error instanceof DeviceUiError && /stopped from its pill/.test(error.message));
  assert.equal(clicks(system).length, 0);
  assert.equal(system.calls.at(-1)[0], "hover");
});

// A machine whose read of Live's window, once `slow()` says so, takes until the test ends it,
// or 3 s at most, as a read in Live does, with Stop 50 ms into it. `reading` is that read;
// `finish` ends it.
function slowRead(system, stop, slow) {
  const read = system.read;
  const held = { reading: null, finish: null };
  system.read = (...args) => {
    if (!slow() || held.reading) return read(...args);
    setTimeout(stop, 50);
    const fallback = setTimeout(() => held.finish(), 3000);
    held.reading = new Promise((resolve) => {
      held.finish = () => { clearTimeout(fallback); resolve(); };
    }).then(() => read(...args));
    return held.reading;
  };
  return held;
}

test("Stop while a press finds the device stops it at once, before the hover", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  const ui = await open(system);
  await ui.press("Button");
  const held = slowRead(system, stop, () => true);
  const before = system.calls.length;
  const start = Date.now();
  await assert.rejects(ui.press("Button"), { message: `${STOPPED}. Not clicked` });
  const ms = Date.now() - start;
  held.finish();
  await held.reading;
  assert.ok(ms < 1000, `the press threw ${ms} ms after it started`);
  assert.deepEqual(system.calls.slice(before), ["focus"]);
});

test("Stop during a press's Info View read stops the press at once, not when the read ends", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  const hover = system.hover;
  let hovered = false;
  system.hover = async (...args) => { await hover(...args); hovered = true; };
  const held = slowRead(system, stop, () => hovered);
  const ui = await open(system);
  const start = Date.now();
  await assert.rejects(ui.press("Button"), { message: `${STOPPED}. Not clicked` });
  const ms = Date.now() - start;
  held.finish();
  await held.reading;
  assert.ok(ms < 1000, `the press threw ${ms} ms after it started`);
  assert.equal(clicks(system).length, 0);
});

test("a press stopped before it finds the device starts no read", async () => {
  let stop;
  // Stop as Live is brought to the front, before the read that finds the device.
  const system = fakeMachine({ onFocus: () => stop() });
  stop = stoppable(system);
  const read = system.read;
  let reads = 0;
  system.read = (...args) => { reads += 1; return read(...args); };
  const ui = await open(system);
  reads = 0;
  await assert.rejects(ui.press("Button"), { message: `${STOPPED}. Not clicked` });
  assert.equal(reads, 0);
  assert.equal(system.calls.some((call) => call[0] === "hover"), false);
});

test("a press stopped before its Info View read starts none", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  const [hover, read] = [system.hover, system.read];
  let reads = 0;
  system.hover = async (...args) => { await hover(...args); stop(); };
  system.read = (...args) => { reads += 1; return read(...args); };
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), { message: `${STOPPED}. Not clicked` });
  assert.equal(reads, 1);
  assert.equal(clicks(system).length, 0);
});

test("Stop that comes while a press brings Live forward is seen by the function the machine is handed, which it calls before it activates Live", async () => {
  const system = fakeMachine();
  const stop = stoppable(system);
  let stopping = false;
  system.focus = async (refuse) => {
    if (stopping) stop();
    refuse();
    system.calls.push("focus");
  };
  const ui = await open(system);
  await ui.press("Button");
  stopping = true;
  const before = system.calls.length;
  await assert.rejects(ui.press("Button"), { message: `${STOPPED}. Live not brought to the front` });
  assert.equal(system.calls.length, before);
});

test("a press and a drag that Stop caught with only the release left reject with that error, which says done", async () => {
  const system = fakeMachine();
  system.click = system.drag = async () => { throw happened(); };
  const ui = await open(system);
  await assert.rejects(ui.press("Button"), isHappened);
  await assert.rejects(ui.drag("Button", { up: 40 }), isHappened);
  const editor = fakePluginMachine();
  editor.clickEditor = editor.dragEditor = async () => { throw happened(); };
  const window = await openPluginWindow(pluginLive(), PLUGIN, editor);
  await assert.rejects(window.press("Button"), isHappened);
  await assert.rejects(window.drag("Button", { up: 10 }), isHappened);
});

// The machine's calls that never move the pointer or press its button, so need no permit.
const OTHER_CALLS = [
  "hostname", "clickHost", "ask", "buildComputerUse", "showComputerUse", "stopped", "wake", "focus", "window", "windows", "capture", "read",
  "pluginWindow", "editor", "frontmost", "escape", "escapeIfInFront", "waitForNoModifiers", "giveBack", "captureRect",
];

test("every call of the machine is either one that takes the pointer, which passes permit, or listed as one that never does", () => {
  assert.deepEqual([...MACHINE_CALLS].sort(), [...POINTER_CALLS, ...OTHER_CALLS].sort());
});

test("the module exports nothing that carries a call that takes the pointer, which would skip permit", () => {
  for (const [name, exported] of Object.entries(require("../device-ui.js"))) {
    for (const call of POINTER_CALLS) assert.equal(call in Object(exported), false, `${name}.${call}`);
  }
});

test("the run's click token exists from when it is first asked for, and is never made again: once it is gone the run stays stopped", () => {
  const token = clickToken();
  try {
    assert.equal(fs.existsSync(token), true);
    assert.equal(stopped(), null);
    fs.rmSync(token);
    assert.equal(clickToken(), token);
    assert.equal(fs.existsSync(token), false);
    assert.equal(stopped(), STOPPED);
  } finally {
    // The test's own repair, for the tests after it: a run never does this.
    fs.writeFileSync(token, "");
  }
});

test("a run may click while its token can be read and the token's folder written to, and every loss counts as stopped and says which it was", () => {
  const folderOf = path.dirname;
  for (const [lose, said] of [
    [(token) => fs.rmSync(token), () => STOPPED],
    [(token) => fs.rmSync(folderOf(token), { recursive: true }), (token) => cantTell(`the token's folder ${folderOf(token)} is gone`)],
    [(token) => fs.chmodSync(folderOf(token), 0o500), (token) => cantTell(`the folder ${folderOf(token)} can't be written to, so Stop couldn't remove the token`)],
    [(token) => fs.chmodSync(folderOf(token), 0o600), (token) => cantTell(`the folder ${folderOf(token)} can't be written to, so Stop couldn't remove the token`)],
    [(token) => fs.chmodSync(token, 0o000), (token) => cantTell(`the token ${token} can't be read`)],
  ]) {
    const token = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-")), "token");
    fs.writeFileSync(token, "");
    try {
      assert.equal(stopped(token), null);
      lose(token);
      assert.equal(stopped(token), said(token));
    } finally {
      if (fs.existsSync(folderOf(token))) fs.chmodSync(folderOf(token), 0o700);
      fs.rmSync(folderOf(token), { recursive: true, force: true });
    }
  }
});

test("a press of a run that can't tell that it wasn't stopped says why, and neither hovers nor clicks", async () => {
  const system = fakeMachine();
  const why = cantTell("the token's folder /tmp/harness-computer-use-1 is gone");
  Object.assign(system, { hostname: () => "another-mac", ask: async () => true, stopped: () => why });
  await assert.rejects((await open(system)).press("Button"), { message: `${why}. Not clicked` });
  assert.deepEqual(system.calls, ["border"]);
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

test("the click host is read from local.json; no file or no key is none", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
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

// A device's title `x`, `y` pixels into the window's capture, and where its frame then starts,
// in points from the window's top. The device the other tests press is too low in the window
// for a capture: its frame, 192 points high, ends 11 points below the window.
const titleAt = (x, y) => ({ titles: [line(`> ${TITLE}`, x, y)] });
const frameTop = (y) => y / 2 + 14 - 20;

test("capture crops the window to the device's frame, in points from the window's corner, its width from the build", async () => {
  const system = fakeMachine(titleAt(1800, 1300));
  const ui = await open(system);
  await ui.capture("/out/device.png");
  assert.deepEqual(system.calls, [["capture", 7, 1440, [PANEL.x - 5, frameTop(1300), 260 + 22, 192], "/out/device.png"]]);
});

test("capture uses the width given, and refuses a device whose width isn't known", async () => {
  const system = fakeMachine(titleAt(1800, 1300));
  const given = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: {}, width: 300 }, system);
  await given.capture("/out/device.png");
  assert.equal(system.calls[0][3][2], 300 + 22);
  const unknown = await openDeviceUi(fakeLive(), { track: 1, device: 1, controls: {} }, system);
  await assert.rejects(unknown.capture("/out/device.png"), /give openDeviceUi a width/);
});

test("capture takes a device whose frame ends at the window's edge", async () => {
  // The frame's bottom at 875 points, the window's height.
  const system = fakeMachine(titleAt(1800, 1378));
  await (await open(system)).capture("/out/device.png");
  assert.deepEqual(system.calls.map((call) => call[3][1] + call[3][3]), [875]);
});

test("capture refuses a device whose frame isn't wholly inside Live's window, naming it and saying to bring it into view, and captures nothing", async () => {
  // Below the window's bottom edge, past its right edge, and above its top.
  for (const where of [titleAt(1800, 1400), titleAt(2400, 1300), titleAt(1800, 10)]) {
    const system = fakeMachine(where);
    const ui = await open(system);
    await assert.rejects(ui.capture("/out/device.png"), (error) => error instanceof DeviceUiError
      && error.message === `${TITLE} isn't wholly inside Live's window: bring the whole device into view. Not captured`);
    assert.deepEqual(system.calls, []);
  }
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
    stopped: () => null,
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

const gaveBack = (system) => system.calls.filter((call) => call[0] === "give back").map((call) => call[1]);

test("after Stop, a capture of a plug-in's window throws as stopped: Live isn't brought to the front, and the front is given back to no app", async () => {
  const system = fakePluginMachine();
  const stop = stoppable(system);
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  stop();
  await assert.rejects(window.capture("/out/editor.png"), (error) => error instanceof DeviceUiError && /stopped from its pill/.test(error.message));
  assert.equal(system.calls.includes("focus"), false);
  assert.equal(system.calls.some((call) => call[0] === "capture"), false);
  assert.deepEqual(gaveBack(system), []);
});

test("a capture gives the front back when it fails once Live is in front, and to no app when Live couldn't be brought there", async () => {
  const behind = fakePluginMachine();
  behind.focus = async () => { throw new DeviceUiError("Live isn't frontmost. Not clicked"); };
  await assert.rejects((await openPluginWindow(pluginLive(), PLUGIN, behind)).capture("/out/editor.png"), /isn't frontmost/);
  assert.deepEqual(gaveBack(behind), []);

  const unread = fakePluginMachine();
  unread.captureRect = async () => { throw new DeviceUiError("could not create image from window"); };
  await assert.rejects((await openPluginWindow(pluginLive(), PLUGIN, unread)).capture("/out/editor.png"), /could not create image/);
  assert.deepEqual(gaveBack(unread), ["com.example.terminal"]);
});

// Runs `body` on the machine itself, with a stand-in for its helper and for what it asks of
// macOS: `activate` takes the place of macos.js's.
async function withMachine(activate, body) {
  const real = { frontmostApp: mac.frontmostApp, giveBackFront: mac.giveBackFront, activate: mac.activate };
  Object.assign(mac, { frontmostApp: async () => "com.example.terminal", giveBackFront: async () => {}, activate });
  try {
    return await withHelper([`echo '{"open": true}'`], body);
  } finally {
    Object.assign(mac, real);
  }
}

test("the machine hands the function that refuses once the run is stopped on to the activation of Live", async () => {
  const token = clickToken();
  let activated = false;
  // As macos.js does: it calls the function just before it tells Live to activate. Here Stop
  // has come by then.
  const activate = async ({ refuse }) => {
    fs.rmSync(token);
    refuse();
    activated = true;
  };
  try {
    await withMachine(activate, async () => {
      const window = await openPluginWindow(pluginLive(), PLUGIN);
      await assert.rejects(window.capture("/out/editor.png"), { message: `${STOPPED}. Live not brought to the front` });
    });
    assert.equal(activated, false);
  } finally {
    fs.writeFileSync(token, "");
  }
});

test("a capture of a plug-in's window brings Live to the front without asking to click", async () => {
  const system = fakePluginMachine();
  Object.assign(system, { hostname: () => "another-mac", ask: async () => assert.fail("asked to click for a capture") });
  const window = await openPluginWindow(pluginLive(), PLUGIN, system);
  await window.capture("/out/editor.png");
  assert.equal(system.calls.includes("focus"), true);
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
function menuMachine(rows, { opens = true } = {}) {
  const system = fakeMachine({ info: "Menu" });
  const menu = { id: 9, title: "", layer: 101, x: 600, y: 900, w: 88, h: 122 };
  let open = false;
  Object.assign(system, {
    windows: async () => (open ? [menu, { ...WINDOW, layer: 0 }] : [{ ...WINDOW, layer: 0 }]),
    click: async (id, x, y) => { system.calls.push(["click", id, x, y]); if (id === 7 && opens) open = true; },
    escape: async () => { system.calls.push("escape"); },
    escapeIfInFront: async () => { system.calls.push("escapeIfInFront"); },
    waitForNoModifiers: async (ms) => { system.calls.push(["waitForNoModifiers", ms]); return true; },
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

test("Stop while choose reads the menu leaves its closing to the one call that types Escape only if Live is in front, without bringing Live forward", async () => {
  const system = menuMachine(MENU_ROWS);
  const stop = stoppable(system);
  const read = system.read;
  system.read = async (id) => { if (id === 9) stop(); return read(id); };
  await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), /stopped from its pill/);
  assert.equal(clicks(system).length, 1);
  assert.equal(system.calls.at(-1), "escapeIfInFront");
  assert.equal(system.calls.includes("escape"), false);
});

test("after Stop, the Escape that closes choose's menu waits until no modifier key is held, 2 s at most, and is typed then even if one still is, with a warning", async () => {
  for (const free of [true, false]) {
    const system = menuMachine(MENU_ROWS);
    system.waitForNoModifiers = async (ms) => { system.calls.push(["waitForNoModifiers", ms]); return free; };
    const stop = stoppable(system);
    const read = system.read;
    system.read = async (id) => { if (id === 9) stop(); return read(id); };
    const warnings = await warningsOf(async () => {
      await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), /stopped from its pill/);
    });
    assert.deepEqual(system.calls.slice(-2), [["waitForNoModifiers", 2000], "escapeIfInFront"]);
    assert.deepEqual(warnings, free ? []
      : ["warn harness-computer-use typed Escape to close the menu with a modifier key still held 2000 ms after Stop: the menu may stay open"]);
  }
});

test("Stop that comes while Live is brought forward for the Escape that closes choose's menu leaves the closing to that one call", async () => {
  const system = menuMachine(MENU_ROWS);
  const stop = stoppable(system);
  // As the machine does: it calls the function it is handed before it activates Live or types.
  system.escape = async (refuse) => { stop(); refuse(); system.calls.push("escape"); };
  const warnings = await warningsOf(async () => {
    await assert.rejects((await openMenu(system)).choose("Menu", "Triangle"), /0 items reading "Triangle"/);
  });
  assert.deepEqual(warnings, []);
  assert.equal(system.calls.at(-1), "escapeIfInFront");
  assert.equal(system.calls.includes("escape"), false);
});

test("Stop that catches choose's opening click with only its release left: the click throws done, and the menu it opened is closed without bringing Live forward", async () => {
  const system = menuMachine(MENU_ROWS);
  const stop = stoppable(system);
  const click = system.click;
  system.click = async (...args) => { await click(...args); stop(); throw happened(); };
  await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), isHappened);
  assert.deepEqual(clicks(system).map((call) => call[1]), [7]);
  assert.equal(system.calls.at(-1), "escapeIfInFront");
  assert.equal(system.calls.includes("escape"), false);
});

test("Stop that catches choose's click on the item with only its release left: the item was chosen and its menu has closed, so nothing is typed", async () => {
  const system = menuMachine(MENU_ROWS);
  const stop = stoppable(system);
  const click = system.click;
  system.click = async (id, ...at) => {
    await click(id, ...at);
    if (id !== 9) return;
    stop();
    throw happened();
  };
  await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), isHappened);
  assert.deepEqual(clicks(system).map((call) => call[1]), [7, 9]);
  assert.equal(system.calls.includes("escape") || system.calls.includes("escapeIfInFront"), false);
});

test("an opening click of choose that fails without done types nothing", async () => {
  const system = menuMachine(MENU_ROWS);
  system.click = async () => { throw new DeviceUiError("The window at the point is Finder 3, not 7"); };
  await assert.rejects((await openMenu(system)).choose("Menu", "Wander"), (error) => /Finder 3/.test(error.message) && !("done" in error));
  assert.equal(system.calls.includes("escape") || system.calls.includes("escapeIfInFront"), false);
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
const mac = require("../macos.js");

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
  const warnings = await withBuilds(null, async () => assert.equal(await buildComputerUse(), "computer-use-overlay"));
  assert.deepEqual(warnings, []);
});

test("buildComputerUse warns and resolves with no border when only the border can't be built", async () => {
  const warnings = await withBuilds("computer-use-overlay.swift", async () => assert.equal(await buildComputerUse(), null));
  assert.deepEqual(warnings, ["warn harness-computer-use couldn't show its border: swiftc failed on computer-use-overlay.swift. The run clicks without it"]);
});

test("buildComputerUse rejects when the helper can't be built", async () => {
  const warnings = await withBuilds("device-ui.swift", async () => {
    await assert.rejects(buildComputerUse(), (error) => error instanceof DeviceUiError && /swiftc failed on device-ui\.swift/.test(error.message));
  });
  assert.deepEqual(warnings, []);
});

// A stand-in for the overlay: a shell script of `lines`, run with the overlay's arguments,
// that first writes its pid beside itself. Returns its path. Each is a link to one program,
// made and run once for the file, which runs the lines saved beside the link: macOS scans a
// new program the first time it runs, which took about 0.6 s on the remote Mac, longer than
// the 500 ms a border is given below, and a link to a program it has run started in 0.02 s.
const STAND_INS = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
process.on("exit", () => fs.rmSync(STAND_INS, { recursive: true, force: true }));
const STAND_IN = path.join(STAND_INS, "overlay");
fs.writeFileSync(STAND_IN, ["#!/bin/sh", 'echo $$ > "$0.pid"', '. "$0.sh"', ""].join("\n"), { mode: 0o755 });
fs.writeFileSync(`${STAND_IN}.sh`, "");
require("node:child_process").execFileSync(STAND_IN);
let standIns = 0;
function standIn(...lines) {
  const file = path.join(STAND_INS, `overlay-${standIns++}`);
  fs.symlinkSync(STAND_IN, file);
  fs.writeFileSync(`${file}.sh`, [...lines, ""].join("\n"));
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
// Whether the stand-in at `file` has ended. One that never started fails the test as that: it
// shows nothing of how a stand-in is ended.
const gone = (file) => {
  if (!fs.existsSync(`${file}.pid`)) throw new Error(`The stand-in ${path.basename(file)} never started`);
  const pid = Number(fs.readFileSync(`${file}.pid`, "utf8"));
  try { process.kill(pid, 0); return false; } catch { return true; }
};

test("showComputerUse resolves once the border says it has shown, having given it the click token the run reads", async () => {
  const slow = standIn("sleep 0.3", ': > "$0.shown"', "echo shown", 'rm "$2"', STAYS);
  try {
    const warnings = await warningsOf(async () => {
      await showComputerUse(slow);
      assert.equal(fs.existsSync(`${slow}.shown`), true);
      await until(() => stopped());
    });
    assert.deepEqual(warnings, []);
  } finally {
    fs.writeFileSync(clickToken(), "");
  }
});

test("a border that couldn't claim its stop key is warned of", async () => {
  const border = standIn('echo "no stop key: RegisterEventHotKey returned -9878"', "echo shown", STAYS);
  const warnings = await warningsOf(() => showComputerUse(border));
  assert.deepEqual(warnings, ["warn harness-computer-use couldn't claim its stop key (RegisterEventHotKey returned -9878). Stop on its pill still stops the run"]);
});

test("the click token exists before a border is started", async () => {
  const border = standIn('test -r "$2" && : > "$0.readable"', "echo shown", STAYS);
  await showComputerUse(border);
  assert.equal(fs.existsSync(`${border}.readable`), true);
});

test("every border the run shows is given the run's one click token, so Stop on any of their pills stops it", async () => {
  const borders = [1, 2].map(() => standIn('echo "$2" > "$0.token"', "echo shown", STAYS));
  for (const border of borders) await showComputerUse(border);
  const [first, second] = borders.map((border) => fs.readFileSync(`${border}.token`, "utf8").trim());
  assert.equal(second, first);
  assert.equal(first, clickToken());
});

test("the stop key's words are read from the border's program, and are null, with a warning, when it can't say them in time", async () => {
  const says = standIn('test "$1" = --stop-key || exit 2', `echo '{"code":7,"modifiers":["control"],"words":"Control-X","symbols":"^X"}'`);
  assert.deepEqual(await warningsOf(async () => assert.equal(await stopKeyOf(says), "Control-X")), []);
  for (const lines of [["exit 1"], ["echo not json"], ["echo '{}'"], ["sleep 5"]]) {
    const warnings = await warningsOf(async () => assert.equal(await stopKeyOf(standIn(...lines), { timeoutMs: 300 }), null));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^warn harness-computer-use couldn't read its stop key \(.+\)\. The dialog doesn't name it$/);
  }
});

test("showComputerUse leaves this process's environment as it was", async () => {
  const before = { ...process.env };
  await showComputerUse(standIn("echo shown", STAYS));
  assert.deepEqual({ ...process.env }, before);
});

test("the dialog says that the glow will show and names the stop key or, with no border built, that nothing on screen will show the run may take the pointer and that there will be no Stop and no stop key", async () => {
  const run = tools.run;
  const texts = [];
  tools.run = async (command, args) => {
    assert.equal(command, "osascript");
    texts.push(args.at(-1));
    return "button returned:Allow, gave up:false\n";
  };
  try {
    assert.equal(await askToClick("tests/live/check.js", true, "Control-Option-Command-Space"), true);
    assert.equal(await askToClick("tests/live/check.js", true, null), true);
    assert.equal(await askToClick(null, false, null), true);
  } finally {
    tools.run = run;
  }
  assert.deepEqual(texts, [
    "harness-computer-use wants to click in Live on this Mac for tests/live/check.js. It moves the pointer until the run ends, while a purple glow shows around the screen. "
      + "Stop on its pill, or the key it shows (Control-Option-Command-Space), takes the mouse back.",
    "harness-computer-use wants to click in Live on this Mac for tests/live/check.js. It moves the pointer until the run ends, while a purple glow shows around the screen.",
    "harness-computer-use wants to click in Live on this Mac. It moves the pointer until the run ends. Nothing on screen will show that it may take the pointer, and there will be no Stop and no stop key.",
  ]);
});

// Runs `body`, given the helper, with the machine's helper a stand-in: a shell script of `lines`.
async function withHelper(lines, body) {
  const [build, wake] = [tools.helperBinary, mac.wakeDisplay];
  const helper = standIn(...lines);
  tools.helperBinary = async () => helper;
  mac.wakeDisplay = async () => {};
  try {
    return await body(helper);
  } finally {
    [tools.helperBinary, mac.wakeDisplay] = [build, wake];
  }
}

// The error a call of the machine rejects with when its helper is a stand-in of `lines`.
const helperFailing = (...lines) => withHelper(lines, () => liveWindows().then(() => assert.fail("the helper's failure didn't reject"), (error) => error));

// The same when the stand-in writes `said` to stderr and exits with `status`.
const helperEnding = (status, said) => helperFailing(`echo "${said}" >&2`, `exit ${status}`);

test("a helper that exits 4, stopped with only a button's release left, rejects with done; one that exits 3 or 1 doesn't", async () => {
  const error = await helperEnding(4, "harness-computer-use was stopped from its pill: this run clicks no more, and the click had happened");
  assert.equal(isHappened(error), true);
  assert.match(error.message, /the click had happened$/);
  for (const status of [3, 1]) {
    const other = await helperEnding(status, "said");
    assert.equal(other instanceof DeviceUiError, true);
    assert.equal("done" in other, false);
  }
});

// A run of its own, started with `env` added to its environment, whose helper is a stand-in
// that answers `windows` with the click token its own environment names. Resolves with why
// the run is stopped (null if it isn't), the token its helper was given ("" for none) and,
// with `asked`, the run's own token, which it then makes first.
function runStartedWith(env, asked = false) {
  const helper = standIn(`printf '[{"title":"%s"}]' "$HARNESS_COMPUTER_USE_TOKEN"`);
  const run = `
    const [tools, mac, ui] = ["tools", "macos", "device-ui"].map((name) => require(${JSON.stringify(path.join(__dirname, ".."))} + "/" + name + ".js"));
    tools.helperBinary = async () => process.argv[1];
    mac.wakeDisplay = async () => {};
    const token = process.argv[2] ? ui.clickToken() : null;
    ui.liveWindows().then(([window]) => console.log(JSON.stringify({ stopped: ui.stopped(), given: window.title, token })));`;
  return new Promise((resolve, reject) => {
    require("node:child_process").execFile(process.execPath, ["-e", run, helper, ...(asked ? ["asked"] : [])], { env: { ...process.env, ...env }, timeout: 10000 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))));
  });
}

// As a run started by another run would be, were the other's token named in its environment:
// one that Stop has removed, which a run that read it would take as its own Stop.
async function withInheritedToken(body) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
  try {
    await body(path.join(folder, "token"));
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

test("a click token named in the environment a run starts with, which is gone, neither stops the run nor reaches its helper", async () => {
  await withInheritedToken(async (inherited) => {
    assert.deepEqual(await runStartedWith({ HARNESS_COMPUTER_USE_TOKEN: inherited }), { stopped: null, given: "", token: null });
  });
});

test("the helper is given the run's own click token, whatever token the run's environment names", async () => {
  await withInheritedToken(async (inherited) => {
    const run = await runStartedWith({ HARNESS_COMPUTER_USE_TOKEN: inherited }, true);
    assert.notEqual(run.token, inherited);
    assert.deepEqual(run, { stopped: null, given: run.token, token: run.token });
  });
});

test("showComputerUse rejects with the reason a border gives as it ends, or else with how it ended", async () => {
  const sessionless = standIn("echo a line from the system >&2", "echo this process has no desktop session >&2", "exit 1");
  await assert.rejects(showComputerUse(sessionless), { message: "this process has no desktop session" });
  await assert.rejects(showComputerUse(standIn("exit 1")), { message: "it ended with status 1" });
  await assert.rejects(showComputerUse(standIn("kill -9 $$")), { message: "it ended with SIGKILL" });
});

test("showComputerUse ends a border that says nothing in time, and rejects", async () => {
  const silent = standIn("exec sleep 30");
  await assert.rejects(showComputerUse(silent, { shownMs: 500 }), { message: "it didn't show within 500 ms" });
  await until(() => gone(silent));
});

// What the run warns of while it shows a border, a stand-in that says it has shown and then
// ends as `ends` has it, until that border has gone.
async function warningsOfBorder(...ends) {
  const shown = standIn("echo shown", ...ends);
  return warningsOf(async () => {
    await showComputerUse(shown);
    await until(() => gone(shown));
    await pause(100);
  });
}

test("a border that goes after it has shown, while the run goes on and wasn't stopped, is warned of once, however it ended", async () => {
  for (const [ends, how] of [
    [["sleep 0.2", "exit 1"], "status 1"],
    [["exit 1"], "status 1"],
    [["sleep 0.2", "kill -9 $$"], "SIGKILL"],
    [["sleep 0.2", "exit 0"], "status 0"],
  ]) {
    assert.deepEqual(await warningsOfBorder(...ends), [`warn harness-computer-use's border has gone (${how}). The run clicks without it`]);
  }
});

test("a border that goes once the run is stopped is not warned of, however it ended", async () => {
  for (const status of [0, 1]) {
    try {
      assert.deepEqual(await warningsOfBorder("sleep 0.2", 'rm "$2"', `exit ${status}`), []);
    } finally {
      fs.writeFileSync(clickToken(), "");
    }
  }
});

test("a run that has shown its border still ends by itself", async () => {
  const run = `require(${JSON.stringify(path.join(__dirname, "..", "device-ui.js"))}).showComputerUse(process.argv[1]).then(() => console.log("shown"))`;
  const printed = await new Promise((resolve, reject) => {
    require("node:child_process").execFile(process.execPath, ["-e", run, standIn("echo shown", STAYS)], { timeout: 10000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
  assert.equal(printed, "shown\n");
});

// A run of its own within this process: a fresh copy of device-ui.js, so that the tests after
// don't inherit what Stop's signal does to a run for good. The copies loaded before don't
// hear the SIGUSR2 emitted meanwhile.
async function inFreshRun(body) {
  const file = require.resolve("../device-ui.js");
  const [loaded, listeners] = [require.cache[file], process.listeners("SIGUSR2")];
  process.removeAllListeners("SIGUSR2");
  delete require.cache[file];
  try {
    await body(require(file));
  } finally {
    process.removeAllListeners("SIGUSR2");
    for (const listener of listeners) process.on("SIGUSR2", listener);
    require.cache[file] = loaded;
  }
}

test("a run listens for Stop's signal from when it makes its click token, once, however often the token is asked for or a border shown", () => inFreshRun(async (ui) => {
  assert.equal(process.listenerCount("SIGUSR2"), 0);
  ui.clickToken();
  ui.clickToken();
  for (const border of [1, 2].map(() => standIn("echo shown", STAYS))) await ui.showComputerUse(border);
  assert.equal(process.listenerCount("SIGUSR2"), 1);
}));

test("after Stop's signal the run counts as stopped from its pill, though its token can be read and the token's folder written to", () => inFreshRun((ui) => {
  const token = ui.clickToken();
  assert.equal(ui.stopped(), null);
  process.emit("SIGUSR2");
  assert.equal(ui.stopped(), STOPPED);
  fs.accessSync(path.dirname(token), fs.constants.W_OK | fs.constants.X_OK);
  fs.closeSync(fs.openSync(token, "r"));
}));

test("after Stop's signal no press of the run hovers or clicks, and a capture doesn't bring Live to the front", () => inFreshRun(async (ui) => {
  const system = fakeMachine({ info: "Knob" });
  // A machine that asks, and whose run is stopped when this copy of the module is.
  Object.assign(system, { hostname: () => "another-mac", ask: async () => true, showComputerUse: async () => { ui.clickToken(); }, stopped: ui.stopped });
  const device = await ui.openDeviceUi(fakeLive(), { track: 1, device: 1, controls: { Knob: { x: 50, y: 36, info: "Knob" } } }, system);
  await device.press("Knob");
  process.emit("SIGUSR2");
  const before = system.calls.length;
  await assert.rejects(device.press("Knob"), { message: `${STOPPED}. Not clicked` });
  assert.equal(system.calls.length, before);
  assert.equal(clicks(system).length, 1);
  const editor = Object.assign(fakePluginMachine(), { stopped: ui.stopped });
  const window = await ui.openPluginWindow(pluginLive(), PLUGIN, editor);
  await assert.rejects(window.capture("/out/editor.png"), { message: `${STOPPED}. Live not brought to the front` });
  assert.equal(editor.calls.includes("focus"), false);
}));

test("Stop's signal is passed on to a helper that is running, and the run goes on", () => inFreshRun((ui) => withHelper(
  ["trap 'echo \"[]\"; exit 0' USR2", ': > "$0.started"', "while :; do sleep 0.05; done"],
  async (helper) => {
    ui.clickToken();
    const windows = ui.liveWindows();
    windows.catch(() => {});
    try {
      await until(() => fs.existsSync(`${helper}.started`));
      process.emit("SIGUSR2");
      assert.deepEqual(await Promise.race([windows, pause(3000).then(() => "the helper wasn't signalled")]), []);
    } finally {
      if (!gone(helper)) process.kill(Number(fs.readFileSync(`${helper}.pid`, "utf8")));
    }
  },
)));

test("a helper that Stop's signal ended, before it could handle it, fails its call as stopped, saying that it had posted nothing", async () => {
  const error = await helperFailing("kill -USR2 $$");
  assert.equal(error instanceof DeviceUiError, true);
  assert.equal(error.message, `${STOPPED}, and the helper had posted nothing`);
  assert.equal("done" in error, false);
});

test("a run that listens for Stop's signal still ends by itself", async () => {
  const run = `require(${JSON.stringify(path.join(__dirname, "..", "device-ui.js"))}).clickToken(); console.log(process.listenerCount("SIGUSR2"))`;
  const printed = await new Promise((resolve, reject) => {
    require("node:child_process").execFile(process.execPath, ["-e", run], { timeout: 10000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
  assert.equal(printed, "1\n");
});

test("a run that can't remove its token's folder as it ends still ends with its own status, saying nothing", async () => {
  const run = `const fs = require("node:fs"); const path = require("node:path");
    const folder = path.dirname(require(${JSON.stringify(path.join(__dirname, "..", "device-ui.js"))}).clickToken());
    fs.chmodSync(folder, 0o500);
    console.log(folder);`;
  const ended = await new Promise((resolve) => {
    require("node:child_process").execFile(process.execPath, ["-e", run], { timeout: 10000 },
      (error, stdout, stderr) => resolve({ status: error ? error.code : 0, folder: stdout.trim(), stderr }));
  });
  try {
    assert.deepEqual({ status: ended.status, stderr: ended.stderr }, { status: 0, stderr: "" });
  } finally {
    fs.chmodSync(ended.folder, 0o700);
    fs.rmSync(ended.folder, { recursive: true });
  }
});

const hasDeveloperTools = (() => {
  try { require("node:child_process").execFileSync("xcode-select", ["-p"], { stdio: "ignore" }); return true; } catch { return false; }
})();

// The border's program, built with swiftc if it isn't cached, says its stop key without a
// window server: the dialog asks it before the border shows (ADR-0017).
test("the border's program gives its stop key, Control-Option-Command-Space, as the key the check presses and as the dialog's and the pill's words", { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async () => {
  const overlay = await tools.helperBinary(path.join(__dirname, "..", "computer-use-overlay.swift"));
  assert.deepEqual(JSON.parse(await tools.run(overlay, ["--stop-key"])),
    { code: 49, modifiers: ["control", "option", "command"], words: "Control-Option-Command-Space", symbols: "\u2303\u2325\u2318Space" });
  assert.equal(await stopKeyOf(overlay), "Control-Option-Command-Space");
});

// Runs the real helper, built with swiftc if it isn't cached. A drag refused for its distance
// posts no event; nor would one that got past that check, as no window has the id -1.
test("the helper refuses a drag under 1 point or by a fraction of a point", { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async () => {
  const helper = await tools.helperBinary(path.join(__dirname, "..", "device-ui.swift"));
  for (const [dx, dy] of [[0, -1e-15], [0, -0.4], [0.9, 0], [0.5, -0.5], [0, -1.4], [0, -10.5], [7.5, -3]]) {
    await assert.rejects(tools.run(helper, ["drag", -1, 100, 100, dx, dy]), /whole points, at least 1 on its longer axis and at most 400 on either/);
  }
});

// A PNG's chunk, and a grey PNG `width` x `height` pixels that gives its resolution as
// `perMetre` pixels, both ways.
function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const [length, check] = [Buffer.alloc(4), Buffer.alloc(4)];
  length.writeUInt32BE(data.length);
  check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, check]);
}
function png(width, height, perMetre) {
  const [header, resolution] = [Buffer.alloc(13), Buffer.alloc(9)];
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per pixel, of the one grey channel
  resolution.writeUInt32BE(perMetre, 0);
  resolution.writeUInt32BE(perMetre, 4);
  resolution[8] = 1; // per metre
  const rows = require("node:zlib").deflateSync(Buffer.alloc(height * (1 + width), 0x80));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header), pngChunk("pHYs", resolution), pngChunk("IDAT", rows), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// A PNG file's size in pixels and the resolution it gives, in pixels per metre, null if it
// gives none.
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  const size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), perMetre: null };
  for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) {
    if (bytes.toString("latin1", at + 4, at + 8) === "pHYs") size.perMetre = bytes.readUInt32BE(at + 8);
  }
  return size;
}

// Runs the real helper on a 20 x 10 pixel image at 144 dpi, 5669 pixels per metre, as a
// capture of a window 10 points wide on a display with 2 pixels per point.
test("the helper's crop keeps the image's resolution, takes the rectangle in points and rounds each of its edges to a pixel", {
  skip: !hasDeveloperTools && "no developer tools", timeout: 300000,
}, async (t) => {
  const helper = await tools.helperBinary(path.join(__dirname, "..", "device-ui.swift"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "device-ui-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const [image, out] = [path.join(folder, "image.png"), path.join(folder, "out.png")];
  fs.writeFileSync(image, png(20, 10, 5669));
  await tools.run(helper, ["crop", image, 10, 2, 1, 6, 3, out]);
  assert.deepEqual(pngSize(out), { width: 12, height: 6, perMetre: 5669 });
  // Inside the image, from pixel 0.5 to pixel 20: pixels 1 to 20, 19 wide. Its width rounded
  // by itself is 20 pixels, which from pixel 1 would end one past the image's edge.
  await tools.run(helper, ["crop", image, 10, 0.25, 0, 9.75, 5, out]);
  assert.deepEqual(pngSize(out), { width: 19, height: 10, perMetre: 5669 });
  await assert.rejects(tools.run(helper, ["crop", image, 10, 5, 0, 6, 5, out]), /isn't inside the 10(\.0)? x 5(\.0)? point image/);
});
