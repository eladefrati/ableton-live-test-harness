# Contributing

## The harness

After a change to `abletonosc/*.py`, run `node harness/cli.js reload`. A change to
`osc_server.py` also needs the Control Surface set to None and back to AbletonOSC, and a
change to `manager.py` needs Live restarted (`node harness/relaunch.js`). A new handler
module needs an import in `abletonosc/__init__.py`, an entry in `HANDLERS` and a reload.

Before a commit that changes anything other than Markdown files, run
`node --test harness/tests/*.test.js` (Live not needed, but a logged-in session is) and, with Live open,
`node harness/checks/record-roundtrip.js`. A commit that changes how Live behaves
under the harness, or what the harness refuses, adds it to `harness/live-notes.md` in the same commit: the next reader reads that file, not
code comments or commit messages.

The repo names no project that uses it: tests and docs use plain stand-ins.

## Tests

For unit tests to pass:

- Live must be configured with default audio input and output devices, and
- Live must be started with a blank default set, and
- `Count-In` must be `None`, as in [Installation](README.md#installation)

To run unit tests, `pip3 install pytest`, start Live, change to the repo root, and run:

```
pytest
```

## Logging

Logging can be performed from any of the AbletonOSCHandler classes via the `self.logger` property.

AbletonOSC logs internal events to `logs/abletonosc.log` relative to the AbletonOSC directory. At 10 MB the
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
