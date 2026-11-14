#!/usr/bin/env node
"use strict";

// Checks what device-ui.swift posts and what it refuses, and what Stop on the pill of
// computer-use-overlay.swift does, with real mouse events and no Live: each case shows a
// window of its own (pointer-target.swift), runs the helper against it, and compares how the
// helper ended with the mouse events the window received. First it starts the overlay with
// the process ids it must refuse for a run. It takes the pointer, so it
// refuses, posting nothing, anywhere but on the click host ("clickHost" in
// harness/local.json). Exits 1 on failure.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { execFile, execFileSync, spawn } = require("node:child_process");
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
// 10 s to end, and a run it then kills 1 s more to be gone.
const OVERLAY_WAIT_MS = 15000;
// How long after its signal Stop's last resort kills a run that is still there
// (computer-use-overlay.swift), and how much later than that the check may see the run end,
// counted from when it started to press Stop.
const KILL_AFTER_MS = 10000;
const KILL_SLACK_MS = 1000;
// How long a process has to end once what holds it has gone.
const END_WAIT_MS = 3000;
// How long Stop on the pill has to remove the token while the helper is frozen for it.
const STOP_WAIT_MS = 3000;
// How long the overlay has to refuse a run. One that doesn't refuse has said by then that
// its windows are on screen, or why they aren't.
const REFUSAL_WAIT_MS = 2000;

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

// When the token went, if it has and its folder hasn't: removing a file sets its folder's
// modification time, on the clock the target's events carry.
const tokenWentAt = () => (fs.existsSync(FOLDER) && !fs.existsSync(TOKEN) ? fs.statSync(FOLDER).mtimeMs : undefined);

// What stops a run. The token removed, as Stop on the pill removes it, when a case names
// nothing else; or a loss the run can't tell from that; or Stop pressed on the pill itself,
// at once after the run's end if the presser is given the run to end; or the helper sent the
// signal of Stop's last resort, as its run passes it on; or the run killed, by a signal sent
// to it alone, which its helper doesn't get and which leaves the token there.
const tokenRemoved = () => fs.rmSync(TOKEN);
const folderGone = () => fs.rmSync(FOLDER, { recursive: true });
const folderUnwritable = () => fs.chmodSync(FOLDER, 0o500);
const tokenUnreadable = () => fs.chmodSync(TOKEN, 0o000);
const stopPressed = (the) => the.pressStop();
const helperSignalled = (the) => the.run.signalHelper("SIGUSR2");
const runKilled = (the) => process.kill(the.run.pid, "SIGTERM");

// How a helper that is stopped before its last event exits, and what it says: that Stop
// removed the token, or why it can't tell that Stop didn't.
const STOPPED = 3;
const BY_STOP = "harness-computer-use was stopped from its pill: this run clicks no more";
const cantTell = (why) => `harness-computer-use can't tell that it wasn't stopped (${why}), which counts as stopped: this run clicks no more`;
const FOLDER_GONE = cantTell(`the token's folder ${FOLDER} is gone`);
const FOLDER_UNWRITABLE = cantTell(`the folder ${FOLDER} can't be written to, so Stop couldn't remove the token`);
const TOKEN_UNREADABLE = cantTell(`the token ${TOKEN} can't be read`);
// What one says whose run has ended.
const RUN_ENDED = "harness-computer-use's run has ended: this helper clicks no more";
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

// The process ids the overlay must refuse for its run: Stop's last resort signals the run and
// may kill it, and to kill, 0 is the caller's own process group and -1 every process the user
// may signal.
const NO_RUNS = [0, -1];
const OVERLAY_USAGE = "usage: computer-use-overlay <pid> <click-token> [<run>]";

// How long the helper holds the button before a click's release, and after a drag's move
// before its release (device-ui.swift).
const CLICK_HOLD_MS = 70;
const DRAG_HOLD_MS = 50;

const click = (window, x, y) => ["click", window, x, y];
// A hover's first move, off the point; its second is to the point (device-ui.swift).
const firstMove = (x, y) => ({ x: x - 15, y: y - 10 });
// A drag 30 points right and 20 up, and the one drag event it posts.
const drag = (window, x, y) => ["drag", window, x, y, 30, -20];
const DRAGGED = { type: "drag", dx: 30, dy: -20 };

// Each case: the target's options, whether harness-computer-use's overlay runs, whether the
// token can't be removed, whether the run ignores the signal of Stop's last resort, whether a
// notification's banner shows first, whether the run is stopped before the helper starts or
// how long after, and by what if not by the token's removal, and the helper's command, if a helper
// runs, given the target's window and its centre, and whether a process that has ended
// starts it, not the check's run. A target that freezes the helper says when
// itself: the run is stopped once it has, and the helper goes on once the token is gone. Then
// what must come of it: the helper's
// exit status (the signal, if one ended it), its error, how soon it ended, the button events
// the target's windows received, by the fields named, and the pointer's moves where a case
// names them, all that the overlay says as it ends,
// whether it may say so only once the run has ended, how long after Stop the run must be
// killed, at the least and at the most, and the signal that ends the run, if one does. In
// every case, once the run is stopped the target must receive no event but a
// button-up, not a pointer's move either. A helper that says its click or drag had happened
// reads Stop after its release, so it says the same whether Stop came during its hold or just
// after: such a case also says how long after the token went the button-up must reach the
// target: half the hold where the target removes the token, which leaves a loaded machine
// room, and not before it where the helper is frozen with the button down until the token has
// gone. Under that, the token may have gone after the helper posted its release, and the case
// fails as not shown.
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
    name: "a helper whose run had ended before it began, with process 1 for a parent from its start, posts nothing, and says that its run has ended",
    target: RECT,
    orphaned: true,
    command: click,
    status: STOPPED,
    stderr: stoppedError(RUN_ENDED),
    moves: () => [],
    events: () => [],
  },
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
    name: "Stop's signal while a click holds the button: the click completes, and the helper ends as stopped, saying the click had happened",
    target: [...RECT, "--signal", "SIGUSR2"],
    command: click,
    status: HAPPENED,
    stderr: happened("click"),
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
  },
  {
    name: "Stop's signal while a drag holds the button, before its move: the button comes up at the press point, with no drag event",
    target: [...RECT, "--signal", "SIGUSR2"],
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
    name: "the token's folder made unwritable while the helper waits for a notification's cover to go: it leaves the wait, posting nothing",
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: folderUnwritable,
    command: click,
    status: STOPPED,
    stderr: stoppedError(FOLDER_UNWRITABLE),
    withinMs: 2500,
    events: () => [],
  },
  {
    name: "Stop's signal to a helper that waits for a notification's cover to go: it leaves the wait, posting nothing",
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: helperSignalled,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    withinMs: 2500,
    events: () => [],
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
  // Stop on the pill while the helper is in a gesture. The press takes longer to remove the
  // token than the helper holds a button, so the target freezes the helper at the event the
  // case names, and it goes on once the token is gone.
  {
    name: "Stop on the pill during a click's hover, the helper frozen at its first move: it posts nothing more, and the overlay says Stopped",
    overlay: true,
    target: [...RECT, "--freeze", "move"],
    loss: stopPressed,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    moves: (x, y) => [firstMove(x, y)],
    events: () => [],
    says: SAID_STOPPED,
  },
  {
    name: "Stop on the pill while a click holds the button, the helper frozen with it down: the click completes, the helper ends as stopped, "
      + "saying the click had happened, and the overlay says Stopped",
    overlay: true,
    target: [...RECT, "--freeze", "down"],
    loss: stopPressed,
    command: click,
    status: HAPPENED,
    stderr: happened("click"),
    upAfterStopMs: 0,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
    says: SAID_STOPPED,
  },
  {
    name: "Stop on the pill while a drag holds the button, before its move, the helper frozen with it down: "
      + "the button comes up at the press point, with no drag event, and the overlay says Stopped",
    overlay: true,
    target: [...RECT, "--freeze", "down"],
    loss: stopPressed,
    command: drag,
    status: STOPPED,
    stderr: stoppedError(),
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
    says: SAID_STOPPED,
  },
  {
    name: "Stop on the pill when the token can't be removed, while the helper waits for a notification's cover to go: "
      + "the helper stops as after Stop, the run ends by itself, and only then does the overlay say Stopped",
    overlay: true,
    immutable: true,
    banner: true,
    target: RECT,
    stopAfterMs: 1000,
    loss: stopPressed,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    withinMs: 2500,
    events: () => [],
    says: SAID_STOPPED,
    afterRun: true,
  },
  // No helper runs here: one that waits under a notification's cover gives up after 10 s, as
  // long as the run is given, and a helper whose run is killed is the case further up.
  {
    name: "Stop on the pill when the token can't be removed and the run ignores the signal: "
      + "the run is killed 10 s after Stop, not sooner, and only then does the overlay say that the run was ended",
    overlay: true,
    immutable: true,
    deaf: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    events: () => [],
    says: SAID_ENDED_RUN,
    afterRun: true,
    killedMs: [KILL_AFTER_MS, KILL_AFTER_MS + KILL_SLACK_MS],
    run: "SIGKILL",
  },
  {
    name: "Stop on the pill when the token's folder can't be written to, where the run reads as stopped already: "
      + "the run ends by itself, and only then does the overlay say Stopped",
    overlay: true,
    target: RECT,
    stopped: true,
    loss: (the) => { folderUnwritable(); return the.pressStop(); },
    events: () => [],
    says: SAID_STOPPED,
    afterRun: true,
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

// Starts the target and resolves once its window is on screen: { window, x, y, w, h, froze,
// end }. `froze` resolves with the process the target says it has frozen, once it says so.
// `end` stops it and resolves with the lines it printed after that first one.
async function showTarget(binary, options) {
  const child = spawn(binary, options.map(String), { stdio: ["ignore", "pipe", "inherit"] });
  const lines = [];
  const ended = new Promise((resolve) => child.on("close", resolve));
  let frozen;
  const froze = new Promise((resolve) => { frozen = resolve; });
  await new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const said = JSON.parse(line);
      lines.push(said);
      resolve();
      if ("frozen" in said) frozen(said.frozen);
    });
    child.on("error", reject);
    ended.then(() => reject(new Error("The target ended before its window showed")));
  });
  const end = async () => {
    child.kill();
    await ended;
    return lines.slice(1);
  };
  return { ...lines[0], froze, end };
}

// A run of the check's own, which starts the helper as a run does, with the token named in
// the helper's environment, and which the overlay is given as its run: Stop's last resort
// signals the run, and kills one that doesn't end, so the check itself is never the run. For
// each line of arguments it reads it starts the helper, prints the helper's pid and, once the
// helper ends, how: its exit status (the signal, if one ended it) and what it wrote to
// stderr. It ends when its input does. On the signal of Stop's last resort (SIGUSR2) it does
// as a run does: it passes the signal on to its helper and ends by itself once the helper
// has. Given a third argument, it ignores the signal.
const RUN = `
  const { execFile } = require("node:child_process");
  const [binary, token, deaf] = process.argv.slice(1);
  let helper = null;
  process.on("SIGUSR2", () => {
    if (deaf) return;
    if (helper) helper.kill("SIGUSR2");
    process.stdin.destroy();
  });
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    helper = execFile(binary, JSON.parse(line), { env: { ...process.env, HARNESS_COMPUTER_USE_TOKEN: token } }, (error, stdout, stderr) => {
      console.log(JSON.stringify({ status: error ? error.code ?? error.signal : 0, stderr: stderr.trim() }));
    });
    console.log(JSON.stringify({ helper: helper.pid }));
  });`;

// Starts such a run: { pid, helper, signalHelper, endedAt, end }. `helper` runs the helper and
// resolves with how it ended, or, when the run ends before it says, with whether the helper
// ended with it. `signalHelper` sends that helper a signal. `endedAt` is when the run ended,
// null until it has. `end` ends the run and resolves with its exit status, or the signal that
// ended it.
function startRun(helper, deaf) {
  const child = spawn(process.execPath, ["-e", RUN, helper, TOKEN, ...(deaf ? ["deaf"] : [])], { stdio: ["pipe", "pipe", "inherit"] });
  let [endedAt, helperPid] = [null, null];
  const ended = new Promise((resolve) => child.on("exit", (code, signal) => {
    endedAt = Date.now();
    resolve(signal ?? code);
  }));
  const line = linesOf(child);
  const said = async () => JSON.parse(await line());
  // A run that has ended no longer reads its input.
  child.stdin.on("error", () => {});
  return {
    pid: child.pid,
    endedAt: () => endedAt,
    signalHelper: (signal) => process.kill(helperPid, signal),
    async helper(args) {
      child.stdin.write(`${JSON.stringify(args.map(String))}\n`);
      const started = await said();
      helperPid = started?.helper ?? null;
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
      // One whose helper still runs doesn't end with its input.
      if ((await within(END_WAIT_MS, ended)) === null) child.kill("SIGKILL");
      return ended;
    },
  };
}

// Runs the helper with the token named in its environment, as a run does, but as the child of
// a process that has ended before the helper begins (run-orphaned.swift), and resolves with
// how it ended, as a run's helper does.
function orphaned(binaries, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, HARNESS_COMPUTER_USE_TOKEN: TOKEN };
    execFile(binaries.orphan, [binaries.helper, ...args.map(String)], { env }, (error, stdout, stderr) => {
      if (error) reject(new Error(`run-orphaned failed: ${(stderr || error.message).trim()}`));
      else resolve({ status: JSON.parse(stdout || "{}").status, stderr: stderr.trim() });
    });
  });
}

// Starts the overlay over the run `pid` and resolves once it says its windows are on screen:
// { pid, said, end }. `said` resolves, once the overlay has ended and so taken its windows
// down, with all it said as it did and when it began to ({ text, at }), or with null if it
// doesn't end in time. `end` ends one that is still up, which doesn't notify.
async function showOverlay(binary, pid) {
  const child = spawn(binary, [String(pid), TOKEN, path.basename(__filename)], { stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const line = linesOf(child);
  if ((await line()) !== "shown") throw new Error("The overlay ended before its windows showed");
  // Read from now on, not when asked for, so that `at` is when the overlay said it.
  const last = (async () => {
    const lines = [];
    let at;
    for (let next = await line(); next !== null; next = await line()) {
      at ??= Date.now();
      lines.push(next);
    }
    await ended;
    return { text: lines.join("\n"), at };
  })();
  return {
    pid: child.pid,
    said: () => within(OVERLAY_WAIT_MS, last),
    async end() {
      child.kill();
      await ended;
    },
  };
}

// Starts the overlay over the process id `pid` and resolves with what differed from a refusal:
// nothing said, its usage on stderr and exit status 1. One still up after REFUSAL_WAIT_MS is
// ended by its own process id, never by its Stop, which signals `pid` if it can't remove the
// token: it is given a token that isn't there, which no Stop can fail to remove.
async function unrefused(binary, pid) {
  fs.rmSync(TOKEN, { force: true });
  const child = spawn(binary, [String(pid), TOKEN, path.basename(__filename)], { stdio: ["ignore", "pipe", "pipe"] });
  let [said, complained] = ["", ""];
  child.stdout.on("data", (data) => { said += data; });
  child.stderr.on("data", (data) => { complained += data; });
  const ended = new Promise((resolve) => child.on("close", (code, signal) => resolve(signal ?? code)));
  const status = await within(REFUSAL_WAIT_MS, ended);
  if (status === null) {
    child.kill();
    await ended;
    return [`the overlay was still up ${REFUSAL_WAIT_MS} ms after it started${said && `, having said ${JSON.stringify(said.trim())}`}`];
  }
  return [
    status !== 1 && `the overlay exited ${status}, not 1`,
    complained.trim() !== OVERLAY_USAGE && `the overlay's error was "${complained.trim()}", not its usage`,
    said && `the overlay said ${JSON.stringify(said.trim())}`,
  ].filter(Boolean);
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
    // When the run was stopped, on the clock the target's events carry. For Stop pressed on
    // the pill, when the token went. Where it stays, in Stop's last resort, when the press
    // was started: it returns only once the overlay has ended or, in its last resort, kept
    // the press waiting for 1.5 s.
    let stoppedAt;
    const pressStop = async (...after) => {
      stoppedAt = Date.now();
      await tools.run(binaries.press, [overlay.pid, ...after]).catch((error) => { unpressed = `: ${error.message}`; });
      stoppedAt = tokenWentAt() ?? stoppedAt;
    };
    let lost = null;
    const lose = () => {
      lost = Promise.resolve().then(() => (test.loss ?? tokenRemoved)({ run, pressStop })).then(() => { stoppedAt ??= Date.now(); });
      // Thrown once the helper has ended, not as an unhandled rejection in the timer below.
      lost.catch(() => {});
      return lost;
    };
    if (test.stopped) await lose();
    const target = await showTarget(binaries.target, test.target);
    const [x, y] = [target.x + target.w / 2, target.y + target.h / 2];
    // The helper the target froze. The run is stopped then, and the helper goes on once the
    // token is gone, or STOP_WAIT_MS later: whatever fails, it isn't left frozen.
    let frozen = null;
    target.froze.then(async (pid) => {
      frozen = pid;
      try {
        lose();
        for (const deadline = Date.now() + STOP_WAIT_MS; fs.existsSync(TOKEN) && Date.now() < deadline;) await sleep(5);
      } finally {
        try { process.kill(pid, "SIGCONT"); } catch { /* it has ended */ }
      }
    });
    if (test.banner) {
      await tools.run("osascript", ["-e", `display notification "${path.basename(__filename)}" with title "harness-computer-use"`]);
      await sleep(BANNER_WAIT_MS);
    }
    const timer = test.stopAfterMs && setTimeout(lose, test.stopAfterMs);
    const started = Date.now();
    let ended, took, printed;
    try {
      const command = test.command?.(target.window, x, y);
      ended = command ? await (test.orphaned ? orphaned(binaries, command) : run.helper(command)) : null;
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
    if (said?.text) await sleep(BANNER_WAIT_MS);
    const ran = await run.end();
    const seen = printed.filter((line) => line.type);
    const [buttons, expected] = [seen.filter((event) => event.type !== "move"), test.events(x, y)];
    const [moves, expectedMoves] = [seen.filter((event) => event.type === "move"), test.moves?.(x, y)];
    const held = printed.find((line) => "released" in line);
    stoppedAt = printed.find((line) => "stopped" in line)?.stopped ?? stoppedAt;
    const afterStop = seen.filter((event) => event.at >= stoppedAt && event.type !== "up");
    const upAfterStop = seen.find((event) => event.type === "up")?.at - stoppedAt;
    const killed = run.endedAt() - stoppedAt;
    return [
      ended && ended.status !== test.status && `the helper exited ${ended.status}, not ${test.status}${ended.stderr && `, with "${ended.stderr}"`}`,
      ended && ended.status === test.status && test.stderr && !test.stderr.test(ended.stderr) && `the helper's error was "${ended.stderr}"`,
      took > test.withinMs && `the helper took ${took} ms, over ${test.withinMs}`,
      test.target.includes("--freeze") && frozen === null && "the target froze no helper",
      !sameEvents(buttons, expected) && `the target received ${JSON.stringify(buttons)}, not ${JSON.stringify(expected)}`,
      expectedMoves && !sameEvents(moves, expectedMoves) && `the pointer's moves the target received were ${JSON.stringify(moves)}, not ${JSON.stringify(expectedMoves)}`,
      afterStop.length && `after Stop the target received ${JSON.stringify(afterStop)}`,
      test.upAfterStopMs !== undefined && fs.existsSync(TOKEN) && "the click token was never removed",
      test.upAfterStopMs !== undefined && !fs.existsSync(TOKEN) && !(upAfterStop >= test.upAfterStopMs)
        && `not shown that Stop came before the release: the button-up reached the target ${upAfterStop.toFixed(1)} ms after the token was removed, under ${test.upAfterStopMs}`,
      held && `the button was left held, and ${held.released ? "has been released" : "could not be released"}`,
      test.says && said === null && `the overlay was still up ${OVERLAY_WAIT_MS} ms after Stop${unpressed}`,
      test.says && said !== null && !test.says.test(said.text) && `the overlay said ${JSON.stringify(said.text)}, not ${test.says}${unpressed}`,
      test.afterRun && said?.at < run.endedAt() && `the overlay said ${JSON.stringify(said.text)} before the run had ended`,
      test.killedMs && !(killed >= test.killedMs[0] && killed <= test.killedMs[1]) && `the run ended ${killed} ms after Stop, not ${test.killedMs.join(" to ")}`,
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
  const sources = {
    helper: "device-ui", target: "checks/pointer-target", overlay: "computer-use-overlay", press: "checks/press-stop", orphan: "checks/run-orphaned",
  };
  for (const [name, source] of Object.entries(sources)) {
    binaries[name] = await tools.helperBinary(path.join(HARNESS, `${source}.swift`));
  }
  // The helper refuses while the display sleeps: the session reports the screen locked.
  const display = await mac.keepDisplayOn();
  const report = (name, failed) => {
    console.log(failed.length ? `FAIL: ${name}: ${failed.join("; ")}` : `PASS: ${name}`);
    if (failed.length) process.exitCode = 1;
  };
  try {
    for (const pid of NO_RUNS) {
      report(`the overlay refuses the process id ${pid} for its run: it says nothing, and exits 1 with its usage`, await unrefused(binaries.overlay, pid));
    }
    for (const test of CASES) report(test.name, await failures(test, binaries));
  } finally {
    display.stop();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
