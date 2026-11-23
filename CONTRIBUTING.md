# Contributing

## The harness

After a change to `abletonosc/*.py`, run `node harness/cli.js reload`. A change to
`osc_server.py` also needs the Control Surface set to None and back to AbletonOSC, and a
change to `manager.py` needs Live restarted (`node harness/relaunch.js`). A new handler
module needs an import in `abletonosc/__init__.py`, an entry in `HANDLERS`, and a reload.

Before a commit, run the checks for the files it changes:

- If it changes anything other than Markdown files, run `node --test harness/tests/*.test.js`
  (Live isn't needed, but a logged-in macOS session is). Then, with Live open, run
  `node harness/checks/record-roundtrip.js`.
- If it changes `harness/device-ui.swift`, `harness/computer-use-overlay.swift`,
  `harness/checks/pointer-guards.js`, `harness/checks/pointer-target.swift`, or a program that
  only `pointer-guards.js` runs (`harness/checks/press-key.swift`,
  `harness/checks/key-target.swift`, `harness/checks/press-stop.swift`,
  `harness/checks/overlay-state.swift`, or `harness/checks/run-orphaned.swift`), also run
  `node harness/checks/pointer-guards.js` on the click host (Live isn't needed). The unit tests
  fake `harness/device-ui.swift` (the helper), except where it refuses a drag's distance or hold and where it
  crops a picture. Only this check sees what the helper posts, what else it refuses, and what
  Stop on the overlay's pill and its stop key do.
- If it changes `harness/device-ui.swift`, `harness/computer-use-overlay.swift`,
  `harness/checks/editor-guards.js`, `harness/checks/event-tap.swift`, or
  `harness/checks/pointer-target.swift`, also run `node harness/checks/editor-guards.js` on the
  click host, with Live open. `pointer-guards.js` can't run the helper's `click-editor` and
  `drag-editor`, which take only a plug-in window of Live's. Only this check sees what those two
  refuse.
- If it changes `harness/video.swift`, `harness/video.js`, `harness/captures.js`,
  `harness/checks/video-record.js`, `harness/checks/pointer-target.swift`,
  `harness/device-ui.js`, or `harness/macos.js`, also run `node harness/checks/video-record.js`
  with Live open. `harness/device-ui.js` and `harness/macos.js` find the window a recording
  takes and wake the display for it. The unit tests run `video.js` on a stand-in for its helper,
  and the helper only where it refuses its arguments or a video it can't read. Only this check
  records.
- If it changes `harness/remote.sh`, open the remote's Live and run
  `harness/remote.sh ableton-live-test-harness node harness/cli.js capture`. Check that
  `remote.sh` brings the capture back and names it. The unit tests run `harness/remote.sh`
  against two local folders (`harness/tests/remote.test.js`, with stand-ins for `ssh` and
  `rsync`). Only this run uses ssh and the remote's shell.
- If it changes `harness/midi.swift`, `harness/midi.js`, or `harness/checks/midi-map.js`, also
  run `node harness/checks/midi-map.js` on the click host, with Live open and Remote on for the
  Harness input. The unit tests run `midi.js` on a stand-in for its helper, so only this check
  sends MIDI into Live.

A commit that changes how Live behaves under the harness, or what the harness refuses, records
that behaviour in `harness/live-notes.md` in the same commit. The next reader reads that file,
not code comments or commit messages.

A finding in `live-notes.md`, an ADR, or a comment states the behaviour and what the harness
does about it. It also states the conditions the behaviour was measured under: Live and macOS
versions, Intel or Apple silicon, and display scale where it matters. It has no dates and no
run-by-run history. Git and the ADRs keep those. Make a default in code suit any user. Put a
value that suits one setup in `harness/local.json`.

The repo names no project that uses it. Tests and docs use plain stand-ins.

Document a change to what the harness offers or needs in the same branch, in the document that
covers it, and add a pointer from `harness/README.md` where one is needed.

## AbletonOSC's tests

`tests/` is AbletonOSC's own pytest suite, kept from upstream. It isn't run before commits
here, and the addresses this repo added have no tests in it. The harness's unit tests and
checks above cover what the harness uses. The suite drives a running Live and changes the open set.
It passes only under these conditions:

- Live uses the default audio input and output devices.
- Live started with a blank default set.
- **Count-In** is **None**, as in [Installation](README.md#installation).

To run it:

1. Run `pip3 install pytest`.
2. Start Live.
3. From the repo root, run `pytest`.

## Logging

Any `AbletonOSCHandler` subclass can log through `self.logger`.

AbletonOSC logs internal events to `logs/abletonosc.log` in the clone. At 10 MB the
file becomes `abletonosc.log.1` and a new one starts. One old file is kept.

## Find the Remote Script's load-time errors

AbletonOSC's load-time errors are in Live's log, `Log.txt` in Live's preferences folder for
the running version, which Live appends to at each launch. (The logs under `Live
Reports/Usage` are usage analytics. They show no Python output.) To follow it:

```
LOG_FILE=$(ls -t "$HOME"/Library/Preferences/Ableton/Live\ */Log.txt | head -1)
echo "Log path: $LOG_FILE"
tail -5000f "$LOG_FILE" | grep -i abletonosc
```
