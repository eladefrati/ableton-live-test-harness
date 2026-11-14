#!/usr/bin/env node
"use strict";

// Checks what device-ui.swift posts and what it refuses, and what Stop on the pill of
// computer-use-overlay.swift does, with real mouse events and no Live: each case shows a
// window of its own (pointer-target.swift), runs the helper against it, and compares how the
// helper ended with the mouse events the window received. It takes the pointer, so it
// refuses, posting nothing, anywhere but on the click host ("clickHost" in
// harness/local.json). Exits 1 on failure.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { execFileSync, spawn } = require("node:child_process");
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
// How long the overlay has to end once Stop is pressed. Its last resort alone gives the run
// 2 s.
const OVERLAY_WAIT_MS = 10000;
// How long a process has to end once what holds it has gone.
const END_WAIT_MS = 3000;

// The click token every helper here is given, as a run's helpers are (ADR-0012), in a folder
// of its own. Each case starts with both made anew.
const TOKEN = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pointer-guards-")), "token");
const FOLDER = path.dirname(TOKEN);
process.on("exit", () => fs.rmSync(FOLDER, { recursive: true, force: true }));

// Undoes what a case did to the token and its folder, so that neither stays locked: the next
// case makes them anew, and the folder is removed as the check ends.
function unlockToken() {
  if (!fs.existsSync(FOLDER)) return;
  fs.chmodSync(FOLDER, 0o700);
  if (!fs.existsSync(TOKEN)) return;
  execFileSync("chflags", ["nouchg", TOKEN]);
  fs.chmodSync(TOKEN, 0o600);
}

// What stops a run. The token removed, as Stop on the pill removes it, when a case names
// nothing else; or a loss the run can't tell from that; or Stop pressed on the pill itself,
// at once after the run's end if the presser is given the run to end; or the run killed, by
// a signal sent to it alone, which its helper doesn't get and which leaves the token there.
const tokenRemoved = () => fs.rmSync(TOKEN);
const folderGone = () => fs.rmSync(FOLDER, { recursive: true });
const folderUnwritable = () => fs.chmodSync(FOLDER, 0o500);
const tokenUnreadable = () => fs.chmodSync(TOKEN, 0o000);
const stopPressed = (the) => the.pressStop();
const runKilled = (the) => process.kill(the.run.pid, "SIGTERM");

// How a helper that is stopped before its last event exits, and what it says: that Stop
// removed the token, or why it can't tell that Stop didn't.
const STOPPED = 3;
const BY_STOP = "harness-computer-use was stopped from its pill: this run clicks no more";
const cantTell = (why) => `harness-computer-use can't tell that it wasn't stopped (${why}), which counts as stopped: this run clicks no more`;
const FOLDER_GONE = cantTell(`the token's folder ${FOLDER} is gone`);
const FOLDER_UNWRITABLE = cantTell(`the folder ${FOLDER} can't be written to, so Stop couldn't remove the token`);
const TOKEN_UNREADABLE = cantTell(`the token ${TOKEN} can't be read`);
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stoppedError = (sentence = BY_STOP) => new RegExp(`^${literal(sentence)}, and the helper (held no button|released the button at [\\d.]+, [\\d.]+)$`);
// How one exits that Stop caught with only its button's release left, and what it says of
// the click or the drag.
const HAPPENED = 4;
const happened = (gesture) => new RegExp(`^${literal(BY_STOP)}, and the helper released the button at [\\d.]+, [\\d.]+: the ${gesture} had happened$`);
// How a helper ended whose run a signal ended before it could say: with its run, by that
// signal too or by itself.
const withRun = (signal) => `with its run (${signal})`;

// What the overlay says as it ends: the run named as the overlay is given it.
const RUN_NAME = literal(path.basename(__filename));
const SAID_STOPPED = new RegExp(`^Stopped: ${RUN_NAME} won't click again\\. The mouse is yours\\.$`);
const SAID_RUN_ENDED = new RegExp(`^${RUN_NAME} has ended: the mouse is yours again\\.$`);
const SAID_ENDED_RUN = new RegExp(`^${RUN_NAME} was ended: its click token couldn't be removed\\. The mouse is yours\\.$`);

// How long the helper holds the button before a click's release, and after a drag's move
// before its release (device-ui.swift).
const CLICK_HOLD_MS = 70;
const DRAG_HOLD_MS = 50;

const click = (window, x, y) => ["click", window, x, y];
// A drag 30 points right and 20 up, and the one drag event it posts.
const drag = (window, x, y) => ["drag", window, x, y, 30, -20];
const DRAGGED = { type: "drag", dx: 30, dy: -20 };

// Each case: the target's options, whether harness-computer-use's overlay runs, whether the
// token can't be removed, whether the run outlives SIGTERM, whether a notification's banner
// shows first, whether the run is stopped before the helper starts or how long after, and by
// what if not by the token's removal, and the helper's command, if a helper runs, given the
// target's window and its centre. Then what must come of it: the helper's exit status (the signal, if one ended it),
// its error, how soon it ended, the button events the target's windows received, by the
// fields named, all that the overlay says as it ends, and the signal that ends the run, if
// one does. In every case, once the run is stopped the target must receive no event but a
// button-up, not a pointer's move either. A helper that says its click or drag had happened
// reads Stop after its release, so it says the same whether Stop came during its hold or just
// after: such a case also says how long after the target removed the token the button-up must
// reach it: half the hold, which leaves a loaded machine room. Under that, the token may
// have gone after the helper posted its release, and the case fails as not shown.
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
    name: "a click reaches the target under harness-computer-use's border, whose windows the guard skips",
    overlay: true,
    target: RECT,
    command: click,
    status: 0,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
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
    stderr: stoppedError(),
    events: () => [],
  },
  ...[
    ["whose token's folder is gone", folderGone, FOLDER_GONE],
    ["whose token's folder can't be written to", folderUnwritable, FOLDER_UNWRITABLE],
    ["whose token can't be read", tokenUnreadable, TOKEN_UNREADABLE],
  ].map(([lost, loss, sentence]) => ({
    name: `a helper started in a run ${lost} posts nothing, and says that it can't tell that the run wasn't stopped`,
    target: RECT,
    stopped: true,
    loss,
    command: click,
    status: STOPPED,
    stderr: stoppedError(sentence),
    events: () => [],
  })),
  {
    name: "Stop while a click holds the button: the click completes, and the helper ends as stopped, saying the click had happened",
    target: [...RECT, "--stop", TOKEN],
    command: click,
    status: HAPPENED,
    stderr: happened("click"),
    upAfterStopMs: CLICK_HOLD_MS / 2,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  },
  {
    name: "Stop while a drag holds the button, before its move: the button comes up at the press point, with no drag event",
    target: [...RECT, "--stop", TOKEN],
    command: drag,
    status: STOPPED,
    stderr: stoppedError(),
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  },
  {
    name: "Stop once a drag's move is posted: the drag completes, and the helper ends as stopped, saying the drag had happened",
    target: [...RECT, "--stop-at-drag", TOKEN],
    command: drag,
    status: HAPPENED,
    stderr: happened("drag"),
    upAfterStopMs: DRAG_HOLD_MS / 2,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  // A helper that died by a quit signal would leave a crash report, so it exits instead.
  ...[["SIGTERM", "SIGTERM", "dies by the signal"], ["SIGQUIT", 131, "exits with status 131"]].map(([signal, status, ends]) => ({
    name: `${signal} while a drag holds the button: the helper releases it at the press point, then ${ends}`,
    target: [...RECT, "--signal", signal],
    command: drag,
    status,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  })),
  {
    name: "the run killed while a drag holds the button, before its move: the button comes up at the press point, with no drag event",
    target: [...RECT, "--signal-parent", "SIGTERM"],
    command: drag,
    status: withRun("SIGTERM"),
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
    run: "SIGTERM",
  },
  // Last, the cases that end under a notification's cover, the check's own or the one the
  // overlay posts as it ends: the cover outlasts the case by a few seconds, and the target of
  // the next case waits for it to go. Without Stop the helper waits for the cover to go,
  // 4.9 s in one run.
  {
    name: "Stop while the helper waits for a notification's cover to go: it leaves the wait, posting nothing",
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    withinMs: 2500,
    events: () => [],
  },
  {
    name: "the token's folder gone while the helper waits for a notification's cover to go: it leaves the wait, posting nothing",
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: folderGone,
    command: click,
    status: STOPPED,
    stderr: stoppedError(FOLDER_GONE),
    withinMs: 2500,
    events: () => [],
  },
  {
    name: "the token's folder made unwritable while the helper waits for a notification's cover to go: it leaves the wait, and Stop on the pill, "
      + "which can't remove the token, says Stopped and takes the border down",
    overlay: true,
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: (the) => { folderUnwritable(); return the.pressStop(); },
    command: click,
    status: STOPPED,
    stderr: stoppedError(FOLDER_UNWRITABLE),
    withinMs: 2500,
    events: () => [],
    says: SAID_STOPPED,
  },
  {
    name: "the run killed while the helper waits for a notification's cover to go: the helper leaves the wait and ends, posting nothing, "
      + "and the overlay says that the run has ended",
    overlay: true,
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: runKilled,
    command: click,
    status: withRun("SIGTERM"),
    withinMs: 2500,
    events: () => [],
    says: SAID_RUN_ENDED,
    run: "SIGTERM",
  },
  {
    name: "Stop on the pill removes the token: the overlay says Stopped and takes the border down, and a helper started then posts nothing",
    overlay: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    events: () => [],
    says: SAID_STOPPED,
  },
  {
    name: "Stop on the pill when the token can't be removed, while the helper waits for a notification's cover to go: "
      + "the overlay ends the helper and the run, and says so",
    overlay: true,
    immutable: true,
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: stopPressed,
    command: click,
    status: withRun("SIGTERM"),
    events: () => [],
    says: SAID_ENDED_RUN,
    run: "SIGTERM",
  },
  {
    name: "Stop on the pill when the token can't be removed and the run outlives SIGTERM: the overlay kills the run, and says so",
    overlay: true,
    immutable: true,
    deaf: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    events: () => [],
    says: SAID_ENDED_RUN,
    run: "SIGKILL",
  },
  {
    name: "Stop on the pill once the run has ended says that the run has ended, not Stopped",
    overlay: true,
    target: RECT,
    stopped: true,
    loss: (the) => the.pressStop(the.run.pid),
    events: () => [],
    says: SAID_RUN_ENDED,
    run: "SIGTERM",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The promise's value, or null if it takes longer than `ms`.
function within(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms, null); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// The lines a process prints, one per call, null once it has ended.
function linesOf(child) {
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return async () => (await lines.next()).value ?? null;
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

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

// A run of the check's own, which starts the helper as a run does, with the token named in
// the helper's environment, and which the overlay is given as its run: Stop's last resort
// ends the run and its helpers by signal, so the check itself is never the run. For each
// line of arguments it reads it starts the helper, prints the helper's pid and, once the
// helper ends, how: its exit status (the signal, if one ended it) and what it wrote to
// stderr. It ends when its input does. Given a third argument, it outlives SIGTERM.
const RUN = `
  const { execFile } = require("node:child_process");
  const [binary, token, deaf] = process.argv.slice(1);
  if (deaf) process.on("SIGTERM", () => {});
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const helper = execFile(binary, JSON.parse(line), { env: { ...process.env, HARNESS_COMPUTER_USE_TOKEN: token } }, (error, stdout, stderr) => {
      console.log(JSON.stringify({ status: error ? error.code ?? error.signal : 0, stderr: stderr.trim() }));
    });
    console.log(JSON.stringify({ helper: helper.pid }));
  });`;

// Starts such a run: { pid, helper, end }. `helper` runs the helper and resolves with how it
// ended, or, when the run ends before it says, with whether the helper ended with it. `end`
// ends the run and resolves with its exit status, or the signal that ended it.
function startRun(helper, deaf) {
  const child = spawn(process.execPath, ["-e", RUN, helper, TOKEN, ...(deaf ? ["deaf"] : [])], { stdio: ["pipe", "pipe", "inherit"] });
  const ended = new Promise((resolve) => child.on("exit", (code, signal) => resolve(signal ?? code)));
  const line = linesOf(child);
  const said = async () => JSON.parse(await line());
  // A run that a signal ended no longer reads its input.
  child.stdin.on("error", () => {});
  return {
    pid: child.pid,
    async helper(args) {
      child.stdin.write(`${JSON.stringify(args.map(String))}\n`);
      const started = await said();
      const result = await said();
      if (result) return result;
      const how = await ended;
      for (const deadline = Date.now() + END_WAIT_MS; started && alive(started.helper); await sleep(50)) {
        if (Date.now() > deadline) {
          try { process.kill(started.helper); } catch { /* it has just ended */ }
          return { status: "outliving its run", stderr: "" };
        }
      }
      return { status: withRun(how), stderr: "" };
    },
    async end() {
      child.stdin.end();
      // One that a signal has suspended can't end by itself.
      if ((await within(END_WAIT_MS, ended)) === null) child.kill("SIGKILL");
      return ended;
    },
  };
}

// Starts the overlay over the run `pid` and resolves once it says its windows are on screen:
// { pid, said, end }. `said` resolves, once the overlay has ended and so taken its windows
// down, with all it said as it did, or with null if it doesn't end in time. `end` ends one
// that is still up, which doesn't notify.
async function showOverlay(binary, pid) {
  const child = spawn(binary, [String(pid), TOKEN, path.basename(__filename)], { stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const line = linesOf(child);
  if ((await line()) !== "shown") throw new Error("The overlay ended before its windows showed");
  const last = async () => {
    const lines = [];
    for (let next = await line(); next !== null; next = await line()) lines.push(next);
    await ended;
    return lines.join("\n");
  };
  return {
    pid: child.pid,
    said: () => within(OVERLAY_WAIT_MS, last()),
    async end() {
      child.kill();
      await ended;
    },
  };
}

const sameEvents = (seen, expected) => seen.length === expected.length
  && expected.every((event, i) => Object.entries(event).every(([field, value]) => seen[i][field] === value));

// Runs one case and resolves with what differed from what it expects, nothing if it passed.
async function failures(test, binaries) {
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  if (test.immutable) execFileSync("chflags", ["uchg", TOKEN]);
  const run = startRun(binaries.helper, test.deaf);
  let overlay = null;
  try {
    if (test.overlay) overlay = await showOverlay(binaries.overlay, run.pid);
    // Why Stop couldn't be pressed, if it couldn't: an overlay that is ending shows no pill.
    let unpressed = "";
    const pressStop = (...after) => tools.run(binaries.press, [overlay.pid, ...after]).catch((error) => { unpressed = `: ${error.message}`; });
    // When the run was stopped, on the clock the target's events carry.
    let stoppedAt;
    let lost = null;
    const lose = () => {
      lost = Promise.resolve().then(() => (test.loss ?? tokenRemoved)({ run, pressStop })).then(() => { stoppedAt = Date.now(); });
      // Thrown once the helper has ended, not as an unhandled rejection in the timer below.
      lost.catch(() => {});
      return lost;
    };
    if (test.stopped) await lose();
    const target = await showTarget(binaries.target, test.target);
    const [x, y] = [target.x + target.w / 2, target.y + target.h / 2];
    if (test.banner) {
      await tools.run("osascript", ["-e", `display notification "${path.basename(__filename)}" with title "harness-computer-use"`]);
      await sleep(BANNER_WAIT_MS);
    }
    const timer = test.stopAfterMs && setTimeout(lose, test.stopAfterMs);
    const started = Date.now();
    let ended, took, printed;
    try {
      ended = test.command ? await run.helper(test.command(target.window, x, y)) : null;
      took = Date.now() - started;
      await sleep(EVENT_WAIT_MS);
    } finally {
      clearTimeout(timer);
      // Ending the target also releases a button the helper left held.
      printed = await target.end();
    }
    await lost;
    const said = test.says ? await overlay.said() : null;
    // The overlay's notification covers the screen a moment after it is posted: the next
    // case's target is to find the cover there, and wait for it to go.
    if (said) await sleep(BANNER_WAIT_MS);
    const ran = await run.end();
    const seen = printed.filter((line) => line.type);
    const [buttons, expected] = [seen.filter((event) => event.type !== "move"), test.events(x, y)];
    const held = printed.find((line) => "released" in line);
    stoppedAt = printed.find((line) => "stopped" in line)?.stopped ?? stoppedAt;
    const afterStop = seen.filter((event) => event.at >= stoppedAt && event.type !== "up");
    const upAfterStop = seen.find((event) => event.type === "up")?.at - stoppedAt;
    return [
      ended && ended.status !== test.status && `the helper exited ${ended.status}, not ${test.status}${ended.stderr && `, with "${ended.stderr}"`}`,
      ended && ended.status === test.status && test.stderr && !test.stderr.test(ended.stderr) && `the helper's error was "${ended.stderr}"`,
      took > test.withinMs && `the helper took ${took} ms, over ${test.withinMs}`,
      !sameEvents(buttons, expected) && `the target received ${JSON.stringify(buttons)}, not ${JSON.stringify(expected)}`,
      afterStop.length && `after Stop the target received ${JSON.stringify(afterStop)}`,
      test.upAfterStopMs && fs.existsSync(TOKEN) && "the click token was never removed",
      test.upAfterStopMs && !fs.existsSync(TOKEN) && !(upAfterStop >= test.upAfterStopMs)
        && `not shown that Stop came before the release: the button-up reached the target ${upAfterStop.toFixed(1)} ms after the token was removed, under ${test.upAfterStopMs}`,
      held && `the button was left held, and ${held.released ? "has been released" : "could not be released"}`,
      test.says && said === null && `the overlay was still up ${OVERLAY_WAIT_MS} ms after Stop${unpressed}`,
      test.says && said !== null && !test.says.test(said) && `the overlay said ${JSON.stringify(said)}, not ${test.says}${unpressed}`,
      ran !== (test.run ?? 0) && `the run ended with ${ran}, not ${test.run ?? 0}`,
    ].filter(Boolean);
  } finally {
    // The overlay before the run: one that saw its run end would notify.
    if (overlay) await overlay.end();
    await run.end();
    unlockToken();
  }
}

async function main() {
  if (hostname() !== readClickHost()) {
    throw new Error(`pointer-guards.js posts real mouse events, so it runs only on the click host ("clickHost" in harness/local.json), which ${hostname()} isn't. Nothing posted`);
  }
  const binaries = {};
  const sources = { helper: "device-ui", target: "checks/pointer-target", overlay: "computer-use-overlay", press: "checks/press-stop" };
  for (const [name, source] of Object.entries(sources)) {
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
