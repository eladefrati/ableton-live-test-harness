#!/usr/bin/env node
"use strict";

// Checks what device-ui.swift posts and what it refuses, with real mouse events and no Live:
// each case shows a window of its own (pointer-target.swift), runs the helper against it, and
// compares how the helper ended with the button events the window received. It takes the
// pointer, so it refuses, posting nothing, anywhere but on the click host ("clickHost" in
// harness/local.json). Exits 1 on failure.

const path = require("node:path");
const readline = require("node:readline");
const { execFile, spawn } = require("node:child_process");
const tools = require("../tools.js");
const mac = require("../macos.js");
const { machine } = require("../device-ui.js");

const HARNESS = path.join(__dirname, "..");
const PILL_TITLE = "harness-computer-use pill";
// Where the target shows: [x, y, w, h] in points from the screen's top left.
const RECT = [400, 200, 400, 300];
// How long the target has to report an event after the helper has ended.
const EVENT_WAIT_MS = 300;

const click = (window, x, y) => ["click", window, x, y];
// A drag 30 points right and 20 up, and the one drag event it posts.
const drag = (window, x, y) => ["drag", window, x, y, 30, -20];
const DRAGGED = { type: "drag", dx: 30, dy: -20 };

// Each case: the target's options, whether harness-computer-use's overlay runs, and the
// helper's command, given the target's window and its centre. Then what must come of it: the
// helper's exit status, its error, and the button events the target's windows received, by
// the fields named.
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
  execFile(binary, args.map(String), (error, stdout, stderr) => {
    resolve({ status: error ? error.code ?? error.signal : 0, stderr: stderr.trim() });
  });
});

const sameEvents = (seen, expected) => seen.length === expected.length
  && expected.every((event, i) => Object.entries(event).every(([field, value]) => seen[i][field] === value));

// Runs one case and resolves with what differed from what it expects, nothing if it passed.
async function failures(test, binaries) {
  const overlay = test.overlay ? spawn(binaries.overlay, [String(process.pid), path.basename(__filename)], { stdio: "ignore" }) : null;
  try {
    const target = await showTarget(binaries.target, test.target);
    const [x, y] = [target.x + target.w / 2, target.y + target.h / 2];
    let ended, printed;
    try {
      ended = await runHelper(binaries.helper, test.command(target.window, x, y));
      await sleep(EVENT_WAIT_MS);
    } finally {
      // Ending the target also releases a button the helper left held.
      printed = await target.end();
    }
    const [seen, expected] = [printed.filter((line) => line.type), test.events(x, y)];
    const held = printed.find((line) => "released" in line);
    return [
      ended.status !== test.status && `the helper exited ${ended.status}, not ${test.status}${ended.stderr && `, with "${ended.stderr}"`}`,
      ended.status === test.status && test.stderr && !test.stderr.test(ended.stderr) && `the helper's error was "${ended.stderr}"`,
      !sameEvents(seen, expected) && `the target received ${JSON.stringify(seen)}, not ${JSON.stringify(expected)}`,
      held && `the button was left held, and ${held.released ? "has been released" : "could not be released"}`,
    ].filter(Boolean);
  } finally {
    if (overlay) overlay.kill();
  }
}

async function main() {
  if (machine.hostname() !== machine.clickHost()) {
    throw new Error(`pointer-guards.js posts real mouse events, so it runs only on the click host ("clickHost" in harness/local.json), which ${machine.hostname()} isn't. Nothing posted`);
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
