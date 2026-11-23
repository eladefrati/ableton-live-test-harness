#!/usr/bin/env node
"use strict";

// Checks what device-ui.swift posts and what it refuses, and what Stop on the pill of
// computer-use-overlay.swift and its stop key (ADR-0017) do, with real mouse events and no
// Live. Each case shows a window of its own (checks/pointer-target.swift, which prints the
// mouse events it receives, pointer moves included, and when). The case runs the helper
// against that window, from a run of the check's own and with a click token as a run's
// helpers have. It then compares the helper's exit status and error with the events the
// window received. The helper's click and drag at a window are run. Its click-editor and
// drag-editor aren't, because they take only a window of Live's, whose editor they read from
// Live through Accessibility. Nor is any command run with the screen locked.
//
// The cases:
//   - The overlay is started with the process id 0, and with -1, for its run. It must refuse,
//     saying nothing and exiting 1 with its usage.
//   - A click reaches the window, under the overlay's glow too.
//   - A window that comes over the point during a click's hover gets no click. One that comes
//     over it during a drag's hover gets no button event.
//   - A point under the overlay's pill is refused, for a click and for a drag.
//   - A drag by a fraction of a point, or one that would end off the screen, is refused before
//     the pointer moves.
//   - A drag is one button-down at the point, one drag event at its end with the whole
//     distance in its delta fields, and one button-up, where the pointer then is.
//   - A held drag (ADR-0021) is a drag with a second drag event, at the press point plus both
//     moves, with the second move in its delta fields. That event reaches the window the hold
//     after the first, give or take 50 ms, also when the window moves the pointer back at each
//     drag event. A held drag whose second move would end off the screen is refused before the
//     pointer moves.
//   - Stop, the signal of Stop's last resort, or SIGTERM at a held drag's first drag event
//     brings the button up within a quarter of the hold, with no second drag event. The helper
//     exits 4, saying that the first move had happened, or dies by SIGTERM.
//   - A drag after a click (ADR-0022) is a click, one pointer move to the drag's point, and a
//     held drag from there whose press carries click count 1 and reaches the window the wait
//     after the click's release, give or take 50 ms, for a wait of 150 ms and for one of
//     40 ms, shorter than the helper's wait after a click's release. One whose drag would end off the screen
//     is refused before the pointer moves. Stop at the click lets the click complete and
//     posts nothing more, and Stop during the drag's hold ends it as a held drag's; the helper
//     exits 4 either way, saying what had happened.
//   - A helper started after Stop, which removes the token, posts nothing, for a click or for
//     a drag. So does a helper whose token's folder is gone (for a drag too) or can't be
//     written to, or whose token can't be read. Each says which.
//   - A helper whose run had ended before it began, so that process 1 is its parent from its
//     first instruction, posts nothing either, for a click or for a drag. It says that its run
//     has ended. checks/run-orphaned.swift starts it so, and reads its exit status from the
//     kernel's event queue, since only a parent can wait for a process.
//   - Stop while a click holds the button, or once a drag's move is posted, leaves the click
//     or the drag to complete. The helper exits 4, saying that it had happened.
//   - A double-click reaches the window as two clicks at the point, the second carrying click
//     count 2. Stop during its first click lets that click complete, with no second. The
//     helper ends as stopped, saying that the first click had happened.
//   - A Shift-click reaches the window with Shift on its button events, and held as each
//     arrives. Stop while it holds the button lets the click complete with Shift, and the
//     helper ends as stopped, saying that the click had happened. A Shift-click stopped
//     before the helper starts posts nothing, Shift included.
//   - Stop while a drag holds the button, before its move, brings the button up and posts
//     nothing more. So does the run killed then, by a signal sent to it alone.
//   - SIGTERM or SIGQUIT while a drag holds the button brings the button up. Then the helper
//     dies by SIGTERM, or exits with status 131 after SIGQUIT.
//   - The signal of Stop's last resort (SIGUSR2), sent to the helper, does as Stop does. While
//     a click holds the button, the click completes and the helper exits 4. While a drag holds
//     it, before its move, the button comes up and nothing more is posted.
//   - Stop while the helper waits under a notification's banner ends the wait. So do that
//     signal, the loss of the token's folder (removed or made unwritable), and the run killed
//     by a signal sent to it alone, after which the overlay says that the run has ended. For
//     these cases the check posts a notification, whose banner must show.
//   - Stop pressed on the pill itself, through Accessibility (checks/press-stop.swift): the
//     overlay removes the token, takes the glow down and keeps the pill up, its button reading
//     Stopping, while the run goes on. checks/overlay-state.swift reads the overlay's windows,
//     that button, and the pill's texts. The overlay says Stopped only once the run has ended,
//     which the check's run does when the check ends it.
//   - Over a run that goes on, the pill goes 10 s after Stop, not sooner. The overlay says that
//     the run was stopped and is still running, and the run is left running.
//   - When the token can't be removed, the overlay signals the check's run, which passes the
//     signal on to its helper as a run does. The helper stops as after Stop, the run ends by
//     itself, and only then does the overlay say Stopped. It does the same when the token's
//     folder can't be written to, where the run reads as stopped already.
//   - A run that ignores that signal keeps the glow up with the pill. It is killed 10 s after
//     Stop, not sooner, and only then does the overlay say that the run was ended.
//   - Stop pressed again 5 s into that wait, on the button that then reads Stopping, changes
//     nothing. The run is still killed 10 s after the first press.
//   - Stop pressed as the run ends says that the run has ended.
//   - Stop pressed on the pill during a gesture. The pill reads Stopping, and the overlay says
//     Stopped once the run has ended. The gestures:
//       - At the first move of a click's hover, or of a drag's, the helper posts nothing more
//         and exits 3.
//       - With a click's button down, the click completes and the helper exits 4.
//       - With a drag's button down, before its move, the button comes up and nothing more is
//         posted.
//     The press takes about 0.1 s to remove the token, longer than the helper holds a button.
//     So for these four the window suspends the helper at that event (SIGSTOP), and the check
//     lets it go on (SIGCONT) once the token is gone.
//   - The stop key, posted as the key's events carrying its modifiers (checks/press-key.swift,
//     given the key that the overlay's --stop-key names), is pressed in place of Stop in every
//     case above that presses Stop on the pill. Each must end as it does with Stop on the
//     pill, the overlay saying that it is stopping after the key. Once the pill reads
//     Stopping, it must no longer show the key.
//   - The overlay is started over a run that has ended and that nothing has waited for, which
//     still answers signal 0. The overlay must say that the run has ended. After Stop in its
//     last resort, where such a run ends at the signal, it must say Stopped, without waiting
//     to kill the run.
//   - The key is pressed as soon as the overlay has claimed it, before its windows show, with
//     an app in front that prints the keys it gets (checks/key-target.swift). It must be taken
//     as an early Stop, and none of the presses may reach that app once the overlay has said
//     it is stopping.
//   - The key is pressed with that app in front. The pill must show the key, and the key must
//     stop the run. The app must not get the key while the overlay is up. It must get the key
//     once the overlay has said its last words, while the overlay still waits for its
//     notification, and once the overlay was killed (SIGKILL).
//   - A click and a drag that the helper posts while the key's modifiers are held, before the
//     key (press-key --hold, with F13 in place of Space), and a click while Shift alone is
//     held, carry the modifiers on their button events. The keyboard's state still reads them
//     held as each event arrives. checks/pointer-target.swift reports both. These cases
//     measure the cost ADR-0017 accepts. After each, the modifiers are let go whatever
//     happened (press-key --release). A click with nothing held carries none.
//   - With two overlays up, each over a run of its own, the second's claim on the key must be
//     refused. The second overlay's pill shows no key, and its Stop still stops its run. One
//     press of the key stops only the first run.
//   - After every case that presses the key, and once more at the end, no modifier key may be
//     left held.
//
// In every case the window may receive nothing but a button-up once the run is stopped. Where
// Stop on the pill removed the token, that is from the moment the token went, which is its
// folder's modification time. Where a stopped click or drag must complete, the button-up must
// reach the window at least half the helper's hold after the token was removed (35 ms in a
// click, 25 ms after a drag's move). Where the helper was suspended with the button down, the
// button-up must not reach the window before the token went. Under that, the case fails, as
// it hasn't shown that Stop came before the release. A case that leaves the button held
// releases it and fails. The cases that end under a notification's banner, the check's own or
// the one the overlay posts as it ends, run after the other click and drag cases, each waiting
// for the banner of the case before to go.
//
// The check takes about 290 s. It takes the pointer, so it refuses, posting nothing, anywhere
// but on the click host ("clickHost" in harness/local.json). Exits 1 on failure.

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
const OVERLAY_TITLE = "harness-computer-use overlay";
// Where the target shows: [x, y, w, h] in points from the screen's top left.
const RECT = [400, 200, 400, 300];
// How long the target has to report an event after the helper has ended.
const EVENT_WAIT_MS = 300;
// How long Notification Center takes to cover the screen once a notification is posted.
const BANNER_WAIT_MS = 1000;
// How long the overlay has to end once Stop is pressed. It gives the run 10 s to end, and a
// run that its last resort then kills 1 s more to be gone.
const OVERLAY_WAIT_MS = 15000;
// How long after its signal Stop's last resort kills a run that is still there
// (computer-use-overlay.swift), and how much later than that the check may see the run end,
// counted from when it started to press Stop.
const KILL_AFTER_MS = 10000;
const KILL_SLACK_MS = 1000;
// How long after Stop the overlay leaves a run that goes on with its token gone
// (computer-use-overlay.swift), and how much later than that the check may see it go.
const LEAVE_AFTER_MS = 10000;
const LEAVE_SLACK_MS = 1000;
// How much sooner the check may read what the overlay says of a run's end than it hears of
// that end itself. The overlay reads the run's state from the kernel, where a run that has
// ended shows before the check has waited for it, and when both are waiting for the check
// it reads the overlay's words first: up to 0.4 ms sooner in 12 runs (live-notes.md).
const EXIT_NEWS_MS = 10;
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

// Undoes what a case did to the token and its folder, so that neither stays locked. The next
// case makes them anew, and the folder is removed as the check ends.
function unlockToken() {
  if (!fs.existsSync(FOLDER)) return;
  fs.chmodSync(FOLDER, 0o700);
  if (!fs.existsSync(TOKEN)) return;
  execFileSync("chflags", ["nouchg", TOKEN]);
  fs.chmodSync(TOKEN, 0o600);
}

// When the token went, if it has and its folder hasn't. Removing a file sets its folder's
// modification time, on the clock the target's events carry.
const tokenWentAt = () => (fs.existsSync(FOLDER) && !fs.existsSync(TOKEN) ? fs.statSync(FOLDER).mtimeMs : undefined);

// What stops a run. The token removed, as Stop on the pill removes it, when a case names
// nothing else; or a loss the run can't tell from that; or Stop pressed on the pill itself,
// or by its key in a case's twin (KEY_CASES), at once after the run's end if the presser is
// given the run to end; or the helper sent the
// signal of Stop's last resort, as its run passes it on; or the run killed, by a signal sent
// to it alone, which its helper doesn't get and which leaves the token there.
const tokenRemoved = () => fs.rmSync(TOKEN);
const folderGone = () => fs.rmSync(FOLDER, { recursive: true });
const folderUnwritable = () => fs.chmodSync(FOLDER, 0o500);
const tokenUnreadable = () => fs.chmodSync(TOKEN, 0o000);
const stopPressed = (the) => the.press();
const stopPressedUnwritable = (the) => { folderUnwritable(); return the.press(); };
const stopPressedAtRunEnd = (the) => the.press(the.run.pid);
// The losses that press Stop. Each case with one of them has a twin that presses the key.
const PRESSES = new Set([stopPressed, stopPressedUnwritable, stopPressedAtRunEnd]);
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
const SAID_STILL_RUNNING = new RegExp(`^Stopped: ${RUN_NAME} won't click again, and is still running\\. The mouse is yours\\.$`);
const SAID_RUN_ENDED = new RegExp(`^${RUN_NAME} has ended: the mouse is yours again\\.$`);
const SAID_ENDED_RUN = new RegExp(`^${RUN_NAME} was ended: its click token couldn't be removed\\. The mouse is yours\\.$`);

// The process ids the overlay must refuse for its run. Stop's last resort signals the run and
// may kill it, and to kill, 0 is the caller's own process group and -1 every process the user
// may signal.
const NO_RUNS = [0, -1];
const OVERLAY_USAGE = "usage: computer-use-overlay <pid> <click-token> [<run>] | --stop-key";

// How long the helper holds the button before a click's release, and after a drag's move
// before its release (device-ui.swift).
const CLICK_HOLD_MS = 70;
const DRAG_HOLD_MS = 50;

const click = (window, x, y) => ["click", window, x, y];
// A double-click and a Shift-click (ADR-0019).
const doubleClick = (window, x, y) => ["click", window, x, y, "double"];
const shiftClick = (window, x, y) => ["click", window, x, y, "shift"];
const SHIFT = ["shift"];
// A hover's first move, off the point; its second is to the point (device-ui.swift).
const firstMove = (x, y) => ({ x: x - 15, y: y - 10 });
// A drag 30 points right and 20 up, and the one drag event it posts.
const drag = (window, x, y) => ["drag", window, x, y, 30, -20];
const DRAGGED = { type: "drag", dx: 30, dy: -20 };
// A drag by another distance: one the helper must refuse for it.
const dragBy = (dx, dy) => (window, x, y) => ["drag", window, x, y, dx, dy];
// A held drag (ADR-0021): the drag above, held still for PAUSE_MS, then 10 points right and 10
// down more, or by a second move the helper must refuse.
const PAUSE_MS = 400;
const heldDragBy = (dx, dy) => (window, x, y) => ["drag", window, x, y, 30, -20, "hold", PAUSE_MS, dx, dy];
const heldDrag = heldDragBy(10, 10);
const heldEvents = (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 },
  { type: "drag", dx: 10, dy: 10, x: x + 40, y: y - 10 }];
// How far from PAUSE_MS apart the held drag's two drag events may reach the target. Each
// reaches it a little after it is posted, by an amount that varies.
const PAUSE_SLACK_MS = 50;
// A drag after a click (ADR-0022): a click 60 points left of and 40 above the target's centre,
// then, GAP_MS after its release, the held drag above from the centre; or the drag alone,
// SHORT_GAP_MS after it, a wait shorter than the 100 ms the helper waits after a click's
// release.
const GAP_MS = 150;
const SHORT_GAP_MS = 40;
const clickBy = (dx, dy) => (window, x, y) => ["click-drag", window, x - 60, y - 40, GAP_MS, x, y, 30, -20, "hold", PAUSE_MS, dx, dy];
const clickDrag = clickBy(10, 10);
const clickDragSoon = (window, x, y) => ["click-drag", window, x - 60, y - 40, SHORT_GAP_MS, x, y, 30, -20];
const clicked = (x, y) => [{ type: "down", x: x - 60, y: y - 40 }, { type: "up", x: x - 60, y: y - 40 }];
// How far from GAP_MS apart the click's release and the drag's press may reach the target, as
// for a held drag's pause.
const GAP_SLACK_MS = 50;
const afterClick = (how) => new RegExp(`^${literal(BY_STOP)}${how}, after the click at [\\d.]+, [\\d.]+: the click had happened, the drag hadn't$`);
// How soon after the first drag event the button-up must reach the target when Stop or a
// signal comes at that event. The helper looks for both every 10 ms during the hold, so well
// before the hold would have ended.
const PAUSE_STOP_MS = PAUSE_MS / 4;

// Each case: the target's options, whether harness-computer-use's overlay runs, whether the
// token can't be removed, whether the run ignores the signal of Stop's last resort, whether a
// notification's banner shows first, whether the run is stopped before the helper starts or
// how long after, and by what if not by the token's removal, and the helper's command, if a helper
// runs, given the target's window and its centre, and whether a process that has ended
// starts it, not the check's run. A target that freezes the helper says when
// itself. The run is stopped once it has, and the helper goes on once the token is gone. Then
// what must come of it: the helper's
// exit status (the signal, if one ended it), its error, how soon it ended, the button events
// the target's windows received, by the fields named, and the pointer's moves where a case
// names them, what the overlay must show while a run that Stop stopped goes on (the pill
// alone, or the pill and the border, the pill's button reading Stopping), how long after
// Stop it is pressed again, on the button that then reads Stopping, all that the
// overlay says as it ends,
// whether it may say so only once the run has ended, how long after Stop it must go and
// leave a run that goes on, at the least and at the most, how long after Stop the run must be
// killed, at the least and at the most, and the signal that ends the run, if one does. In
// every case, once the run is stopped the target must receive no event but a
// button-up, not a pointer's move either. A helper that says its click or drag had happened
// reads Stop after its release, so it says the same whether Stop came during its hold or just
// after. Such a case also says how long after the token went the button-up must reach the
// target: half the hold where the target removes the token, which leaves a loaded machine
// room, and not before it where the helper is frozen with the button down until the token has
// gone. Under that, the token may have gone after the helper posted its release, and the case
// fails as not shown. A held drag's case (ADR-0021) may also say how far apart its two drag
// events must reach the target, at the least and at the most, and how soon after the first
// the button-up must, where Stop or a signal comes at that event. A drag after a click's
// (ADR-0022) may say how far apart the click's release and the drag's press must reach it.
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
  // What a click is refused for, a drag is too. Each command calls the helper's guards
  // itself (device-ui.swift), so each is run against them.
  {
    name: "a window that comes over the point during a drag's hover gets no button event, and the helper names it",
    target: [...RECT, "--cover"],
    command: drag,
    status: 1,
    stderr: /^The window at the point is pointer-target\S* \d+, not \d+$/,
    events: () => [],
  },
  {
    name: "a drag from a point under harness-computer-use's pill is refused, naming the pill",
    overlay: true,
    target: ["--under", PILL_TITLE],
    command: drag,
    status: 1,
    stderr: /^The point is under harness-computer-use's pill$/,
    events: () => [],
  },
  {
    name: "a drag by a fraction of a point is refused before the pointer moves",
    target: RECT,
    command: dragBy(0.5, 0),
    status: 1,
    stderr: /^A drag moves whole points, at least 1 on its longer axis and at most 400 on either, not 0\.5, 0\.0$/,
    moves: () => [],
    events: () => [],
  },
  // 400 points up from the target's centre is above the top of the screen with the menu bar.
  {
    name: "a drag that would end off the screen is refused before the pointer moves",
    target: RECT,
    command: dragBy(0, -400),
    status: 1,
    stderr: /^A drag to \(.+\) ends off screen$/,
    moves: () => [],
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
    stderr: stoppedError(),
    events: () => [],
  },
  {
    name: "a helper started after Stop for a drag posts nothing",
    target: RECT,
    stopped: true,
    command: drag,
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
    name: "a helper started for a drag in a run whose token's folder is gone posts nothing, and says that it can't tell that the run wasn't stopped",
    target: RECT,
    stopped: true,
    loss: folderGone,
    command: drag,
    status: STOPPED,
    stderr: stoppedError(FOLDER_GONE),
    events: () => [],
  },
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
    name: "a helper started for a drag whose run had ended before it began, with process 1 for a parent from its start, posts nothing, "
      + "and says that its run has ended",
    target: RECT,
    orphaned: true,
    command: drag,
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
    name: "a double-click reaches the target as two clicks at the point, the second carrying click count 2",
    target: RECT,
    command: doubleClick,
    status: 0,
    events: (x, y) => [{ type: "down", x, y, clicks: 1 }, { type: "up", x, y, clicks: 1 },
      { type: "down", x, y, clicks: 2 }, { type: "up", x, y, clicks: 2 }],
  },
  {
    name: "Stop during a double-click's first click: that click completes, there is no second, and the helper ends as stopped, saying the first click had happened",
    target: [...RECT, "--stop", TOKEN],
    command: doubleClick,
    status: HAPPENED,
    stderr: new RegExp(`^${literal(BY_STOP)}, after the first click of the double-click at [\\d.]+, [\\d.]+: that click had happened$`),
    upAfterStopMs: CLICK_HOLD_MS / 2,
    events: (x, y) => [{ type: "down", x, y, clicks: 1 }, { type: "up", x, y, clicks: 1 }],
  },
  {
    name: "a Shift-click reaches the target with Shift on its button events and held as each arrives",
    target: RECT,
    command: shiftClick,
    status: 0,
    modifiers: true,
    events: (x, y) => [{ type: "down", x, y, flags: SHIFT, held: SHIFT }, { type: "up", x, y, flags: SHIFT, held: SHIFT }],
  },
  {
    name: "Stop while a Shift-click holds the button: the click completes with Shift, and the helper ends as stopped, saying the click had happened",
    target: [...RECT, "--stop", TOKEN],
    command: shiftClick,
    status: HAPPENED,
    stderr: happened("click"),
    upAfterStopMs: CLICK_HOLD_MS / 2,
    modifiers: true,
    events: (x, y) => [{ type: "down", x, y, flags: SHIFT }, { type: "up", x, y, flags: SHIFT }],
  },
  {
    name: "a Shift-click stopped before the helper starts posts nothing, Shift included",
    target: RECT,
    stopped: true,
    command: shiftClick,
    status: STOPPED,
    stderr: stoppedError(),
    modifiers: true,
    events: () => [],
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
  {
    name: "a held drag's events: down, a drag at the first move's end, none for the hold, a drag at both moves' end carrying the second, up",
    target: RECT,
    command: heldDrag,
    status: 0,
    pausedMs: [PAUSE_MS - PAUSE_SLACK_MS, PAUSE_MS + PAUSE_SLACK_MS],
    events: (x, y) => [...heldEvents(x, y), { type: "up", x: x + 40, y: y - 10 }],
  },
  {
    name: "a held drag's second move is placed from the press point when the control has moved the pointer back, and the button comes up where the pointer is",
    target: [...RECT, "--return"],
    command: heldDrag,
    status: 0,
    pausedMs: [PAUSE_MS - PAUSE_SLACK_MS, PAUSE_MS + PAUSE_SLACK_MS],
    events: (x, y) => [...heldEvents(x, y), { type: "up", x, y }],
  },
  // 400 points up from the first move's end is above the top of the screen.
  {
    name: "a held drag whose second move would end off the screen is refused before the pointer moves",
    target: RECT,
    command: heldDragBy(0, -400),
    status: 1,
    stderr: /^A drag to \(.+\) ends off screen$/,
    moves: () => [],
    events: () => [],
  },
  {
    name: "Stop during a held drag's hold: the button comes up at once where the pointer is, with no second move, and the helper ends as stopped, "
      + "saying the first move had happened",
    target: [...RECT, "--stop-at-drag", TOKEN],
    command: heldDrag,
    status: HAPPENED,
    stderr: new RegExp(`^${literal(BY_STOP)}, and the helper released the button at [\\d.]+, [\\d.]+ during the drag's hold: its first move had happened, its second hadn't$`),
    upAfterDragMs: PAUSE_STOP_MS,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  {
    name: "Stop's signal during a held drag's hold: the button comes up at once, with no second move, and the helper ends as stopped, saying the first move had happened",
    target: [...RECT, "--signal-at-drag", "SIGUSR2"],
    command: heldDrag,
    status: HAPPENED,
    stderr: new RegExp(`^${literal(BY_STOP)}, and the helper released the button at [\\d.]+, [\\d.]+ during the drag's hold: its first move had happened, its second hadn't$`),
    upAfterDragMs: PAUSE_STOP_MS,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  {
    name: "SIGTERM during a held drag's hold: the helper releases the button at once where the pointer is, with no second move, then dies by the signal",
    target: [...RECT, "--signal-at-drag", "SIGTERM"],
    command: heldDrag,
    status: "SIGTERM",
    upAfterDragMs: PAUSE_STOP_MS,
    events: (x, y) => [{ type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  {
    name: "a drag after a click: the click, one move to the drag's point, then the held drag, its press carrying click count 1 the wait after the click's release",
    target: RECT,
    command: clickDrag,
    status: 0,
    gapMs: [GAP_MS - GAP_SLACK_MS, GAP_MS + GAP_SLACK_MS],
    pausedMs: [PAUSE_MS - PAUSE_SLACK_MS, PAUSE_MS + PAUSE_SLACK_MS],
    moves: (x, y) => [firstMove(x - 60, y - 40), { x: x - 60, y: y - 40 }, { x, y }],
    events: (x, y) => [...clicked(x, y), { ...heldEvents(x, y)[0], clicks: 1 }, ...heldEvents(x, y).slice(1), { type: "up", x: x + 40, y: y - 10 }],
  },
  {
    name: "a drag after a click, the wait shorter than a click's own: its press reaches the target that wait after the click's release",
    target: RECT,
    command: clickDragSoon,
    status: 0,
    gapMs: [SHORT_GAP_MS - GAP_SLACK_MS, SHORT_GAP_MS + GAP_SLACK_MS],
    events: (x, y) => [...clicked(x, y), { type: "down", x, y, clicks: 1 }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
  },
  {
    name: "a drag after a click whose drag would end off the screen is refused before the pointer moves",
    target: RECT,
    command: clickBy(0, -400),
    status: 1,
    stderr: /^A drag to \(.+\) ends off screen$/,
    moves: () => [],
    events: () => [],
  },
  {
    name: "Stop at a drag after a click's click: the click completes, nothing more is posted, and the helper ends as stopped, saying the click had happened and the drag hadn't",
    target: [...RECT, "--stop", TOKEN],
    command: clickDrag,
    status: HAPPENED,
    stderr: afterClick(""),
    events: clicked,
  },
  {
    name: "Stop during the hold of a drag after a click: the button comes up at once, with no second move, and the helper ends as stopped, saying the first move had happened",
    target: [...RECT, "--stop-at-drag", TOKEN],
    command: clickDrag,
    status: HAPPENED,
    stderr: new RegExp(`^${literal(BY_STOP)}, and the helper released the button at [\\d.]+, [\\d.]+ during the drag's hold: its first move had happened, its second hadn't$`),
    upAfterDragMs: PAUSE_STOP_MS,
    events: (x, y) => [...clicked(x, y), { type: "down", x, y }, { ...DRAGGED, x: x + 30, y: y - 20 }, { type: "up", x: x + 30, y: y - 20 }],
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
  // overlay posts as it ends. The cover outlasts the case by a few seconds, and the target of
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
    name: "Stop on the pill removes the token: a helper started then posts nothing, the overlay takes the border down and keeps the pill up, "
      + "reading Stopping, while the run goes on, and says Stopped only once the run has ended",
    overlay: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    events: () => [],
    stopping: "pill",
    says: SAID_STOPPED,
    afterRun: true,
  },
  {
    name: "Stop on the pill removes the token and the run goes on: the pill stays, reading Stopping, and goes 10 s after Stop, not sooner, "
      + "the overlay saying that the run was stopped and is still running, and the run is left running",
    overlay: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    events: () => [],
    stopping: "pill",
    says: SAID_STILL_RUNNING,
    leavesMs: [LEAVE_AFTER_MS, LEAVE_AFTER_MS + LEAVE_SLACK_MS],
  },
  // Stop on the pill while the helper is in a gesture. The press takes longer to remove the
  // token than the helper holds a button, so the target freezes the helper at the event the
  // case names, and it goes on once the token is gone.
  {
    name: "Stop on the pill during a click's hover, the helper frozen at its first move: it posts nothing more, "
      + "the pill reads Stopping while the run goes on, and the overlay says Stopped once the run has ended",
    overlay: true,
    target: [...RECT, "--freeze", "move"],
    loss: stopPressed,
    command: click,
    status: STOPPED,
    stderr: stoppedError(),
    moves: (x, y) => [firstMove(x, y)],
    events: () => [],
    stopping: "pill",
    says: SAID_STOPPED,
    afterRun: true,
  },
  {
    name: "Stop on the pill during a drag's hover, the helper frozen at its first move: it posts nothing more, "
      + "the pill reads Stopping while the run goes on, and the overlay says Stopped once the run has ended",
    overlay: true,
    target: [...RECT, "--freeze", "move"],
    loss: stopPressed,
    command: drag,
    status: STOPPED,
    stderr: stoppedError(),
    moves: (x, y) => [firstMove(x, y)],
    events: () => [],
    stopping: "pill",
    says: SAID_STOPPED,
    afterRun: true,
  },
  {
    name: "Stop on the pill while a click holds the button, the helper frozen with it down: the click completes, the helper ends as stopped, "
      + "saying the click had happened, the pill reads Stopping while the run goes on, and the overlay says Stopped once the run has ended",
    overlay: true,
    target: [...RECT, "--freeze", "down"],
    loss: stopPressed,
    command: click,
    status: HAPPENED,
    stderr: happened("click"),
    upAfterStopMs: 0,
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
    stopping: "pill",
    says: SAID_STOPPED,
    afterRun: true,
  },
  {
    name: "Stop on the pill while a drag holds the button, before its move, the helper frozen with it down: the button comes up at the "
      + "press point, with no drag event, the pill reads Stopping while the run goes on, and the overlay says Stopped once the run has ended",
    overlay: true,
    target: [...RECT, "--freeze", "down"],
    loss: stopPressed,
    command: drag,
    status: STOPPED,
    stderr: stoppedError(),
    events: (x, y) => [{ type: "down", x, y }, { type: "up", x, y }],
    stopping: "pill",
    says: SAID_STOPPED,
    afterRun: true,
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
  // No helper runs here. One that waits under a notification's cover gives up after 10 s, as
  // long as the run is given, and a helper whose run is killed is the case further up.
  {
    name: "Stop on the pill when the token can't be removed and the run ignores the signal: the border stays up and the pill reads "
      + "Stopping, the run is killed 10 s after Stop, not sooner, and only then does the overlay say that the run was ended",
    overlay: true,
    immutable: true,
    deaf: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    events: () => [],
    stopping: "border",
    says: SAID_ENDED_RUN,
    afterRun: true,
    killedMs: [KILL_AFTER_MS, KILL_AFTER_MS + KILL_SLACK_MS],
    run: "SIGKILL",
  },
  // A second press that counted would signal the run again and give it 10 s more.
  {
    name: "Stop pressed again on the pill, which reads Stopping, 5 s into its last resort over a run that ignores the signal: "
      + "the run is still killed 10 s after the first press, not later, and the overlay says that the run was ended",
    overlay: true,
    immutable: true,
    deaf: true,
    target: RECT,
    stopped: true,
    loss: stopPressed,
    againAfterMs: 5000,
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
    loss: stopPressedUnwritable,
    events: () => [],
    says: SAID_STOPPED,
    afterRun: true,
  },
  {
    name: "Stop on the pill once the run has ended says that the run has ended, not Stopped",
    overlay: true,
    target: RECT,
    stopped: true,
    loss: stopPressedAtRunEnd,
    events: () => [],
    says: SAID_RUN_ENDED,
    run: "SIGTERM",
  },
];

// Each case that presses Stop on the pill again with the stop key in its place. The key does
// what Stop on the pill does, through the button's action (ADR-0017), so every one of them
// must end as it does with Stop on the pill.
const KEY_CASES = CASES.filter((test) => PRESSES.has(test.loss))
  .map((test) => ({ ...test, by: "key", name: `${test.name} (the stop key in place of Stop on the pill)` }));

// The overlay over a run that has ended and that its parent hasn't waited for. Such a run
// stays in the process table, where it still answers signal 0. The run ends by a signal of
// the check's own or, in Stop's last resort, by the signal Stop sends it. Each case: whether
// Stop is pressed on the pill with a token that can't be removed, and all that the overlay
// must say as it ends, within END_WAIT_MS of the run's end.
const UNREAPED = [
  {
    name: "a run that has ended and that nothing has waited for, which still answers signal 0: the overlay says that the run has ended",
    says: SAID_RUN_ENDED,
  },
  {
    name: "Stop on the pill when the token can't be removed and the run ends at the signal, with nothing waiting for it: "
      + "the overlay says Stopped, and doesn't wait to kill the run",
    lastResort: true,
    says: SAID_STOPPED,
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
// the helper's environment, and which the overlay is given as its run. Stop's last resort
// signals the run, and kills one that doesn't end, so the check itself is never the run. For
// each line of arguments it reads it starts the helper, prints the helper's pid and, once the
// helper ends, how: its exit status (the signal, if one ended it) and what it wrote to
// stderr. It ends when its input does. On the signal of Stop's last resort (SIGUSR2) it does
// as a run does. It passes the signal on to its helper and ends by itself once the helper
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

// Starts such a run, with the click token `token`: { pid, helper, signalHelper, endedAt, end }. `helper` runs the helper and
// resolves with how it ended, or, when the run ends before it says, with whether the helper
// ended with it. `signalHelper` sends that helper a signal. `endedAt` is when the run ended,
// null until it has. `end` ends the run and resolves with its exit status, or the signal that
// ended it.
function startRun(helper, deaf, token = TOKEN) {
  const child = spawn(process.execPath, ["-e", RUN, helper, token, ...(deaf ? ["deaf"] : [])], { stdio: ["pipe", "pipe", "inherit"] });
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

// Starts the overlay over the run `pid`, with the click token `token`, and resolves once it
// says its windows are on screen: { pid, keyRefused, stopping, ending, exited, said, end }.
// `keyRefused` is why it couldn't claim the stop key, as it said before "shown", or null.
// `stopping` resolves with when the overlay said that Stop was pressed ("stopping"), if it
// does. `ending` resolves once it has said its last words, which it says before it waits for
// its notification, and `exited` is whether it has exited. `said` resolves, once the overlay has ended and so taken
// its windows down, with all else it said as it did and when it began to ({ text, at }), or
// with null if it doesn't end in time. `end` ends one that is still up, which doesn't notify,
// by SIGTERM or the signal it is given.
async function showOverlay(binary, pid, token = TOKEN) {
  const child = spawn(binary, [String(pid), token, path.basename(__filename)], { stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const line = linesOf(child);
  let [first, keyRefused] = [await line(), null];
  while (first?.startsWith("no stop key: ")) [keyRefused, first] = [first.slice("no stop key: ".length), await line()];
  if (first !== "shown") throw new Error("The overlay ended before its windows showed");
  let [saidStopping, beganToEnd] = [null, null];
  const stopping = new Promise((resolve) => { saidStopping = resolve; });
  const ending = new Promise((resolve) => { beganToEnd = resolve; });
  let exited = false;
  ended.then(() => { exited = true; });
  // Read from now on, not when asked for, so that `at` is when the overlay said it.
  const last = (async () => {
    const lines = [];
    let at;
    for (let next = await line(); next !== null; next = await line()) {
      if (next === "stopping") {
        saidStopping(Date.now());
        continue;
      }
      at ??= Date.now();
      lines.push(next);
      beganToEnd();
    }
    beganToEnd();
    await ended;
    return { text: lines.join("\n"), at };
  })();
  return {
    pid: child.pid,
    keyRefused,
    stopping: () => stopping,
    // Resolves once the overlay has said its last words, before the notification it then
    // waits for, or once it has ended.
    ending: () => within(OVERLAY_WAIT_MS, ending),
    exited: () => exited,
    said: () => within(OVERLAY_WAIT_MS, last),
    async end(signal = "SIGTERM") {
      child.kill(signal);
      await ended;
    },
  };
}

// Starts the overlay over the process id `pid` and resolves with what differed from a refusal:
// nothing said, its usage on stderr and exit status 1. One still up after REFUSAL_WAIT_MS is
// ended by its own process id, never by its Stop, which signals `pid` if it can't remove the
// token. It is given a token that isn't there, which no Stop can fail to remove.
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

// Starts a process that ends at the first signal, as the child of one that never waits for
// it: { pid, state, end }. `state` is what ps says of it, which starts with Z once the process
// has ended and stays unreaped ("Z+" when the check runs in a terminal's foreground), and is
// empty once it is gone. `end` ends it and the process that started it.
async function startUnreaped() {
  // The shell starts the process, says its id and becomes a sleep itself, which waits for
  // nothing.
  const parent = spawn("/bin/sh", ["-c", "sleep 600 & echo $!; exec sleep 600"], { stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise((resolve) => parent.on("exit", resolve));
  const pid = Number(await linesOf(parent)());
  if (!pid) {
    parent.kill();
    throw new Error("The unreaped run didn't start");
  }
  return {
    pid,
    state() {
      try {
        return execFileSync("ps", ["-o", "stat=", "-p", pid], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    },
    async end() {
      try { process.kill(pid); } catch { /* it has ended */ }
      parent.kill();
      await ended;
    },
  };
}

// Runs one case of UNREAPED and resolves with what differed from what it expects, nothing if
// it passed.
async function unreapedFailures(test, binaries) {
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  if (test.lastResort) execFileSync("chflags", ["uchg", TOKEN]);
  const run = await startUnreaped();
  let overlay = null;
  try {
    overlay = await showOverlay(binaries.overlay, run.pid);
    let unpressed = "";
    if (test.lastResort) await tools.run(binaries.press, [overlay.pid]).catch((error) => { unpressed = `: ${error.message}`; });
    else process.kill(run.pid, "SIGTERM");
    const said = await within(END_WAIT_MS, overlay.said());
    const state = run.state();
    return [
      !state.startsWith("Z") && `the run wasn't left unreaped: ps gives its state as "${state}"`,
      said === null && `the overlay was still up ${END_WAIT_MS} ms after the run ended${unpressed}`,
      said !== null && !test.says.test(said.text) && `the overlay said ${JSON.stringify(said.text)}, not ${test.says}${unpressed}`,
    ].filter(Boolean);
  } finally {
    if (overlay) await overlay.end();
    await run.end();
    unlockToken();
  }
}

// What differed, while a run that Stop stopped goes on, from what the overlay must show
// then (ADR-0015): it has said that it is stopping, and its pill is on screen, the button
// reading Stopping. Its border is up too in Stop's last resort (`shows` is "border"), where
// the run can still click, and is down once the token is gone ("pill").
async function stoppingFailures(shows, overlay, binary, stopKey) {
  const said = await within(END_WAIT_MS, overlay.stopping());
  let shown;
  try {
    shown = JSON.parse(await tools.run(binary, [overlay.pid]));
  } catch (error) {
    return [`what the overlay shows couldn't be read: ${error.message}`];
  }
  const border = shown.windows.includes(OVERLAY_TITLE);
  return [
    said === null && "the overlay didn't say that it was stopping",
    !shown.windows.includes(PILL_TITLE) && "the pill wasn't on screen while the stopped run went on",
    shown.button !== "Stopping" && `the pill's button read ${JSON.stringify(shown.button)}, not "Stopping", while the stopped run went on`,
    stopKey && shown.texts.includes(stopKey.symbols) && `the pill still showed the stop key ${JSON.stringify(stopKey.symbols)} while it read Stopping`,
    border && shows === "pill" && "the border was still up once the token was gone",
    !border && shows === "border" && "the border wasn't up while the run could still click",
  ].filter(Boolean);
}

// The modifier keys the system reads as held now, by name. A posted key event that carries
// modifiers as its flags leaves them held until their release is posted (live-notes.md).
const HELD_MODIFIERS = `ObjC.import("AppKit");
const flags = $.NSEvent.modifierFlags;
[["shift", 0x20000], ["control", 0x40000], ["option", 0x80000], ["command", 0x100000]]
  .filter(([, mask]) => flags & mask).map(([name]) => name).join(",")`;
async function heldModifiers() {
  return (await tools.run("osascript", ["-l", "JavaScript", "-e", HELD_MODIFIERS])).trim().split(",").filter(Boolean);
}

// What differs from no modifier key held, naming those that are, which it then lets go of so
// that no later case starts with them held.
async function leftHeld(binaries) {
  const held = await heldModifiers();
  if (!held.length) return [];
  await tools.run(binaries.key, [F13, ...held, "--release"]).catch(() => {});
  return [`modifier keys were left held: ${held.join(", ")}`];
}

// Presses the stop key, as the overlay's --stop-key gives it (`binaries.stopKey`), with the
// press-key options `extra`.
const pressStopKey = (binaries, ...extra) => tools.run(binaries.key, [binaries.stopKey.code, ...binaries.stopKey.modifiers, ...extra]);

// Starts key-target.swift, the app in front as Live is in a run, and resolves once it says
// whether it took the front: { front, keys, end }, or why it didn't as `front` false or
// null. `keys(code, since)` counts the presses of the key `code` it got, after the time
// `since` if given. `end` ends it.
async function showKeyTarget(binary) {
  const child = spawn(binary, [], { stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const got = [];
  let front = null;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const said = JSON.parse(line);
    if ("front" in said) front = said.front;
    else got.push(said);
  });
  for (const deadline = Date.now() + END_WAIT_MS; front === null && Date.now() < deadline;) await sleep(20);
  return {
    front,
    keys: (code, since = 0) => got.filter((key) => key.key === code && key.at > since).length,
    async end() {
      child.kill();
      await ended;
    },
  };
}

// The stop key pressed as soon as the overlay has claimed it, before it says that its windows
// are on screen. The overlay must take it as an early Stop on the pill (live-notes.md), saying
// "stopping" first, then "shown" once the pill is listed, with the border left out and the
// pill reading Stopping. The presses that come before the claim go to key-target, in front,
// and none may reach it once the overlay has said "stopping".
async function earlyKeyFailures(binaries) {
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  const run = startRun(binaries.helper);
  const target = await showKeyTarget(binaries.keyTarget);
  let child = null;
  let ended;
  try {
    if (!target.front) return [`key-target ${target.front === null ? "didn't say whether it" : "didn't"} take the front`];
    child = spawn(binaries.overlay, [String(run.pid), TOKEN, path.basename(__filename)], { stdio: ["ignore", "pipe", "inherit"] });
    ended = new Promise((resolve) => child.on("exit", resolve));
    const line = linesOf(child);
    const unpressed = pressStopKey(binaries, "--until-gone", TOKEN).then(() => "", (error) => error.message);
    const first = await within(END_WAIT_MS, line());
    const stoppingAt = Date.now();
    const second = await within(END_WAIT_MS, line());
    const why = await unpressed;
    await sleep(EVENT_WAIT_MS);
    const leaked = target.keys(binaries.stopKey.code, stoppingAt);
    let shown = null;
    try {
      shown = JSON.parse(await tools.run(binaries.state, [child.pid]));
    } catch (error) {
      return [`what the overlay shows couldn't be read: ${error.message}`];
    }
    return [
      why && `the stop key couldn't be pressed: ${why}`,
      first !== "stopping" && `the overlay said ${JSON.stringify(first)} first, not "stopping": the key wasn't taken before its windows showed`,
      second !== "shown" && `the overlay then said ${JSON.stringify(second)}, not "shown"`,
      shown.windows.includes(OVERLAY_TITLE) && "the border was up once the token was gone",
      !shown.windows.includes(PILL_TITLE) && "the pill wasn't on screen",
      shown.button !== "Stopping" && `the pill's button read ${JSON.stringify(shown.button)}, not "Stopping"`,
      leaked && `key-target got the stop key ${leaked} times after the overlay said "stopping"`,
    ].filter(Boolean);
  } finally {
    if (child) {
      child.kill();
      await ended;
    }
    await target.end();
    await run.end();
    unlockToken();
  }
}

// The stop key pressed with another app in front, as Live is in a run (key-target.swift):
// the pill shows the key, the key stops the run and that app doesn't get it while the overlay
// is up. Once the overlay has gone, the key is that app's again. With `killed` the overlay
// is killed (SIGKILL) before the key is pressed, which must then go to that app.
async function keyTargetFailures(binaries, { killed = false } = {}) {
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  const run = startRun(binaries.helper);
  const target = await showKeyTarget(binaries.keyTarget);
  let overlay = null;
  try {
    if (!target.front) return [`key-target ${target.front === null ? "didn't say whether it" : "didn't"} take the front`];
    overlay = await showOverlay(binaries.overlay, run.pid);
    const { texts } = JSON.parse(await tools.run(binaries.state, [overlay.pid]));
    const stopKeys = () => target.keys(binaries.stopKey.code);
    const showsKey = !texts.includes(binaries.stopKey.symbols) && `the pill's texts were ${JSON.stringify(texts)}, with no ${JSON.stringify(binaries.stopKey.symbols)}`;
    if (killed) {
      await overlay.end("SIGKILL");
      await pressStopKey(binaries);
      await sleep(EVENT_WAIT_MS);
      return [
        showsKey,
        stopKeys() !== 1 && `the app in front got the stop key ${stopKeys()} times once the overlay had been killed, not once`,
        !fs.existsSync(TOKEN) && "the key removed the token with the overlay killed",
      ].filter(Boolean);
    }
    await pressStopKey(binaries);
    const stopping = await within(END_WAIT_MS, overlay.stopping());
    await sleep(EVENT_WAIT_MS);
    const whileUp = stopKeys();
    const tokenLeft = fs.existsSync(TOKEN);
    // The key once the overlay has said its last words, while it waits for its notification.
    // It gives the key up first, so the app in front must get this press.
    await run.end();
    await overlay.ending();
    await pressStopKey(binaries);
    const pressedWhileUp = !overlay.exited();
    const said = await overlay.said();
    await sleep(EVENT_WAIT_MS);
    const afterwards = stopKeys() - whileUp;
    return [
      showsKey,
      stopping === null && "the overlay didn't say that it was stopping after the key",
      tokenLeft && "the click token was still there after the key",
      whileUp && `the app in front got the stop key ${whileUp} times while the overlay was up`,
      said === null && `the overlay was still up ${OVERLAY_WAIT_MS} ms after the run had ended`,
      said !== null && !SAID_STOPPED.test(said.text) && `the overlay said ${JSON.stringify(said.text)}, not ${SAID_STOPPED}`,
      afterwards !== 1 && `the app in front got the stop key ${afterwards} times once the overlay had said its last words, not once`,
      !pressedWhileUp && "not shown that the key is given up before the notification: the overlay had exited before the key was pressed",
    ].filter(Boolean);
  } finally {
    if (overlay) await overlay.end();
    await target.end();
    await run.end();
    unlockToken();
  }
}

// A key no app answers, pressed in place of the stop key's own where only its modifiers count.
const F13 = 105;
// How long a person may hold the stop key's modifiers before reaching its key, and how far
// into that the helper's gesture starts.
const HOLD_MS = 1000;
const GESTURE_INTO_HOLD_MS = 200;

// A gesture the helper posts (`command`, a click or a drag at the target) while a person holds
// the modifier keys `held`, as one holds the stop key's before its key (ADR-0017). The helper
// builds its events from the keyboard's state, so its button events carry the modifiers held
// then, and the keyboard's state must still read them held as each event arrives. This
// measures a cost ADR-0017 accepts: an event posted with its modifiers cleared lets go of the
// person's keys for every app (live-notes.md). A hover's moves carried them in one run and not
// in another, so they are left out. With nothing held, nothing is pressed: the control, whose
// events carry none. No overlay runs, and F13 is pressed in place of the key, which would
// otherwise go to the app in front. Whatever happens, the modifiers are let go of at the end.
async function heldModifiersFailures(binaries, held, command) {
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  const run = startRun(binaries.helper);
  const target = await showTarget(binaries.target, RECT);
  const [x, y] = [target.x + target.w / 2, target.y + target.h / 2];
  const same = (names, wanted) => [...names].sort().join() === [...wanted].sort().join();
  let printed = [];
  try {
    const pressed = held.length
      ? tools.run(binaries.key, [F13, ...held, "--hold", HOLD_MS]).then(() => "", (error) => error.message)
      : Promise.resolve("");
    if (held.length) await sleep(GESTURE_INTO_HOLD_MS);
    const ended = await run.helper(command(target.window, x, y));
    const unpressed = await pressed;
    await sleep(EVENT_WAIT_MS);
    printed = await target.end();
    const events = printed.filter((event) => "type" in event);
    const buttonEvents = events.filter((event) => event.type !== "move");
    const buttons = buttonEvents.map((event) => event.type).join(", ");
    const wantedButtons = command === drag ? "down, drag, up" : "down, up";
    const listed = (key, list = events) => list.map((event) => `${event.type} [${event[key].join(", ")}]`).join(", ");
    return [
      unpressed && `the modifiers couldn't be held: ${unpressed}`,
      ended.status !== 0 && `the helper exited ${ended.status}${ended.stderr && `, with "${ended.stderr}"`}`,
      buttons !== wantedButtons && `the target received the button events ${buttons || "none"}, not ${wantedButtons}`,
      !events.some((event) => event.type === "move") && "the target received no move of the hover",
      !buttonEvents.every((event) => same(event.flags, held)) && `the button events carried ${listed("flags", buttonEvents)}, not [${held.join(", ")}]`,
      !events.every((event) => same(event.held, held)) && `the keyboard read held, as each event arrived, ${listed("held")}, not [${held.join(", ")}]`,
    ].filter(Boolean);
  } finally {
    if (!printed.length) await target.end();
    if (held.length) await tools.run(binaries.key, [F13, ...held, "--release"]).catch(() => {});
    await run.end();
    unlockToken();
  }
}

// Two runs, each with its overlay and its own token. The first overlay holds the stop key, so
// the second's exclusive claim is refused (ADR-0017). The second must say so before it shows,
// show no key on its pill and still stop its run from its pill's Stop; one press of the key
// must stop only the first run.
async function twoOverlaysFailures(binaries) {
  const second = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pointer-guards-")), "token");
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  fs.writeFileSync(second, "");
  const runs = [startRun(binaries.helper), startRun(binaries.helper, false, second)];
  const overlays = [];
  try {
    overlays.push(await showOverlay(binaries.overlay, runs[0].pid));
    overlays.push(await showOverlay(binaries.overlay, runs[1].pid, second));
    const texts = await Promise.all(overlays.map(async (overlay) => JSON.parse(await tools.run(binaries.state, [overlay.pid])).texts));
    const refused = new RegExp(`^another program holds ${literal(binaries.stopKey.words)}$`);
    await pressStopKey(binaries);
    const firstStopping = await within(END_WAIT_MS, overlays[0].stopping());
    const secondStopping = await within(EVENT_WAIT_MS, overlays[1].stopping());
    const [firstTokenLeft, secondTokenLeft] = [fs.existsSync(TOKEN), fs.existsSync(second)];
    let unpressed = "";
    await tools.run(binaries.press, [overlays[1].pid]).catch((error) => { unpressed = error.message; });
    const pillStopping = await within(END_WAIT_MS, overlays[1].stopping());
    return [
      overlays[0].keyRefused && `the first overlay couldn't claim the stop key: ${overlays[0].keyRefused}`,
      !texts[0].includes(binaries.stopKey.symbols) && `the first pill's texts were ${JSON.stringify(texts[0])}, with no ${JSON.stringify(binaries.stopKey.symbols)}`,
      !refused.test(overlays[1].keyRefused ?? "") && `the second overlay's claim wasn't refused as held by another program: it said ${JSON.stringify(overlays[1].keyRefused)}`,
      texts[1].includes(binaries.stopKey.symbols) && `the second pill shows the stop key, which its overlay couldn't claim: ${JSON.stringify(texts[1])}`,
      (firstStopping === null || firstTokenLeft) && "the key didn't stop the first run",
      (secondStopping !== null || !secondTokenLeft) && "the key stopped the second run too",
      unpressed && `Stop couldn't be pressed on the second pill: ${unpressed}`,
      (pillStopping === null || fs.existsSync(second)) && "Stop on the second pill didn't stop its run",
    ].filter(Boolean);
  } finally {
    for (const overlay of overlays) await overlay.end();
    for (const run of runs) await run.end();
    unlockToken();
    fs.rmSync(path.dirname(second), { recursive: true, force: true });
  }
}

// By value, so that a field holding a list (flags, held) compares too.
const sameEvents = (seen, expected) => seen.length === expected.length
  && expected.every((event, i) => Object.entries(event).every(([field, value]) => JSON.stringify(seen[i][field]) === JSON.stringify(value)));

// Runs one case and resolves with what differed from what it expects, nothing if it passed.
async function failures(test, binaries) {
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(TOKEN, "");
  if (test.immutable) execFileSync("chflags", ["uchg", TOKEN]);
  const run = startRun(binaries.helper, test.deaf);
  let overlay = null;
  try {
    if (test.overlay) overlay = await showOverlay(binaries.overlay, run.pid);
    // Why Stop couldn't be pressed, if it couldn't. An overlay that is ending shows no pill.
    let unpressed = "";
    // When the run was stopped, on the clock the target's events carry. For Stop pressed on
    // the pill, when the token went. Where it stays, in Stop's last resort, when the press
    // was started, a moment before the overlay signals the run.
    let stoppedAt;
    const pressStop = async (...after) => {
      stoppedAt = Date.now();
      await tools.run(binaries.press, [overlay.pid, ...after]).catch((error) => { unpressed = `: ${error.message}`; });
      stoppedAt = tokenWentAt() ?? stoppedAt;
    };
    // The key, as press-stop presses the pill's Stop. Given the run, press-key ends it and
    // presses as soon as it has gone. Otherwise the press counts once the overlay has said
    // that it is stopping, as press-stop returns once the button's action has run.
    const pressKey = async (ended) => {
      if (overlay.keyRefused) {
        keyMissed = `the overlay couldn't claim the stop key (${overlay.keyRefused})`;
        return;
      }
      stoppedAt = Date.now();
      const failed = await pressStopKey(binaries, ...(ended ? ["--after-end", ended] : [])).then(() => null, (error) => error.message);
      if (failed) keyMissed = `the stop key couldn't be pressed: ${failed}`;
      else if (!ended && (await within(END_WAIT_MS, overlay.stopping())) === null) keyMissed = "the overlay didn't say that it was stopping after the key";
      stoppedAt = tokenWentAt() ?? stoppedAt;
    };
    let keyMissed = "";
    const press = test.by === "key" ? pressKey : pressStop;
    let lost = null;
    const lose = () => {
      lost = Promise.resolve().then(() => (test.loss ?? tokenRemoved)({ run, press })).then(() => { stoppedAt ??= Date.now(); });
      // Thrown once the helper has ended, not as an unhandled rejection in the timer below.
      lost.catch(() => {});
      return lost;
    };
    const target = await showTarget(binaries.target, test.target);
    const [x, y] = [target.x + target.w / 2, target.y + target.h / 2];
    // A run stopped before its helper starts is stopped once the target shows, not before.
    // The target waits for a notification's cover to go, which can take longer than the
    // overlay stays up after Stop (ADR-0015), and that wait is no part of what a case times.
    if (test.stopped) await lose();
    // Stop pressed a second time: when the press returned, or why it couldn't be made.
    let [againAt, unpressedAgain] = [null, ""];
    const again = test.againAfterMs
      && sleep(test.againAfterMs).then(() => (test.by === "key" ? pressStopKey(binaries) : tools.run(binaries.press, [overlay.pid])))
        .then(() => { againAt = Date.now(); }, (error) => { unpressedAgain = error.message; });
    // The helper the target froze. The run is stopped then, and the helper goes on once the
    // token is gone, or STOP_WAIT_MS later, so whatever fails, it isn't left frozen.
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
    const stopping = test.stopping ? await stoppingFailures(test.stopping, overlay, binaries.state, binaries.stopKey) : [];
    // A run stopped by its token's removal goes on until it ends by itself, and the overlay
    // stays up until it has, so the check ends the run, unless the case is of a run that goes
    // on, which the overlay must leave (`leavesMs`). In Stop's last resort the run ends at
    // the signal, or the overlay ends it.
    if (test.stopping === "pill" && !test.leavesMs) await run.end();
    const said = test.says ? await overlay.said() : null;
    // Whether the run was still going once the overlay had gone.
    const outlived = run.endedAt() === null;
    await again;
    // The overlay's notification covers the screen a moment after it is posted. The next
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
    // How far apart a held drag's two drag events reached the target, and how soon after the
    // first the button-up did (ADR-0021).
    const drags = seen.filter((event) => event.type === "drag");
    const paused = drags.length === 2 ? drags[1].at - drags[0].at : undefined;
    const upAfterDrag = seen.findLast((event) => event.type === "up")?.at - drags[0]?.at;
    // How far apart a drag after a click's first button-up and second press reached the
    // target (ADR-0022).
    const downs = seen.filter((event) => event.type === "down");
    const gap = downs.length === 2 ? downs[1].at - seen.find((event) => event.type === "up")?.at : undefined;
    const killed = run.endedAt() - stoppedAt;
    // How long after Stop the overlay went. When it went is read as a whole millisecond, up
    // to one before the moment itself, and the token went at a fraction of one, so the lower
    // bound gets that millisecond.
    const left = said?.at - stoppedAt;
    return [
      keyMissed,
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
      test.upAfterDragMs !== undefined && !(upAfterDrag <= test.upAfterDragMs)
        && `the button-up reached the target ${upAfterDrag?.toFixed(1)} ms after the first drag event, over ${test.upAfterDragMs}`,
      test.gapMs && !(gap >= test.gapMs[0] && gap <= test.gapMs[1])
        && `the click's release and the drag's press reached the target ${gap?.toFixed(1)} ms apart, not ${test.gapMs.join(" to ")}`,
      test.pausedMs && !(paused >= test.pausedMs[0] && paused <= test.pausedMs[1])
        && `the two drag events reached the target ${paused?.toFixed(1)} ms apart, not ${test.pausedMs.join(" to ")}`,
      held && `the button was left held, and ${held.released ? "has been released" : "could not be released"}`,
      ...stopping,
      unpressedAgain && `Stop couldn't be pressed again: ${unpressedAgain}`,
      againAt !== null && !(againAt < run.endedAt()) && "the second press on Stop returned only once the run had ended, which doesn't show that it did nothing",
      test.says && said === null && `the overlay was still up ${OVERLAY_WAIT_MS} ms after Stop${unpressed}`,
      test.says && said !== null && !test.says.test(said.text) && `the overlay said ${JSON.stringify(said.text)}, not ${test.says}${unpressed}`,
      test.afterRun && said?.at < run.endedAt() - EXIT_NEWS_MS && `the overlay said ${JSON.stringify(said.text)} before the run had ended`,
      test.leavesMs && said !== null && !(left + 1 >= test.leavesMs[0] && left <= test.leavesMs[1]) && `the overlay went ${left.toFixed(1)} ms after Stop, not ${test.leavesMs.join(" to ")}`,
      test.leavesMs && !outlived && "the run had ended when the overlay went",
      test.killedMs && !(killed >= test.killedMs[0] && killed <= test.killedMs[1]) && `the run ended ${killed} ms after Stop, not ${test.killedMs.join(" to ")}`,
      ran !== (test.run ?? 0) && `the run ended with ${ran}, not ${test.run ?? 0}`,
    ].filter(Boolean);
  } finally {
    // The overlay before the run, since one that saw its run end would notify.
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
    state: "checks/overlay-state", key: "checks/press-key", keyTarget: "checks/key-target",
  };
  for (const [name, source] of Object.entries(sources)) {
    binaries[name] = await tools.helperBinary(path.join(HARNESS, `${source}.swift`));
  }
  // The key the overlay claims, from the one place that holds it.
  binaries.stopKey = JSON.parse(await tools.run(binaries.overlay, ["--stop-key"]));
  // The helper refuses while the display sleeps, since the session reports the screen locked.
  const display = await mac.keepDisplayOn();
  const report = (name, failed) => {
    console.log(failed.length ? `FAIL: ${name}: ${failed.join("; ")}` : `PASS: ${name}`);
    if (failed.length) process.exitCode = 1;
  };
  try {
    for (const pid of NO_RUNS) {
      report(`the overlay refuses the process id ${pid} for its run: it says nothing, and exits 1 with its usage`, await unrefused(binaries.overlay, pid));
    }
    // Every case that presses the stop key or a Shift-click must leave no modifier held.
    const withKey = async (name, failed) => report(`${name}; no modifier key is left held`, [...(await failed), ...(await leftHeld(binaries))]);
    for (const test of CASES) {
      if (test.modifiers) await withKey(test.name, failures(test, binaries));
      else report(test.name, await failures(test, binaries));
    }
    for (const test of KEY_CASES) await withKey(test.name, failures(test, binaries));
    for (const test of UNREAPED) report(test.name, await unreapedFailures(test, binaries));
    await withKey("the stop key pressed before the overlay says that its windows are on screen is taken as an early Stop: it says stopping, "
      + "then shown once the pill is listed, with the border left out and the pill reading Stopping", earlyKeyFailures(binaries));
    await withKey("the stop key with another app in front: the pill shows the key, the key stops the run, the app doesn't get it while the "
      + "overlay is up, and gets it once the overlay has gone", keyTargetFailures(binaries));
    await withKey("the stop key with another app in front once the overlay has been killed (SIGKILL): the app gets it", keyTargetFailures(binaries, { killed: true }));
    const modifiers = binaries.stopKey.modifiers;
    for (const [name, held, command] of [
      ["a click the helper posts while a person holds the stop key's modifiers", modifiers, click],
      ["a drag the helper posts while a person holds the stop key's modifiers", modifiers, drag],
      ["a click the helper posts while a person holds Shift", ["shift"], click],
    ]) {
      await withKey(`${name} carries them on its button events, and the keyboard still reads them held`, heldModifiersFailures(binaries, held, command));
    }
    report("a click the helper posts with no modifier key held carries none on its button events, and the keyboard reads none held", await heldModifiersFailures(binaries, [], click));
    await withKey("two overlays: the second's claim on the stop key is refused, its pill shows no key and its Stop still works, and one press of "
      + "the key stops only the first run", twoOverlaysFailures(binaries));
    report("no modifier key is held at the end of the check", await leftHeld(binaries));
  } finally {
    display.stop();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
