#!/usr/bin/env node
"use strict";

// Checks what device-ui.swift's click-editor and drag-editor refuse (ADR-0008), in Live, on
// the editor of Apple's AUDelay, which every Mac has. pointer-guards.js can't run these two,
// because they take only a plug-in window of Live's, whose editor they read from Live through
// Accessibility. The check adds an audio track with AUDelay, opens its window, and runs the
// helper against the editor's Dry/Wet Mix slider, as a run does, with a click token, once for
// each command in each case. It compares the helper's exit status and error, the mouse events
// the helper posted (checks/event-tap.swift) and Dry/Wet Mix, read over OSC. A refused command
// posts nothing and leaves the value as it was. Each command first reaches the editor, under
// harness-computer-use's border too, which the guard skips; then it is refused for a window
// of another app over the point (checks/pointer-target.swift), or one that comes over it
// during the hover, the helper suspended by the tap at the hover's first move until that
// window shows; for an editor that isn't the size given, a point on or outside the editor's
// edge, a drag by a distance the helper refuses or one that would end off the screen; for
// the plug-in's window closed; for a stopped run, whose token is gone; for a coordinate that
// is no number; and last for a notification's banner that covers the screen for longer than
// the 10 s the helper waits for it to go. Not run: the locked screen, since staging it would
// lock the Mac; a point under harness-computer-use's pill, which AUDelay's editor can't reach
// (it lies 194 points below the top of its window, which macOS keeps below the menu bar);
// two windows of the editor's title, which Live doesn't show at once, since it hides the
// plug-in windows of a track that isn't selected, and the harness opens a window only for a
// device whose name is the only one of its track; and an editor with other than one group in
// its window. It takes the pointer, so it runs only on the click host ("clickHost" in
// harness/local.json), with Live open; it brings Live to the front. The track is deleted at
// the end. Exits 1 on failure.
//
//   node harness/checks/editor-guards.js

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { execFile, spawn } = require("node:child_process");
const tools = require("../tools.js");
const mac = require("../macos.js");
const { connect } = require("../live.js");
const { hostname, readClickHost, openPluginWindow } = require("../device-ui.js");

const HARNESS = path.join(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ITEM = "AUv2/Apple/AUDelay";
const TRACK = "editor-guards";
// AUDelay's editor and its Dry/Wet Mix slider, in points from the editor's top left, and
// what a drag 10 points right from the middle of the slider sets (live-notes.md).
const SIZE = [444, 80];
const SLIDER = { x: 263, y: 26 };
const PARAMETER = "Dry/Wet Mix";
const FROM = 0.5;
const DRAGGED_TO = 0.7145;
const VALUE_TOLERANCE = 0.0005;
const DRAG = [10, 0];
// How long the tap has to report the helper's events after the helper has ended.
const EVENT_WAIT_MS = 300;
// How long Notification Center takes to cover the screen once a notification is posted, and
// how often one is posted to keep it covered. Each keeps the cover up about 5.3 s
// (live-notes.md).
const BANNER_WAIT_MS = 1000;
const BANNER_EVERY_MS = 3000;
// How long the helper waits for a notification's cover to go before it refuses
// (device-ui.swift).
const NOTIFICATION_WAIT_MS = 10000;
// How long the helper has to stop at the hover's first move.
const FREEZE_WAIT_MS = 5000;
// The longest drag either way (device-ui.swift).
const MAX_DRAG = 400;

// The click token every helper here is given, as a run's helpers are (ADR-0012), in a folder
// of its own. Each case starts with the token made anew.
const TOKEN = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "editor-guards-")), "token");
process.on("exit", () => fs.rmSync(path.dirname(TOKEN), { recursive: true, force: true }));

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A coordinate as the helper writes it: Swift's Double, with ".0" for a whole number.
const swift = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));
const BY_STOP = "harness-computer-use was stopped from its pill: this run clicks no more, and the helper held no button";
const USAGE = "usage: device-ui click-editor <title> <x> <y> <w> <h> | drag-editor <title> <x> <y> <w> <h> <dx> <dy>";

// The helper's arguments for a command at the point `at` of the editor, in points from its
// top left, with the editor's `size` and, for a drag, the distance `drag` ([dx, dy]).
function commandLine(command, title, { at = SLIDER, size = SIZE, drag = DRAG } = {}) {
  const numbers = [at.x, at.y, ...size, ...(command === "drag" ? drag : [])];
  return [`${command}-editor`, title, ...numbers.map(String)];
}

const BOTH = ["click", "drag"];
// A refusal: no event, the value unchanged.
const refused = (stderr) => ({ status: 1, stderr, events: "none", value: "same" });
const outside = (name, at) => ({
  name: `a point ${name} is refused`,
  commands: BOTH,
  args: (command, the) => commandLine(command, the.title, { at: at(the) }),
  ...refused((the) => {
    const { x, y } = at(the);
    return new RegExp(`^${literal(`${swift(x)}, ${swift(y)} isn't inside the editor of ${the.title}, ${swift(SIZE[0])} x ${swift(SIZE[1])} points`)}$`);
  }),
});
const DISTANCE = (dx, dy) => new RegExp(`^${literal(`A drag moves whole points, at least 1 on its longer axis and at most ${MAX_DRAG} on either, not ${swift(dx)}, ${swift(dy)}`)}$`);
const wrongSize = (name, size) => ({
  name: `an editor that isn't the size given is refused, ${name}`,
  commands: BOTH,
  args: (command, the) => commandLine(command, the.title, { size }),
  ...refused((the) => new RegExp(`^${literal(`The editor of ${the.title} is ${swift(SIZE[0])} x ${swift(SIZE[1])} points, not ${swift(size[0])} x ${swift(size[1])}`)}$`)),
});
// A drag from the point that ends a point past the main display's top edge, or else its left
// edge, whichever the longest drag reaches. The check assumes no display beyond either.
function offScreen(the) {
  const [up, left] = [Math.floor(the.py) + 1, Math.floor(the.px) + 1];
  if (up <= MAX_DRAG) return [0, -up];
  if (left <= MAX_DRAG) return [-left, 0];
  throw new Error(`the slider is more than ${MAX_DRAG} points from the screen's top and left edges, so no drag the helper takes ends off the screen`);
}
const distance = (name, drag) => ({
  name: `a drag ${name} is refused`,
  commands: ["drag"],
  args: (command, the) => commandLine(command, the.title, { drag }),
  ...refused(() => DISTANCE(...drag)),
});

// Each case: the commands it runs, the helper's arguments, what it sets up first and
// undoes after (`setup` resolves with the undoing), what it does while the helper runs
// (`during`), and what must come of it: the helper's exit status and error, the mouse
// events it posted ("click", "drag", "moves" for a hover's two and nothing else, or "none")
// and Dry/Wet Mix ("same", "dragged" or "any"), and at least how long the helper took.
// `the` is the editor as found before the case: { title, window, x, y, w, h }, in points on
// the screen, and the point aimed at, `px`, `py`.
const CASES = [
  {
    name: "a click and a drag reach the editor",
    commands: BOTH,
    args: (command, the) => commandLine(command, the.title),
    status: 0,
    events: (command) => command,
    value: (command) => (command === "drag" ? "dragged" : "any"),
  },
  {
    name: "a click and a drag reach the editor under harness-computer-use's border, whose windows the guard skips",
    commands: BOTH,
    setup: async (the, rig) => {
      const overlay = await showOverlay(rig.binaries.overlay);
      return () => overlay.end();
    },
    args: (command, the) => commandLine(command, the.title),
    status: 0,
    events: (command) => command,
    value: (command) => (command === "drag" ? "dragged" : "any"),
  },
  {
    name: "a window of another app over the point is refused, and the helper names it",
    commands: BOTH,
    setup: async (the, rig) => {
      const target = await showTarget(rig.binaries.target, [the.px - 20, the.py - 20, 40, 40]);
      the.over = target.window;
      return async () => {
        const received = await target.end();
        if (received.length) return `the window over the point received ${JSON.stringify(received)}`;
      };
    },
    args: (command, the) => commandLine(command, the.title),
    ...refused((the) => new RegExp(`^The window at the point is pointer-target\\S* ${the.over}, not ${the.window}$`)),
  },
  {
    name: "a window that comes over the point during the hover gets no button event, and the helper names it",
    commands: BOTH,
    // The tap suspends the helper at the hover's first move, which is off the point
    // (device-ui.swift).
    setup: async (the, rig) => {
      the.froze = rig.tap.freeze();
      return async () => {
        rig.tap.thaw();
        const received = the.cover ? await the.cover.end() : [];
        if (received.some((event) => event.type !== "move")) return `the window that came over the point received ${JSON.stringify(received)}`;
      };
    },
    // Once the helper is suspended, a window comes over the point, and the helper goes on
    // once that window is listed.
    during: async (the, rig) => {
      const frozen = await within(FREEZE_WAIT_MS, the.froze);
      if (frozen === null) {
        // A helper the tap suspends after this is let go on at once.
        rig.tap.thaw();
        the.froze.then((late) => { try { process.kill(late, "SIGCONT"); } catch { /* it has ended */ } });
        return "the helper wasn't suspended at the hover's first move";
      }
      try {
        the.cover = await showTarget(rig.binaries.target, [the.px - 20, the.py - 20, 40, 40]);
      } finally {
        try { process.kill(frozen, "SIGCONT"); } catch { /* it has ended */ }
      }
    },
    args: (command, the) => commandLine(command, the.title),
    status: 1,
    stderr: (the) => new RegExp(`^The window at the point is pointer-target\\S* ${the.cover?.window}, not ${the.window}$`),
    events: "moves",
    value: "same",
  },
  wrongSize("by its width", [SIZE[0] + 1, SIZE[1]]),
  wrongSize("by its height", [SIZE[0], SIZE[1] - 1]),
  outside("on the editor's left edge", () => ({ x: 0, y: SLIDER.y })),
  outside("on the editor's top edge", () => ({ x: SLIDER.x, y: 0 })),
  outside("on the editor's right edge", () => ({ x: SIZE[0], y: SLIDER.y })),
  outside("on the editor's bottom edge", () => ({ x: SLIDER.x, y: SIZE[1] })),
  outside("left of the editor, in its window", () => ({ x: -10, y: SLIDER.y })),
  distance("by a fraction of a point", [10.5, 0]),
  distance("of no distance", [0, 0]),
  distance("over the longest drag", [MAX_DRAG + 1, 0]),
  {
    name: "a drag that would end off the screen is refused",
    commands: ["drag"],
    args: (command, the) => commandLine(command, the.title, { drag: offScreen(the) }),
    ...refused((the) => {
      const [dx, dy] = offScreen(the);
      return new RegExp(`^${literal(`A drag to (${swift(the.px + dx)}, ${swift(the.py + dy)}) ends off screen`)}$`);
    }),
  },
  {
    name: "a plug-in window that isn't open is refused",
    commands: BOTH,
    setup: async (the, rig) => {
      await rig.plugin.close();
      return () => rig.plugin.setOpen(true);
    },
    args: (command, the) => commandLine(command, the.title),
    ...refused((the) => new RegExp(`^${literal(`The plug-in window ${the.title} isn't on screen`)}$`)),
  },
  {
    name: "a run that was stopped, its token gone, posts nothing",
    commands: BOTH,
    setup: async () => {
      fs.rmSync(TOKEN);
    },
    args: (command, the) => commandLine(command, the.title),
    status: 3,
    stderr: () => new RegExp(`^${literal(BY_STOP)}$`),
    events: "none",
    value: "same",
  },
  {
    name: "a coordinate that is no number is refused",
    commands: BOTH,
    args: (command, the) => commandLine(command, the.title).map((arg, i) => (i === 2 ? "left" : arg)),
    ...refused(() => new RegExp(`^${literal(USAGE)}$`)),
  },
  // Last, because the cover stays up about 5 s after the last notification.
  {
    name: "a notification's cover over the screen for longer than the helper waits is refused",
    commands: BOTH,
    setup: async () => {
      await notify();
      await sleep(BANNER_WAIT_MS);
    },
    during: async (the, rig, helper) => {
      while ((await within(BANNER_EVERY_MS, helper.ended)) === null) await notify();
    },
    args: (command, the) => commandLine(command, the.title),
    ...refused(() => new RegExp(`^A notification has covered the screen for ${NOTIFICATION_WAIT_MS / 1000} s$`)),
    atLeastMs: NOTIFICATION_WAIT_MS,
  },
];

// The promise's value, or null if it takes longer than `ms`.
function within(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms, null); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const notify = () => tools.run("osascript", ["-e", `display notification "${path.basename(__filename)}" with title "harness-computer-use"`]);

// Starts a window of pointer-target.swift and resolves once it is on screen: { window, end }.
// `end` ends it and resolves with the mouse events it received.
async function showTarget(binary, options) {
  const child = spawn(binary, options.map(String), { stdio: ["ignore", "pipe", "inherit"] });
  const lines = [];
  const ended = new Promise((resolve) => child.on("close", resolve));
  await new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      lines.push(JSON.parse(line));
      resolve();
    });
    child.on("error", reject);
    ended.then(() => reject(new Error("The window ended before it showed")));
  });
  return {
    window: lines[0].window,
    async end() {
      child.kill();
      await ended;
      return lines.slice(1).filter((line) => line.type);
    },
  };
}

// Starts harness-computer-use's overlay over this check's process and resolves once its
// windows are on screen: { end }, which ends it without a notification. Nothing presses its
// Stop, nor its stop key, so a line saying that it couldn't claim the key is passed over.
async function showOverlay(binary) {
  const child = spawn(binary, [String(process.pid), TOKEN, path.basename(__filename)], { stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let first = await lines.next();
  while (first.value?.startsWith("no stop key: ")) first = await lines.next();
  if (first.value !== "shown") throw new Error("The overlay ended before its windows showed");
  return {
    async end() {
      child.kill();
      await ended;
    },
  };
}

// Starts the tap and resolves once it is in place: { events, disabled, freeze, thaw, end }.
// `events(pid)` is what the process `pid` posted. `disabled()` counts the times the system
// turned the tap off, each of which may have lost events. `freeze` has the tap suspend the
// helper at its next pointer move, and resolves with the helper's process id once it has;
// `thaw` takes that back.
async function startTap(binary) {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  const seen = [];
  let [frozen, disabled] = [() => {}, 0];
  const ended = new Promise((resolve) => child.on("close", resolve));
  await new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const said = JSON.parse(line);
      if (said.ready) resolve();
      else if ("frozen" in said) frozen(said.frozen);
      else if (said.disabled) disabled += 1;
      else seen.push(said);
    });
    child.on("error", reject);
    ended.then(() => reject(new Error("The event tap ended before it was in place")));
  });
  return {
    events: (pid) => seen.filter((event) => event.pid === pid),
    disabled: () => disabled,
    freeze() {
      child.stdin.write("freeze\n");
      return new Promise((resolve) => { frozen = resolve; });
    },
    thaw() {
      child.stdin.write("thaw\n");
    },
    async end() {
      child.stdin.end();
      child.kill();
      await ended;
    },
  };
}

// Starts the helper as a run's helper, with the token named in its environment: { pid,
// ended }, which resolves with its exit status (the signal, if one ended it) and its error.
function startHelper(binary, args) {
  let child;
  const ended = new Promise((resolve) => {
    child = execFile(binary, args, { env: { ...process.env, HARNESS_COMPUTER_USE_TOKEN: TOKEN } }, (error, stdout, stderr) => {
      resolve({ status: error ? error.code ?? error.signal : 0, stderr: stderr.trim() });
    });
  });
  return { pid: child.pid, ended };
}

// The plug-in window and its editor, in points on the screen, with Live brought to the front,
// where alone it shows a plug-in's window, and the window waited for.
async function findEditor(plugin) {
  const found = await plugin.locate();
  return { title: plugin.title, window: found.id, ...found.editor };
}

const near = (a, b) => Math.abs(a - b) < 0.01;
// What the helper must have posted, by type and point; moves apart from "moves".
function expectedEvents(kind, the) {
  const [x, y] = [the.px, the.py];
  if (kind === "click") return [{ type: "down", x, y }, { type: "up", x, y }];
  if (kind === "drag") return [{ type: "down", x, y }, { type: "drag", x: x + DRAG[0], y: y + DRAG[1], dx: DRAG[0], dy: DRAG[1] }, { type: "up" }];
  if (kind === "moves") return [{ type: "move", x: x - 15, y: y - 10 }, { type: "move", x, y }];
  return [];
}
const matches = (seen, expected) => seen.length === expected.length
  && expected.every((event, i) => Object.entries(event).every(([field, value]) => (typeof value === "number" ? near(seen[i][field], value) : seen[i][field] === value)));

// Runs one command of a case and resolves with what differed from what it expects, nothing
// if it passed.
async function failures(test, command, rig) {
  fs.mkdirSync(path.dirname(TOKEN), { recursive: true });
  fs.writeFileSync(TOKEN, "");
  rig.live.setParameter(rig.track, rig.device, rig.parameter, FROM);
  await rig.live.sync();
  await sleep(200);
  const editor = await findEditor(rig.plugin);
  const the = { ...editor, px: editor.x + SLIDER.x, py: editor.y + SLIDER.y };
  const undo = test.setup ? await test.setup(the, rig) : null;
  const disabled = rig.tap.disabled();
  let [ended, took, during, undone] = [null, 0, null, null];
  try {
    const started = Date.now();
    const helper = startHelper(rig.binaries.helper, test.args(command, the));
    during = test.during ? await test.during(the, rig, helper) : null;
    ended = await helper.ended;
    took = Date.now() - started;
    await sleep(EVENT_WAIT_MS);
    the.posted = rig.tap.events(helper.pid);
  } finally {
    if (undo) undone = await undo();
  }
  const value = (await rig.live.query("/live/device/get/parameter/value", rig.track, rig.device, rig.parameter))[3];
  const kind = typeof test.events === "function" ? test.events(command) : test.events;
  const wanted = typeof test.value === "function" ? test.value(command) : test.value;
  const posted = kind === "moves" ? the.posted : the.posted.filter((event) => event.type !== "move");
  const expected = expectedEvents(kind, the);
  return [
    rig.tap.disabled() > disabled && "the system turned the event tap off during the case, so it may have missed the helper's events",
    during,
    undone,
    ended.status !== test.status && `the helper exited ${ended.status}, not ${test.status}${ended.stderr && `, with "${ended.stderr}"`}`,
    ended.status === test.status && test.stderr && !test.stderr(the).test(ended.stderr) && `the helper's error was "${ended.stderr}", not ${test.stderr(the)}`,
    !matches(posted, expected) && `the helper posted ${JSON.stringify(posted)}, not ${JSON.stringify(expected)}`,
    kind === "none" && the.posted.length && `the helper posted ${JSON.stringify(the.posted)}`,
    wanted === "same" && Math.abs(value - FROM) > VALUE_TOLERANCE && `${PARAMETER} went from ${FROM} to ${value}`,
    wanted === "dragged" && Math.abs(value - DRAGGED_TO) > VALUE_TOLERANCE && `${PARAMETER} went from ${FROM} to ${value}, not ${DRAGGED_TO}`,
    test.atLeastMs && took < test.atLeastMs && `the helper took ${took} ms, under ${test.atLeastMs}`,
  ].filter(Boolean);
}

async function main() {
  if (hostname() !== readClickHost()) {
    throw new Error(`editor-guards.js posts real mouse events, so it runs only on the click host ("clickHost" in harness/local.json), which ${hostname()} isn't. Nothing posted`);
  }
  const binaries = {};
  const sources = { helper: "device-ui", target: "checks/pointer-target", overlay: "computer-use-overlay", tap: "checks/event-tap" };
  for (const [name, source] of Object.entries(sources)) {
    binaries[name] = await tools.helperBinary(path.join(HARNESS, `${source}.swift`));
  }
  const live = await connect({ timeout: 5000 });
  const display = await mac.keepDisplayOn();
  let [first, tap, plugin] = [undefined, null, null];
  const report = (name, failed) => {
    console.log(failed.length ? `FAIL: ${name}: ${failed.join("; ")}` : `PASS: ${name}`);
    if (failed.length) process.exitCode = 1;
  };
  try {
    first = await live.get("song", "num_tracks");
    const track = await live.createAudioTrack(TRACK);
    const device = await live.loadDevice(track, "Plug-Ins", ITEM);
    const parameter = (await live.parameterIndices(track, device)).get(PARAMETER);
    if (parameter === undefined) throw new Error(`AUDelay lists no ${PARAMETER}`);
    plugin = await openPluginWindow(live, { track, device });
    const editor = await findEditor(plugin);
    if (editor.w !== SIZE[0] || editor.h !== SIZE[1]) {
      throw new Error(`AUDelay's editor is ${editor.w} x ${editor.h} points, not the ${SIZE.join(" x ")} this check was written for`);
    }
    tap = await startTap(binaries.tap);
    const rig = { live, track, device, parameter, plugin, binaries, tap };
    for (const test of CASES) {
      for (const command of test.commands) {
        // A case that can't be run fails, and the next is run.
        report(`${command}-editor: ${test.name}`, await failures(test, command, rig).catch((error) => [`the case couldn't run: ${error.message}`]));
      }
    }
  } finally {
    if (tap) await tap.end();
    try {
      if (plugin) await plugin.close();
    } finally {
      try {
        if (first !== undefined) await live.deleteTracks([TRACK], first);
      } finally {
        live.close();
        display.stop();
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
