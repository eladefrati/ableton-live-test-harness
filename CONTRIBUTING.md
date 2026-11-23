# Contributing

## The harness

After a change to `abletonosc/*.py`, run `node harness/cli.js reload`. A change to
`osc_server.py` also needs the Control Surface set to None and back to AbletonOSC, and a
change to `manager.py` needs Live restarted (`node harness/relaunch.js`). A new handler
module needs an import in `abletonosc/__init__.py`, an entry in `HANDLERS` and a reload.

Before a commit that changes anything other than Markdown files, run
`node --test harness/tests/*.test.js` (Live not needed, but a logged-in session is) and, with Live open,
`node harness/checks/record-roundtrip.js`. Before a commit that changes
`harness/device-ui.swift`, `harness/computer-use-overlay.swift`, `harness/checks/pointer-guards.js`,
`harness/checks/pointer-target.swift` or
the programs only it runs (`harness/checks/press-key.swift`, `harness/checks/key-target.swift`,
`harness/checks/press-stop.swift`, `harness/checks/overlay-state.swift`, `harness/checks/run-orphaned.swift`),
also run `node harness/checks/pointer-guards.js` on the click host (Live not needed). The unit tests
run the callers of `harness/device-ui.swift` on fakes, and the helper only where it refuses a drag's
distance or hold and where it crops a picture, so only this check sees what the helper posts, what
else it refuses, and what Stop on the overlay's pill and its stop key do. Before a commit that changes
`harness/device-ui.swift`, `harness/computer-use-overlay.swift`, `harness/checks/editor-guards.js`,
`harness/checks/event-tap.swift` or `harness/checks/pointer-target.swift`, also run `node harness/checks/editor-guards.js` on the
click host, with Live open. `pointer-guards.js` can't run the helper's `click-editor` and
`drag-editor`, which take only a plug-in window of Live's, so only this check sees what
those two refuse. Before a commit that changes `harness/video.swift`, `harness/video.js`,
`harness/captures.js`, `harness/checks/video-record.js` or `harness/checks/pointer-target.swift`, or `harness/device-ui.js` or
`harness/macos.js`, which find the window a recording takes and wake the display for it, also
run `node harness/checks/video-record.js` with Live open. The unit tests run `video.js` on a
stand-in for its helper, and the helper only where it refuses its arguments or a video it
can't read, so only this check records. The unit tests run `harness/remote.sh`
against two local folders (`harness/tests/remote.test.js`, with stand-ins for `ssh` and
`rsync`). Before a commit that changes it, also run it once against the remote with a command that
leaves a capture there, `harness/remote.sh ableton-live-test-harness node harness/cli.js
capture` with the remote's Live open, and check that it brings the capture back and names
it. Only that run uses ssh and the remote's shell.
Before a commit that changes `harness/midi.swift`, `harness/midi.js` or
`harness/checks/midi-map.js`, also run `node harness/checks/midi-map.js` on the click host,
with Live open and Remote on for the Harness input. The unit tests run `midi.js` on a
stand-in for its helper, so only this check sends MIDI into Live.
A commit that changes how Live behaves
under the harness, or what the harness refuses, adds it to `harness/live-notes.md` in the same commit. The next reader reads that file, not
code comments or commit messages.
A finding (in `live-notes.md`, an ADR or a comment) states the behaviour, the conditions it
was measured under (Live and macOS versions, Intel or Apple silicon, display scale where it
matters) and what the harness does about it, with no dates and no run-by-run history. Git
and the ADRs keep that. A default in code suits any user; a value that suits one setup goes
in `harness/local.json`.

The repo names no project that uses it. Tests and docs use plain stand-ins.

A change to what the harness offers or needs is documented in the same branch, in the
document that covers it, with a pointer from `harness/README.md` where one is needed.

## AbletonOSC's tests

`tests/` is AbletonOSC's own pytest suite, kept from upstream. It isn't run before commits
here, and the addresses this repo added have no tests in it. The harness's unit tests and
checks above cover what the harness uses. The suite drives a running Live and changes the open set.
For it to pass:

- Live must be configured with default audio input and output devices, and
- Live must be started with a blank default set, and
- `Count-In` must be `None`, as in [Installation](README.md#installation)

To run it, `pip3 install pytest`, start Live, change to the repo root, and run:

```
pytest
```

## Logging

Logging can be performed from any of the AbletonOSCHandler classes via the `self.logger` property.

AbletonOSC logs internal events to `logs/abletonosc.log` in the clone. At 10 MB the
file becomes `abletonosc.log.1` and a new one starts; one old file is kept.

## Debugging compile-time issues

AbletonOSC's load-time errors are in Live's log, `Log.txt` in Live's preferences folder for
the running version, which Live appends to at each launch. (The logs under `Live
Reports/Usage` are usage analytics; they show no Python output.) To follow it:

```
LOG_FILE=$(ls -t "$HOME"/Library/Preferences/Ableton/Live\ */Log.txt | head -1)
echo "Log path: $LOG_FILE"
tail -5000f "$LOG_FILE" | grep -i abletonosc
```
