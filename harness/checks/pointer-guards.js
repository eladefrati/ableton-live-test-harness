#!/usr/bin/env node
"use strict";

// Checks what device-ui.swift posts and what it refuses, with real mouse events and no Live:
// each case shows a window of its own (pointer-target.swift), runs the helper against it, and
// compares how the helper ended with the mouse events the window received. It takes the
// pointer, so it refuses, posting nothing, anywhere but on the click host ("clickHost" in
// harness/local.json). Exits 1 on failure.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { execFile, spawn } = require("node:child_process");
const tools = require("../tools.js");
const mac = require("../macos.js");
const { hostname, readClickHost } = require("../device-ui.js");

const HARNESS = path.join(__dirname, "..");
const PILL_TITLE = "harness-computer-use pill";
// Where the target shows: [x, y, w, h] in points from the screen's top left.
const RECT = [400, 200, 400, 300];
// How long the target has to report an event after the helper has ended.
const EVENT_WAIT_MS = 300;
// How long Notification Center takes to cover the screen once a notification is posted.
const BANNER_WAIT_MS = 1000;

// The stop marker every helper here is given, as a run's helpers are (ADR-0012). Each case
// starts without it.
const MARKER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pointer-guards-")), "stopped");
process.on("exit", () => fs.rmSync(path.dirname(MARKER), { recursive: true, force: true }));
// How a helper that Stop ends before its last event exits, and what it says.
const STOPPED = 3;
const STOPPED_ERROR = /^harness-computer-use was stopped from its pill: this run clicks no more, and the helper (held no button|released the button at [\d.]+, [\d.]+)$/;

// How long the helper holds the button before a click's release, and after a drag's move
// before its release (device-ui.swift).
const CLICK_HOLD_MS = 70;
const DRAG_HOLD_MS = 50;

const click = (window, x, y) => ["click", window, x, y];
// A drag 30 points right and 20 up, and the one drag event it posts.
const drag = (window, x, y) => ["drag", window, x, y, 30, -20];
const DRAGGED = { type: "drag", dx: 30, dy: -20 };

// Each case: the target's options, whether harness-computer-use's overlay runs, whether a
// notification's banner shows first, whether the run was stopped before the helper starts or
// how long after, and the helper's command, given the target's window and its centre. Then
// what must come of it: the helper's exit status (the signal, if one ended it), its error,
// how soon it ended, and the button events the target's windows received, by the fields
// named. In every case, once the run is stopped the target must receive no event but a
// button-up, not a pointer's move either. A helper that ends as one that wasn't stopped looks
// the same whether Stop came during its hold or never, so such a case also says how long
// after the target made the marker the button-up must reach it: half the hold, which leaves
// a loaded machine room. Under that, the marker may have come after the helper posted its
// release, and the case fails as not shown.
const CASES = [
  {
    name: "a click reaches the target",
    target: RECT,
    command: click,
    status: 0,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  },
  {
    name: "a window that comes over the point during a click's hover gets no click, and the helper names it",
    target: [...RECT, "--cover"],
    command: click,
    status: 1,
    stderr: /^The window at the point is pointer-target\S* \d+, not \d+$/,
    events: () => [],
  },
  {
    name: "a point under harness-computer-use's pill is refused, naming the pill",
    overlay: true,
    target: ["--under", PILL_TITLE],
    command: click,
    status: 1,
    stderr: /^The point is under harness-computer-use's pill$/,
    events: () => [],
  },
  {
    name: "a drag's events: one down at the point, one drag at the end with the whole distance, one up",
    target: RECT,
    command: drag,
    status: 0,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  {
    name: "a drag's button comes up where the pointer is once the control has moved it back",
    target: [...RECT, "--return"],
    command: drag,
    status: 0,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x, y }],
  },
  {
    name: "a helper started after Stop posts nothing",
    target: RECT,
    stopped: true,
    command: click,
    status: STOPPED,
    stderr: STOPPED_ERROR,
    events: () => [],
  },
  {
    name: "Stop while a click holds the button: the click completes, and the helper ends as one that wasn't stopped",
    target: [...RECT, "--stop", MARKER],
    command: click,
    status: 0,
    upAfterStopMs: CLICK_HOLD_MS / 2,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  },
  {
    name: "Stop while a drag holds the button, before its move: the button comes up at the press point, with no drag event",
    target: [...RECT, "--stop", MARKER],
    command: drag,
    status: STOPPED,
    stderr: STOPPED_ERROR,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  },
  {
    name: "Stop once a drag's move is posted: the drag completes, and the helper ends as one that wasn't stopped",
    target: [...RECT, "--stop-at-drag", MARKER],
    command: drag,
    status: 0,
    upAfterStopMs: DRAG_HOLD_MS / 2,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  ...["SIGTERM", "SIGQUIT"].map((signal) => ({
    name: `${signal} while a drag holds the button: the helper releases it at the press point, then dies by the signal`,
    target: [...RECT, "--signal", signal],
    command: drag,
    status: signal,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  })),
  // Last: the banner's cover outlasts the case by a few seconds. Without Stop the helper
  // waits for the cover to go, 4.9 s in one run.
  {
    name: "Stop while the helper waits for a notification's cover to go: it leaves the wait, posting nothing",
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    command: click,
    status: STOPPED,
    stderr: STOPPED_ERROR,
    withinMs: 2500,
    events: () => [],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the target and resolves once its window is on screen: { window, x, y, w, h, end }.
// `end` stops it and resolves with the lines it printed after that first one.
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
    ended.then(() => reject(new Error("The target ended before its window showed")));
  });
  const end = async () => {
    child.kill();
    await ended;
    return lines.slice(1);
  };
  return { ...lines[0], end };
}

// How the helper ended: its exit status (the signal, if one ended it) and what it wrote to
// stderr.
const runHelper = (binary, args) => new Promise((resolve) => {
  execFile(binary, args.map(String), { env: { ...process.env, HARNESS_COMPUTER_USE_STOP: MARKER } }, (error, stdout, stderr) => {
    resolve({ status: error ? error.code ?? error.signal : 0, stderr: stderr.trim() });
  });
});

const sameEvents = (seen, expected) => seen.length === expected.length
  && expected.every((event, i) => Object.entries(event).every(([field, value]) => seen[i][field] === value));

// Runs one case and resolves with what differed from what it expects, nothing if it passed.
async function failures(test, binaries) {
  const overlay = test.overlay ? spawn(binaries.overlay, [String(process.pid), MARKER, path.basename(__filename)], { stdio: "ignore" }) : null;
  try {
    fs.rmSync(MARKER, { force: true });
    // When the run was stopped, on the clock the target's events carry.
    let stoppedAt;
    const stop = () => {
      fs.writeFileSync(MARKER, "");
      stoppedAt = Date.now();
    };
    if (test.stopped) stop();
    const target = await showTarget(binaries.target, test.target);
    const [x, y] = [target.x + target.w / 2, target.y + target.h / 2];
    if (test.banner) {
      await tools.run("osascript", ["-e", `display notification "${path.basename(__filename)}" with title "harness-computer-use"`]);
      await sleep(BANNER_WAIT_MS);
    }
    const timer = test.stopAfterMs && setTimeout(stop, test.stopAfterMs);
    const started = Date.now();
    let ended, took, printed;
    try {
      ended = await runHelper(binaries.helper, test.command(target.window, x, y));
      took = Date.now() - started;
      await sleep(EVENT_WAIT_MS);
    } finally {
      clearTimeout(timer);
      // Ending the target also releases a button the helper left held.
      printed = await target.end();
    }
    const seen = printed.filter((line) => line.type);
    const [buttons, expected] = [seen.filter((event) => event.type !== "move"), test.events(x, y)];
    const held = printed.find((line) => "released" in line);
    stoppedAt = printed.find((line) => "stopped" in line)?.stopped ?? stoppedAt;
    const afterStop = seen.filter((event) => event.at >= stoppedAt && event.type !== "up");
    const upAfterStop = seen.find((event) => event.type === "up")?.at - stoppedAt;
    return [
      ended.status !== test.status && `the helper exited ${ended.status}, not ${test.status}${ended.stderr && `, with "${ended.stderr}"`}`,
      ended.status === test.status && test.stderr && !test.stderr.test(ended.stderr) && `the helper's error was "${ended.stderr}"`,
      took > test.withinMs && `the helper took ${took} ms, over ${test.withinMs}`,
      !sameEvents(buttons, expected) && `the target received ${JSON.stringify(buttons)}, not ${JSON.stringify(expected)}`,
      afterStop.length && `after Stop the target received ${JSON.stringify(afterStop)}`,
      test.upAfterStopMs && !fs.existsSync(MARKER) && "the stop marker was never made",
      test.upAfterStopMs && fs.existsSync(MARKER) && !(upAfterStop >= test.upAfterStopMs)
        && `not shown that Stop came before the release: the button-up reached the target ${upAfterStop.toFixed(1)} ms after the marker was made, under ${test.upAfterStopMs}`,
      held && `the button was left held, and ${held.released ? "has been released" : "could not be released"}`,
    ].filter(Boolean);
  } finally {
    if (overlay) overlay.kill();
  }
}

async function main() {
  if (hostname() !== readClickHost()) {
    throw new Error(`pointer-guards.js posts real mouse events, so it runs only on the click host ("clickHost" in harness/local.json), which ${hostname()} isn't. Nothing posted`);
  }
  const binaries = {};
  for (const [name, source] of Object.entries({ helper: "device-ui", target: "checks/pointer-target", overlay: "computer-use-overlay" })) {
    binaries[name] = await tools.helperBinary(path.join(HARNESS, `${source}.swift`));
  }
  // The helper refuses while the display sleeps: the session reports the screen locked.
  const display = await mac.keepDisplayOn();
  try {
    for (const test of CASES) {
      const failed = await failures(test, binaries);
      console.log(failed.length ? `FAIL: ${test.name}: ${failed.join("; ")}` : `PASS: ${test.name}`);
      if (failed.length) process.exitCode = 1;
    }
  } finally {
    display.stop();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
