# Ableton Live Test Harness

**This is a test harness for Ableton Live**, built so a coding agent can run
in-Live acceptance tests for projects that run in Live: Max for Live devices, Audio Unit effects,
Live Extensions, Remote Scripts. Why and how:
[ADR-0001](docs/adr/0001-fork-abletonosc.md). The Node client and the checks are in
[harness/](harness/README.md); the `verify-ableton` skill
([skills/verify-ableton](skills/verify-ableton/SKILL.md), linked into your agent's skills folder)
tells an agent how to use it. macOS only.

Built on [AbletonOSC](https://github.com/ideoforms/AbletonOSC): see [Origin](#origin).

**To find your way around,** see [AGENTS.md](AGENTS.md): the layout and which doc covers what.

**To change this repo,** see [CONTRIBUTING.md](CONTRIBUTING.md).

AbletonOSC is a MIDI remote script that provides an [Open Sound Control (OSC)](https://ccrma.stanford.edu/groups/osc/) interface to
control [Ableton Live](https://www.ableton.com/en/live/). AbletonOSC's aim is to expose the
entire [Live Object Model](https://docs.cycling74.com/max8/vignettes/live_object_model) API
([full API docs](https://structure-void.com/PythonLiveAPI_documentation/Live11.0.xml)), providing comprehensive control
over Live's control interfaces using the same naming structure and object hierarchy as LOM.

# Installation

This repo needs macOS, Ableton Live 12 (it is used with Live 12.4, Suite and Beta), Node 18 or
later (no packages to install) and, for the plug-in and device-ui helpers, `swiftc` from Xcode
or its Command Line Tools. Checks of Max for Live devices, including the example below, need
Max for Live. Live's language must be English: the harness finds its menus and dialogs by name.

- Clone it anywhere; the commands here assume `~/dev/ableton-live-test-harness`. Only
  `harness/remote.sh` (runs on a second Mac) needs it there. A project's checks load the
  harness by path: by convention they read `LIVE_HARNESS` (the path of the `harness/`
  folder) and fall back to this path.
- Link the clone into Live's Remote Scripts as `AbletonOSC`, so Live runs the working tree.
  It takes the place of an installed AbletonOSC, so first move any existing `AbletonOSC`
  folder out of Remote Scripts. It isn't a drop-in replacement: it listens on 127.0.0.1 only,
  so clients on other machines stop working, and `/live/clip/get/notes` replies in chunks.
  `ln -s ~/dev/ableton-live-test-harness ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonOSC`
- Restart Live. In Settings > Link, Tempo & MIDI, set a Control Surface slot to AbletonOSC
  (Input and Output None). Live should display a message saying "AbletonOSC: Listening for
  OSC on port 11000".
- Keep Count-In at None, Live's default (the metronome's drop-down menu in the Control Bar).
  The LOM can't change it, and a recording with Count-In on starts late.
- Add each project's `builds/` folder to Live's Places, and `harness/devices/` for the example
  Max for Live check below. An agent does this with Live quit: in `Library.cfg` in Live's
  preferences folder (`~/Library/Preferences/Ableton/Live <version>/`, for the version you
  run), add
  `<UserFolderInfo Id="<higher than any Id in the file>" Path="<absolute path>" DisplayName="<folder name>" IconName="" />`
  to `<UserFolderInfoList>`. By hand: Add Folder under Places in Live's browser.
- For an agent, link `skills/verify-ableton` into its skills folder. For Claude Code:
  `ln -s ~/dev/ableton-live-test-harness/skills/verify-ableton ~/.claude/skills/verify-ableton`
- To run checks on a second Mac, or to press a device's controls with the mouse, copy
  `harness/local.example.json` to `harness/local.json` and set its values: "Running on a
  second Mac" in [harness/README.md](harness/README.md).
- `harness/relaunch.js` and `harness/quit.js` quit the running Live and discard its unsaved
  changes and recordings: don't run them on a set you care about. Which Live `relaunch.js`
  starts, and its options: [harness/README.md](harness/README.md).
- The harness needs Accessibility and Automation permission for the terminal app, and Screen
  Recording to press device controls: "What Live needs" in [harness/README.md](harness/README.md).

Activity logs will be output to a `logs` subdirectory. Logging granularity can be controlled with `/live/api/set/log_level` (see [Application API](docs/osc-api.md#application-api)). 

# Quick start

With Live open on a new empty set and AbletonOSC selected, from the repo root:

1. `node harness/doctor.js` says whether Live is ready to be driven.
2. `node harness/checks/record-roundtrip.js` is a first real run: it adds two tracks to the
   open set, records one into the other, compares the notes and deletes the tracks. It leaves the loop off,
   Record Quantization at None and the start marker moved.
3. In your project, ask your agent to prove a change in Live. It follows the `verify-ableton`
   skill: it asks whether Live is free, runs the project's checks in `tests/live/` and
   reports PASS or FAIL per case. If the project has no checks yet, it proposes them first.

`harness/relaunch.js` starts Live on a test set with Main at -inf dB, on purpose: runs are
silent, and recordings are taken before Main.

Two checks to copy, both runnable as they stand:
[harness/checks/example-transpose-check.js](harness/checks/example-transpose-check.js) for a
Max for Live device, on an example device in this repo, and
[harness/checks/example-device-check.js](harness/checks/example-device-check.js) for anything
else, on Live's stock Pitch device.

# Usage

AbletonOSC listens for OSC messages on port **11000**, and sends replies on port **11001**. Replies will be sent to the
same IP as the originating message. When querying properties, OSC wildcard patterns can be used; for example, `/live/clip/get/* 0 0` will query all the properties of track 0, clip 0.

The addresses are listed in [docs/osc-api.md](docs/osc-api.md).

# Origin

This repo is built on [ideoforms/AbletonOSC](https://github.com/ideoforms/AbletonOSC)
(MIT, see [LICENSE.md](LICENSE.md)), adopted as its base at commit
[`0ca68214bd62c9b5cb641ca34006cfd70ba94430`](https://github.com/ideoforms/AbletonOSC/commit/0ca68214bd62c9b5cb641ca34006cfd70ba94430)
(2025-11-19, its `master` then), tagged `upstream-base` here, and has since
changed and built on it; `git diff upstream-base` shows that work. The adopted code is
changed wherever the harness needs; nothing is tracked or sent back. AbletonOSC's original
text is kept in this README, with its install steps replaced by this repo's, and in
[docs/osc-api.md](docs/osc-api.md), which holds its API reference. `pythonosc/` is
[python-osc](https://github.com/attwad/python-osc) (Unlicense). This repo is not affiliated
with Ableton or Cycling '74.

# Acknowledgements

Thanks to [Stu Fisher](https://github.com/stufisher/) (and other authors) for [LiveOSC](https://livecontrol.q3f.org/ableton-liveapi/liveosc/), the spiritual predecessor to this
library. Thanks to [Julien Bayle](https://structure-void.com/ableton-live-midi-remote-scripts/#liveAPI)
and [NSUSpray](https://nsuspray.github.io/Live_API_Doc/) for providing XML API docs, based on original work
by [Hanz Petrov](http://remotescripts.blogspot.com/p/support-files.html).

For code contributions and feedback, many thanks to:
- Jörn Lengwenings ([Coupe70](https://github.com/Coupe70))
- Bill Moser ([billmoser](https://github.com/billmoser))
- [stevmills](https://github.com/stevmills)
- Marco Buongiorno Nardelli ([marcobn](https://github.com/marcobn)) and Colin Stokes
- Mark Marijnissen ([markmarijnissen](https://github.com/markmarijnissen))
- [capturcus](https://github.com/capturcus)
- Esa Ruoho a.k.a. Lackluster ([esaruoho](https://github.com/esaruoho))

