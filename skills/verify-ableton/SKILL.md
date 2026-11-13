---
name: verify-ableton
description: Drive Ableton Live through the AbletonOSC test harness (~/dev/ableton-live-test-harness), for any project that runs in Live (Max for Live device, plug-in, MIDI Tool, Remote Script). Load it before anything in Live - starting or relaunching it, loading a build, adding a builds folder to Places, running a project's checks, pressing a device's controls or clicking in Live (harness-computer-use), capturing Live or a device's panel (screenshots for a manual too), working on the remote Mac - and to prove a change in Live instead of asking the user to test by hand, before calling a Live change fixed.
---

# Verify an Ableton project in Live

The harness drives the user's running Live over OSC (a fork of AbletonOSC, installed as a
Remote Script) and through Live's menus (AppleScript). It loads a project's build onto new
tracks, plays and records, and compares what Live played with what was expected. Read
`~/dev/ableton-live-test-harness/harness/README.md` for the API and `harness/live-notes.md` there for Live's quirks.

The paths here are for a clone at `~/dev/ableton-live-test-harness`, where `remote.sh`
expects it. With the harness in another folder, use that folder in the commands below. A
project's checks load the harness by path; by convention they read `LIVE_HARNESS` (the path
of the `harness/` folder) and fall back to that clone.

## Live is shared: coordinate first

Other agent sessions may be driving Live. Only one client can bind UDP 11001.

- The session holding Live has full control, on this Mac and on the remote: launch, quit, save,
  anything.
- Save and reopen the set when a check needs it, but Save As into a temp folder first (as
  `harness/checks/save-reopen.js` does): never overwrite the file the set was opened from.
- Agree a slot with another session only when the user says one is working in Live too: wait
  if it has Live, and say when it's free.
- Before any run in Live, on either machine, ask the user whether Live is free.
- Treat the open set as a test set only if the harness started it or the user says it's
  disposable: then change anything in it, including tempo, transport and tracks other checks
  didn't create. Otherwise ask first.

## Start and quit Live

Start each piece of work in Live with a relaunch, on the harness's empty set, unless
`doctor.js` says the open set was opened by the harness or the user calls it disposable: a
check changes the set it runs in. Ask whether Live is free first.

To start Live, or relaunch it, on either machine, run
`node ~/dev/ableton-live-test-harness/harness/relaunch.js` (on the remote through `remote.sh`),
never an `open`, quit or kill of your own. It discards unsaved changes and recordings. Use
`--suite` only for a task that needs Suite, and `--plugin <name>` after every build for a
plug-in's checks: Live keeps playing the plug-in build it loaded until it relaunches. Its last line names the component it loaded and when that
was built: check it is your build. Where the Beta isn't installed, pass `--app <path>`. Its options and what it answers are in `harness/README.md`. If it stops at
a dialog it doesn't know, it prints the message: ask the user. If the permission system
denies it, don't start Live another way: tell the user, who can start Live or allow the command.

When the user asks to quit Live, run `node ~/dev/ableton-live-test-harness/harness/quit.js`
(on the remote through `remote.sh`). It discards unsaved changes and recordings too. It
refuses with "UDP 11001 is in use" while another client runs, also when Live isn't running:
find out who before going on.

## Doctor

Run this first, and again whenever anything looks off. It's read-only:

```sh
node ~/dev/ableton-live-test-harness/harness/doctor.js
```

It checks that Live is running (only one at a time), AbletonOSC answers, no
Live dialog is open, and no track is armed, and reports the bit depth Live records at
(`info records at 24-bit` or `32-bit float`) and the sample rate it runs at. It warns when
the Remote Script's files changed since Live started (run `harness/cli.js reload`; a changed
`manager.py` needs a relaunch) and when Automation Arm is on. It also names the running Live
app and its version, the tracks and the open set's file, with a warning when the harness
didn't open that set. On "UDP 11001 is in use", another client is
running: find out who before going on. On "AbletonOSC does not answer", ask the user to
select it as a Control Surface. On "System Events can't name its app", the terminal app
lacks Accessibility or Automation permission ("What Live needs" in `harness/README.md`): ask
the user to allow it.

## Drive

A project's in-Live checks live in its repo, in `tests/live/`, with a `README.md` listing
what they cover and what still needs the user's eyes. Run a check from anywhere:

```sh
node ~/dev/<project>/tests/live/<check>.js          # PASS/FAIL per case, exit 1 on failure
node ~/dev/<project>/tests/live/<check>.js --keep   # leave its tracks, to inspect in Live
node ~/dev/<project>/tests/live/<check>.js --tempo 97   # set the song's tempo first (left so)
```

Checks on `harness/device-checks.js` take both flags without any code of their own.

For anything else in Live, look before writing code of your own: `harness/README.md` has
the client (opening a saved set, listening for changes, raw OSC), and `docs/osc-api.md`
every address AbletonOSC answers (selecting a track, say).

If the project has no `tests/live/` yet, or the change needs a case it doesn't have,
propose the case first; once agreed, write it following
[writing-checks.md](writing-checks.md).

A check that needs a record bit depth or a sample rate refuses when Live is set otherwise.
Ask the user to set it (Settings > Record/Warp/Launch > Bit Depth, Settings > Audio > In/Out
Sample Rate) and leave the change to them. Each machine has its own setting.

What OSC can't reach, so needs the user, a device test hook or real clicks: Stored Only and
Visible-not-stored parameters, a device's UI text (status lines), anything shown only
visually, Push, export dialogs, and undo step names of changes made in the UI (a change
made over OSC is named "Custom Action"). The test hook (`docs/adr/0002-test-hook.md`)
lets a development build report its status line and check results: `live.openHooks()`,
then take `const since = Date.now()` before the action and `await live.waitForHook(topic,
{ track, device, since })`. A project has it only once its own ADR adopts it.

`harness/device-ui.js`
(`docs/adr/0004-press-device-controls-with-real-mouse-events.md`)
presses a device's controls with real mouse events, picks an item from a chooser's menu
(ADR-0011), drags them to turn them (ADR-0010,
mainly for a plug-in's editor: Live's own devices are set over OSC), reads the text its panel
shows and captures the panel, on the unmodified build. A Max device's controls come from its build; any
other device's or plug-in's are points measured in Live (ADR-0007; Auto Filter's knobs are
built in). Use it for a control that isn't a parameter, when the click itself needs
proving, or for a picture of a device's panel (`ui.capture`, for a manual too); everything
else stays on OSC. Don't write a capture or click script of your own: `device-ui.js`
exports what one needs. Take the evidence from Live, not from the press
returning. `harness/README.md` has the API and what it needs.

## Places

Live loads a project's builds from its Places. Add a builds folder with
`node ~/dev/ableton-live-test-harness/harness/add-place.js <folder>`, with Live quit (on
the remote through `remote.sh`, below), never by editing `Library.cfg` by hand: two entries with one
`Id` make Live reject the whole file. A check that can't find its build says what to
fix.

## Live's window

Click inside Live only through `harness/device-ui.js`, which clicks only after Live's Info
View names the control, or, in a plug-in's own window, only inside the editor at the size
its points were measured at (ADR-0008). On the click host (`clickHost` in `harness/local.json`) it clicks at
once; on any other machine the run's first press shows the user a dialog and waits up to 2
minutes for Allow (ADR-0006), so tell the user before such a run. From Allow until the run
ends, a purple border around their screen shows the run may take the pointer, and Stop on
its pill takes the mouse back, failing the run at its next press (ADR-0009).
These clicks, the asking and the border are harness-computer-use: a request by that name
means this section. Bring
Live to the front only when a step needs it: keystrokes through System Events go to the frontmost app. To see Live, capture
its window in the background, which works with Live behind other windows:
`node ~/dev/ableton-live-test-harness/harness/cli.js capture <png>`. That shows Live's
main window only. A dialog or panel is a window of its own: `cli.js windows` lists Live's
windows with their ids, and `cli.js capture <png> --window <id>` captures one. A plug-in's
own window (its editor) shows only while Live is in front: open and capture it with
`cli.js plugin-window <track> <device> <png>`, and press its controls with
`openPluginWindow` (`harness/README.md`), never by clicking the device's title bar or with
`screencapture` of your own. Before acting on a Live window, list Live's windows (System
Events) so a panel on top isn't missed. A dialog the Live API can't answer: capture it and
ask the user, naming it.

## Evidence

A check's output is the evidence: one PASS/FAIL line per case with matched, missing and
extra notes and the worst timing error in ms, and the missing/extra notes on a failure.
Report the result in one line and show failures in full; the rest is in the run's log (see
"Run logs"). A check that never failed proves little: when you add a
case, show it failing once on a wrong expectation. A Live fix is proven when the check that
reproduced the bug passes twice, the second time with a different input, tempo or transport
state; no more runs unless one fails. Where timing matters (steps, swing, note lengths), a
pass at one tempo proves little: make the second run a different tempo with `--tempo`.
Timing errors under one sample are the recording's resolution (`compare.js` in
`harness/README.md`), not a difference between runs or builds. Report a failure as a finding; don't
loosen a tolerance or an expectation to make it pass without saying so.

## Run logs

Each run of a check in `tests/live/` saves a file in that repo's `tests/live/logs/`: what ran,
on which commit, everything it printed, and the exit code (none if the run was killed). Read
them to see what was tested before and how it went; `remote.sh` brings the remote's back by itself.
Commit them:

- A run during a task goes in that task's commit.
- The final check on a branch's last commit gets one log-only commit. The code doesn't change,
  so the check still counts.
- A run with no task: commit its log or delete it before you finish.

## Cleanup

Checks delete their own tracks in a `finally`, also on failure. After `--keep`, delete them
yourself (`live.deleteTracks([names], from)`, which deletes the recording track before its
source: a track whose MIDI source is deleted can no longer be disarmed). Leave no Live
dialog open (`doctor.js` shows one). Tell a session the user named that Live is free.

## Running on a second Mac

The remote (a second Mac, named as `remote` in `harness/local.json`) has its own Live. Run
any command there from this Mac:

```sh
~/dev/ableton-live-test-harness/harness/remote.sh <repo> <command...>
~/dev/ableton-live-test-harness/harness/remote.sh ableton-live-test-harness node harness/doctor.js
~/dev/ableton-live-test-harness/harness/remote.sh <repo> node tests/live/<check>.js
```

It copies the working copies of the harness and `~/dev/<repo>` to the remote first, replacing what's there, then runs the
command in `~/dev/<repo>` there; its exit status is the command's. A build made on the
remote (a plug-in's, say) goes outside `~/dev/<repo>`, which the next run replaces; delete
it when the work is done. The project's builds folder
must be in the remote's Places (see "Running on a second Mac" in `harness/README.md`).
