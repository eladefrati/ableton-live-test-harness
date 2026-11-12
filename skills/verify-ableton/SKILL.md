---
name: verify-ableton
description: Verify a project that runs in Ableton Live, in the running Live, through the AbletonOSC test harness. Use when a change to such a project needs proof in Live, instead of asking the user to test by hand, and before calling a Live change fixed.
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

To start Live, or relaunch it (to make it rescan plug-ins, say), on either machine, run
`node ~/dev/ableton-live-test-harness/harness/relaunch.js` (on the remote through `remote.sh`),
never an `open`, quit or kill of your own. It discards unsaved changes and recordings. Use
`--suite` only for a task that needs Suite, and `--plugin <name>` after every build for a
plug-in's checks. Where the Beta isn't installed, pass `--app <path>`. Its options and what it answers are in `harness/README.md`. If it stops at
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
app and its version, the tracks and the open set's file. On "UDP 11001 is in use", another client is
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
presses a device's controls with real mouse events and reads the text its panel shows, on the
unmodified build. Use it for a control that isn't a parameter, or when the click itself needs
proving; everything else stays on OSC. Take the evidence from Live, not from the press
returning. `harness/README.md` has the API and what it needs.

## Live's window

Click inside Live only through `harness/device-ui.js`, which clicks only after Live's Info
View names the control. On the click host (`clickHost` in `harness/local.json`) it clicks at
once; on any other machine the run's first press shows the user a dialog and waits up to 2
minutes for Allow (ADR-0006), so tell the user before such a run. Bring
Live to the front only when a step needs it: keystrokes through System Events go to the frontmost app. To see Live, capture
its window in the background, which works with Live behind other windows:
`node ~/dev/ableton-live-test-harness/harness/cli.js capture <png>`. That shows Live's
main window only. A dialog or panel is a window of its own: `cli.js windows` lists Live's
windows with their ids, and `cli.js capture <png> --window <id>` captures one. Before acting on a Live window, list Live's windows (System
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
command in `~/dev/<repo>` there; its exit status is the command's. The project's builds folder
must be in the remote's Places (see "Running on a second Mac" in `harness/README.md`).
