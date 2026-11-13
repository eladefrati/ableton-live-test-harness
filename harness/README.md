# Harness

A Node client for this AbletonOSC fork, for driving Live from tests. No dependencies;
Node 18 or later. See [ADR-0001](../docs/adr/0001-fork-abletonosc.md) for the design.

- `osc.js`: OSC encoding. Integers go out as int32, other numbers as float32; wrap a value
  in `float()` or `double()` to choose.
- `live.js`: the client. `connect()` binds UDP 11001, so only one client can run at a
  time. Requests are sent one at a time and wait for their reply; a message on
  `/live/error` fails the request in flight. Setters and methods send no reply: call
  `sync()` to wait until Live has handled them. Any address in
  [osc-api.md](../docs/osc-api.md) works through `query(address, ...args)` (resolves with
  the reply's arguments) and `send(address, ...args)`, or `get(object, property, ...indices)`
  and `set(...)` for `/live/<object>/get|set/<property>`: `live.set("view",
  "selected_track", 1)` selects track 1. `on(address, fn)` calls `fn(args)` for every message
  on that address, such as the replies a `/live/.../start_listen/...` sends; `off(address)`
  stops it. `deleteTracks(names, from)` deletes tracks;
  `dialog()` resolves with Live's open dialog, or null. `trackData(...properties)` reads
  properties of every track in one reply (null for one that doesn't apply to a track); `placeClip(track, notes, beats)` puts a clip of
  notes on a MIDI track in the Arrangement from beat 0.
- `compare.js`: `compareNotes` compares expected notes with recorded ones, with timing errors in ms. Live
  records at audio-sample resolution, so the errors have a floor of one sample: 0.021 ms at
  48 kHz, 0.023 ms at 44.1 kHz (Live runs at the audio device's rate). Where a beat is a
  whole number of samples (120 BPM at either rate) an error is 0 or 1 sample, depending on
  where Play started against the audio buffer; at other tempos it rounds to up to half a
  sample. Figures under one sample don't tell runs apart.
- `device-checks.js`: the runner for a project's checks of a MIDI device. `main(cases,
  {device, builds, build, longNames, notes, beats, compare, openHooks, onFail})` loads the
  newest `<device> YYYY.MM.DD.N.amxd` in `builds` (or the file `build` names, for another
  naming: a file name, or a function of the folder returning one) onto a new track, from whichever Places
  folder has it (it refuses, saying what to fix, unless exactly one does), places a clip in
  the Arrangement there, and for each case sets parameters, records the device's Post FX
  output on a second track and compares it with the case's `expect(ctx)`. Both tracks are
  deleted afterwards (`--keep` leaves them; `--tempo <bpm>` sets the song's tempo first and
  leaves it). Settings use long names when the project passes
  `longNames` (every visible parameter's long name; needed when short names repeat),
  otherwise Live's short names. `compare: {edgeBeats}` skips notes near
  the start and the stop, for a device whose first notes are late by design. Durations are
  compared only with `compare: {durationToleranceMs}`: set it for a device whose note
  lengths matter. The case shape,
  the options and `ctx` are described at the top of `run()`. A case's `during` actions run
  while Live records; each gets the song time just before and after it, a window about one
  AbletonOSC tick (100 ms) wide. A `{beat, set: {name: value}}` entry sends the change
  without waiting, so the window brackets only it (an action that syncs or sleeps widens
  it). With `grid`, a case fails when its change may have crossed a grid line, which
  leaves the step it hit unknown; the grid step must be well over one tick plus `reachMs`
  (about 250 ms), or every run fails. `buildScript(file)` reads the
  [v8] script out of a build, so expected notes can come from the very build loaded.
  `latestBuild(folder, device)` finds the newest build; `clipNotes()` is the default test
  clip.
- `plugin.js`: an Audio Unit plug-in's parameters, without typing into Live (ADR-0003).
  `buildPluginSet(name)` makes a set whose one track holds the installed effect named
  `name` with all its parameters DeviceParameters (see [live-notes.md](live-notes.md)), from the fixture
  `sets/au-plugin.als` (a stateless AUDelay, every slot free, Main silent like `empty.als`'s; `sets/make-au-plugin.js`
  remakes it in Live when the set format changes). It finds the component by
  name in the Info.plists under `~/Library/Audio/Plug-Ins/Components`,
  `/Library/Audio/Plug-Ins/Components` and `/System/Library/Components` (exactly one
  effect, or it refuses; `AUDelay` works with no plug-in of your own), reads its parameters
  from the AU itself, in its `ParameterList` order (`au-parameters.swift`, built with
  `swiftc` on first use and kept in the system temp folder's `ableton-harness-tools`),
  has `auval -v` validate it, and starts each parameter at its default, the plug-in with
  no saved state.
  `checkPluginLoaded(live, name, parameters)` checks that Live lists them all and runs the
  plug-in itself, not a stand-in: an enum's value string must be the plug-in's own.
  `exposePluginParameters(live, name)` returns the plug-in if the open set already holds it
  that way; otherwise it opens such a set in the running Live, behind other windows (the
  song becomes the fixture's, at 120 BPM). It resolves with `{track, device, parameters,
  file}`, and refuses to replace a set the harness didn't make (outside its temp folder),
  since opening discards unsaved changes; after a relaunch, `relaunch.js --plugin <name>`
  starts Live on the set instead.
  Instruments (`aumu`) and VST3 plug-ins refuse: the first are untested, and VST3 parameter
  IDs need a VST3 host to read.
- `audio.js`: measuring an audio effect's output. `signalTracks(live, {track, device,
  notes, beats, instrument, bitDepth})` adds a MIDI track (`harness-signal`, Operator unless
  `instrument` names another `[root, item]`) playing `notes` in the Arrangement, moves the
  effect onto an audio track of its own (`harness-plugin`) fed by it, and adds
  `harness-dry` and `harness-wet` to record the signal and the effect's Post FX output; its
  `restore()` moves the effect back to where it was and deletes the four tracks.
  `recordSignal(live, rig, {start, length, during})` records both (through
  `recordArrangement`, so `during` actions work) and resolves with `{dry, wet,
  sampleRate, files, windows}`, one `Float32Array` per channel; sample 0 is the recording's
  start, `start` in song beats, in both takes. `recordedSamples(live, track)` reads a
  track's last recorded clip. A check that needs float passes `bitDepth: 32`:
  `signalTracks` then refuses before adding tracks unless Live records at 32-bit float, and
  `recordSignal` refuses a take that isn't (see "Record bit depth" below).
- `wav.js`: `readWav(file)` reads a WAV file (PCM 8/16/24/32-bit, float 32/64-bit) into
  `{sampleRate, bits, float, channels}`, samples scaled to -1..1.
- `live.js` for plug-ins: `findDevice(name)` (`{track, device}`, refusing unless exactly
  one top-level device has the name), `setParameters(track, device, {name: value})` (a
  string picks a menu item by name), `moveDevice(track, device, target, position)`
  (keeps the instance and its state), `createAudioTrack(name)` and
  `arrangementAudioFiles(track)`.
- `macos.js`: what the LOM can't do, through Live's menus with AppleScript: save, save as,
  open a set (`openSetAndWait(live, file)`: behind other windows, stopping the transport first, answering "Save changes?" and "This action
  will stop audio?", and resolving once the set has loaded), Key Map and MIDI Map Mode, and the name of the step Edit > Undo would
  undo (`undoName`). `tempFolder(prefix)` makes a folder in `<system temp>/ableton-harness/`, where every
  set the harness saves goes; `relaunch.js` and `quit.js` empty it.
- `device-ui.js`: presses a device's controls with real mouse events (ADR-0004), and
  captures its panel; does the same in a plug-in's own window (ADR-0008). Its clicks, with
  the asking and the border below, are **harness-computer-use**.
  On the machine `local.json` names as `clickHost` it clicks at once; on any other, a run's
  first press shows a dialog, and the run clicks only after Allow; Don't Allow or no answer
  in 2 minutes throws `DeviceUiError` (ADR-0006). From Allow until the run's process ends, a
  purple border around the screen, labelled with the run, shows that the run may take the
  pointer; a notification says when it has ended (`computer-use-overlay.swift`, ADR-0009).
  `openDeviceUi(live, {track, device, build})` takes the controls from the
  `.amxd`; `ui.press(name)` or `ui.press(tabName, item)` clicks, and `ui.text([x, y, w, h])`
  resolves with the lines shown in that part of the panel, in device units. A press looks
  for the panel again, brings Live to the front, and throws `DeviceUiError` without clicking
  unless the screen is unlocked, Live's main window is on top at the point and the Info View
  names the control. It needs the Info View visible, Live at 100% zoom, the device in view
  with its title on screen once, an unfrozen `.amxd`, and an `annotation_name` on the
  control; a `live.tab` must be a single column. A press takes about 9 s on the remote Mac, nearly
  all of it reading text from captures. `press` resolves when the click is sent: read what
  it did from Live.
  Any other device or plug-in (its controls in Live's device view, not its own window) is
  pressed at measured points (ADR-0007):
  `openDeviceUi(live, {track, device, controls, width})`, with `controls` as
  `{name: {x, y, info}}`, each control's centre in points from the panel's corner at 100% zoom
  and the Info View title expected over it. With neither `build` nor `controls`, the points
  come from the harness's own measurements (`MEASURED_DEVICES`, by class name): Auto Filter's
  knobs, named as its parameters (`Frequency`, `Resonance`, `Dry/Wet` and the others).
  `ui.capture(file)` saves a PNG of the device, title bar and frame included, from a capture
  of Live's window; its width comes from the build, the measured device or `width`.
  A plug-in's own window, where its editor opens (ADR-0008):
  `openPluginWindow(live, {track, device, size, controls})` selects the device and opens the
  window if it isn't open (through Accessibility, no pointer), and resolves with an object
  whose `press(name)` clicks a control, `capture(file)` saves a PNG of the editor without
  Live's title bar, and `close()` closes the window. `size` is the editor's `[w, h]` and
  `controls` is `{name: {x, y}}`, each control's centre, both in points from the editor's top
  left. Live shows the window only while it is in front with the display on, so `press` and
  `capture` wake the display and bring Live to the front; `capture` gives the front back. A
  press throws `DeviceUiError` without clicking unless the screen is unlocked, the editor is
  `size`, the point inside it, and the plug-in's window on top at the point. There is no Info
  View to confirm the control: a moved point clicks another control of the plug-in, so take
  the evidence from Live. A press needs `size`; opening and capturing don't.
  To measure a plug-in's points: `node harness/cli.js plugin-window <track> <device> <png>`
  prints the editor's size (`editor: {w, h}`, the `size` to give) and saves the editor. Take
  each control's centre from the plug-in's own layout code, whose coordinates are these
  points when the editor isn't scaled, or from that picture: its pixels are points times the
  display's scale, its width in pixels divided by `editor.w`. Then press each control once and
  check that the parameter Live reads is the one meant, as a check does.
- `doctor.js`: read-only check that Live is ready to be driven; run it first. What it
  checks and what to do about each line: the
  [`verify-ableton` skill](../skills/verify-ableton/SKILL.md).
- `relaunch.js [--kill] [--suite | --app <path>] [--plugin <name>]`: quits Live if it runs and starts Ableton Live 12 Beta
  (Suite with `--suite`, another Live with `--app <path>`, which it checks exists before quitting anything), behind other windows, on a fresh copy of `sets/empty.als` (one MIDI track, unarmed, no
  devices, no returns, nothing on Main, Main at -inf dB so runs are silent (recordings take tracks' Post FX, before Main); saved by Live 12.4.25b1, opens in Suite 12.4.3), not
  the user's template. It answers "Save changes?" with Don't Save and "delete the temporary files?" with Delete, and kills Live if it is
  still running 10 s after the quit or the last answer (`--kill` kills at once). After a
  kill, or when it finds that Live crashed, it moves Live's recovery data into the
  preferences folder's `Crash` folder, so Live starts without asking to recover. Once the old Live has exited it deletes that Live's
  Temp Projects and the previous copy's folder. It stops at any other dialog, leaving it
  open. Once Live is up it creates and deletes an audio and a MIDI track (`warmUp`): Live's
  first track after it starts loads the plug-ins of the user's default track, which held
  Live for over 2 s, long enough for a check's next get to time out. Holds UDP 11001 throughout. With `--plugin <name>` Live starts instead on a set
  holding only the Audio Unit effect named `name` on track 0, every parameter listed
  (`buildPluginSet`, checked with `checkPluginLoaded`), and its last line names the component
  and when its code was built (`builtAt`), since Live plays the build it loaded until it
  relaunches; the set is built before Live is quit, so a plug-in that
  can't be found or read leaves Live running as it was. Any other option is refused, and so is `--suite` with `--app`.
- `quit.js [--kill]`: quits Live and leaves it quit, for when the user asks for that. It
  stops Live as `relaunch.js` does (same answers, same kill after 10 s, `--kill` kills at
  once, stops at any other dialog), then moves Live's recovery data aside, deletes its
  Temp Projects and empties the harness's temp folder. Holds UDP 11001 throughout, so it
  refuses while another client runs. Any other option is refused.
- `add-place.js <folder> [--suite | --app <path>]`: adds a folder to Places in `Library.cfg`,
  for the Live `relaunch.js` would start with those options. It refuses while Live runs and
  does nothing if the folder is already there. Places are told apart by path, so any number
  can be named `builds`. Live shows the new one when it next starts. Any other option is refused, and so is `--suite` with `--app`.
- `max/hook.js` and `Live.openHooks()`/`waitForHook()`: the test hook of
  [ADR-0002](../docs/adr/0002-test-hook.md), for reading what a development build of a
  device reports (status line, check results) over UDP 11002. Take the time before the
  action and pass it as `since`: `const since = Date.now(); live.setParameter(...);
  await live.waitForHook("check", { since })`.
- `tools.js` and `amxd.js`: shared by the modules above. `run(cmd, args)` runs a command,
  `helperBinary(source)` compiles a Swift helper once per version of its source,
  `escapeXml(text)`; `patcherChunk(bytes)` finds the patcher in an `.amxd`.
- `settings.js`: Live's settings, read from `Preferences.cfg` without touching Live's
  window. `recordBitDepth()` resolves with `{bits, float}` (16, 24, or 32 and float);
  `requireRecordBitDepth(bits)` rejects unless Live records at `bits`, with a message
  saying what to ask the user. A check that records but isn't on `audio.js` calls it before
  setting up its recording. `sampleRate()` resolves with `{rate}` in Hz, read from Live's
  log (`Log.txt`), and `requireSampleRate(rate)` rejects unless Live runs at `rate`, the
  same way; a check that needs a sample rate calls it before recording.
- `log.js`: Live's own log. `maxMessages({since})` resolves with the Max console messages
  (`{at, level, text}`) Live logged from `since` (ms timestamp or Date) on: take the time
  before a run and read them after it, to see why a device that loaded and answers OSC
  does nothing.
- `cli.js`: `node harness/cli.js ping | reload | query <address> [args] | send <address> [args] | notes <track> <clip> [--arrangement] | song-notes <track> | max-log [since] | windows | capture <png> [--window <id>] | plugin-window <track> <device> <png>`.
  `max-log` reads Live's log, not OSC, so it runs beside a check; `since` is ms or a local
  time such as `2026-10-31T11:18`, and defaults to Live's start. `windows` lists Live's
  windows on screen with their layer (`liveWindows` in `device-ui.js`): a dialog or a panel
  is a window of its own, and so is a plug-in's window (layer 3), listed only while Live is
  in front. `capture` saves a picture of Live's main window, or with `--window <id>` of one
  from that list, taken with Live behind other windows (`captureWindow`). Both need Screen
  Recording for the terminal app, and Automation for System Events: they wake the display
  first, as `macos.js` does. `plugin-window` opens a plug-in's own window if it isn't open
  and saves a picture of its editor (`openPluginWindow`), bringing Live to the front while it
  captures; it also needs Accessibility.
- `checks/record-roundtrip.js`: checks the recording path itself. It adds two tracks,
  records one's clip into the other through MIDI routing, compares, and deletes them.
- `checks/plugin-record.js [--keep]`: checks the plug-in path on Apple's AUDelay, which
  every Mac has. It exposes the parameters, records Operator through the plug-in and checks
  the output equals the signal at Dry/Wet Mix 0, and at Mix 1 trails it by the Delay Time
  set, at two settings (floats; the control that the output track records the plug-in).
  AUDelay has no enum parameters, so enum slots are not checked in Live. It replaces the
  open set with one holding only the plug-in, as `exposePluginParameters` does, so it refuses a set the harness
  didn't open.
- `checks/plugin-set.js <name> [--keep]`: checks the set built for the AU effect `<name>`
  against the plug-in as Live lists it itself: it exposes the parameters, loads the
  plug-in again from the Plug-Ins browser onto a new track, and checks that the built
  device lists the AU's parameters in its order, that Live's own list is that list with at
  most some left out, and that both read the same values. Up to 64 parameters, Live's own
  limit. It replaces the open set, as `plugin-record.js` does.
- `checks/example-device-check.js`: a template for a project's check, on Live's stock Pitch
  device, runnable as it stands.
- `checks/example-transpose-check.js`: the same for a Max for Live device, on
  `device-checks.js` and `devices/Example Transpose.amxd`. `devices/` must be in Live's
  Places; `devices/make-example-transpose.js` regenerates the device.
- `checks/save-reopen.js`: checks the save and reopen path. It replaces the open set with
  a new one saved in a temp folder; the file the set was opened from is untouched.

Project checks live in each project's repo, in `tests/live/`, and use this folder as a
library by path. Checks of a MIDI device run on `device-checks.js`; checks of audio or a
control signal have their own loop.

## Running

From the repo root, with Live open and AbletonOSC selected:

```sh
node harness/checks/record-roundtrip.js   # the harness's own recording path
node harness/checks/example-device-check.js  # a template for a project's check
node harness/checks/example-transpose-check.js  # the same on device-checks.js (needs harness/devices in Places)
node harness/checks/plugin-record.js      # the plug-in path, on AUDelay (replaces a set the harness opened)
node harness/checks/plugin-set.js <name>  # a plug-in's built set against Live's own (replaces a set the harness opened)
node ~/dev/<repo>/tests/live/<check>.js              # a project's checks
node ~/dev/<repo>/tests/live/<check>.js --keep       # leave its test tracks
node ~/dev/<repo>/tests/live/<check>.js --tempo 97   # at another tempo (left so)
node --test harness/tests/*.test.js       # unit tests, against a fake server; Live not needed
```

A check prints one PASS/FAIL line per case and exits 1 if any case fails. It adds its own
tracks at the end of the open set and deletes them afterwards, so any set will do, but the
transport, loop and Record Quantization are left changed. Only one client can run at a
time (UDP 11001). A recording refuses to start while a track it didn't arm is armed.

Each run of a check in a project's `tests/live/` is saved in that repo, one file per run in
`tests/live/logs/`, named `<time>-<check>.txt`: the script, arguments, machine, time, commit
and whether the code had uncommitted changes, then everything the run printed, then
`exit: <code>` (no exit line means the run was killed). `connect()` starts it, through
`run-log.js`; the harness's own tools and checks are not logged. The `verify-ableton`
skill has these logs committed in the project's repo. That is a convention: the harness
works without it.

## Running on a second Mac

The remote is a second Mac with its own Live, for running checks without touching this Mac's.
`remote.sh` runs any command there from this Mac:

```sh
harness/remote.sh ableton-live-test-harness node harness/doctor.js
harness/remote.sh <repo> node tests/live/<check>.js --tempo 97
```

It copies the working copies of this repo and `~/dev/<repo>` to the same paths in the remote's
home (uncommitted changes included; the remote can't fetch from this Mac), runs the command in
`~/dev/<repo>` there and exits with its status. Checks find the harness through
`~/dev/ableton-live-test-harness`, so the layout must match. The remote is the host named
as `remote` in `harness/local.json`, a file git ignores (`local.example.json` shows its
keys); `LIVE_REMOTE` names another for one run. `clickHost` in the same file is the hostname (without `.local`)
of the one machine `device-ui.js` clicks on without asking. A click takes that machine's pointer, so
name your own only if the agent may take it from you (ADR-0005); any other machine asks first (ADR-0006). `remote.sh` copies the file with the rest, so both machines read
the same values. The remote's own `.venv`, `node_modules` and `__pycache__` are not copied or deleted: a
project that needs them installs them there over ssh. A check's logs are not copied or
deleted either: `remote.sh` moves them to this Mac after the command, after a failure too,
and logs it can't move come back after the next run. There is no lock; the slot rule below
is what keeps two runs apart.

The remote only runs checks. Its copies are mirrors, replaced on every run, `.git` included:
never edit or commit in them, since the next run discards the work. Changes are made and
committed on this Mac.

Who holds the remote's Live: the session working on the remote, with full control (launch, quit,
save, settings, anything). Before taking it, that session asks the user whether another session
is working in Live there; if one is, it agrees slots with that session.

On the remote, link AbletonOSC into `~/Music/Ableton/User Library/Remote Scripts` from the
remote's copy of this repo, and give Live the same settings as on this Mac (Control Surface,
Count-In, any Options.txt entries). A project's builds folder must be in the remote's Places, pointing at the remote's copy
(`<remote home>/dev/<repo>/builds`): with Live quit there,
`harness/remote.sh <repo> node ../ableton-live-test-harness/harness/add-place.js builds`.
`macos.js` there runs under sshd, so give
`/usr/libexec/sshd-keygen-wrapper` Accessibility (System Settings > Privacy & Security);
System Events then needs no separate Automation approval. A command run
over ssh can't see the user's own Audio Units, so `plugin.js` runs `auval` and its
parameter helper as launchd jobs in the GUI session, which needs the user logged in at the screen (`user-session.js`).

While the remote's display sleeps, Live can't be brought to the front, so `macos.js` wakes the
display (declares user activity) before any step through Live's menus. The screen saver
must stay off there: waking doesn't reliably dismiss it.

## What Live needs

- AbletonOSC selected as a Control Surface.
- For `macos.js` and `doctor.js`: the terminal app that runs node allowed in System Settings > Privacy &
  Security > Accessibility, and under Automation > (that app) > System Events.
- For `device-ui.js` and `cli.js windows` and `capture`: Screen Recording for the terminal
  app, to capture Live's window; the two `cli.js` commands also need the Automation
  permission above.
- For a plug-in's own window (`openPluginWindow`, `cli.js plugin-window`): Accessibility for
  the terminal app too, and a Live that names its device view over Accessibility, as Live
  12.4 does (seen in 12.4.25b1; earlier versions not tried). Without it the window isn't
  opened, and the error says what it didn't find.
- Live in front while `saveSetAs()` types into it: keystrokes go to the frontmost app. It
  brings Live forward itself, types nothing if Live doesn't come, and puts the app that was
  in front back afterwards. Don't type in another app meanwhile. Menu commands
  (`clickMenu`: `saveSet`, Key and MIDI Map Mode) bring Live forward for the click and put
  it back too. A plug-in window's `press` and `capture` bring Live forward, since Live shows
  the window only then; `capture` puts the app back. Nothing else brings Live forward.
- Count-In off: "Installation" in the main README.
- Recording uses the Arrangement: `recordArrangement()` turns the loop off and sets Record
  Quantization to None, and leaves them that way.
- The record bit depth a check needs, if it needs one (see "Record bit depth").

## Record bit depth

Live records audio at the bit depth set in Settings > Record/Warp/Launch > Bit Depth. Two
settings matter here:

- 24-bit: integer samples. A sample above 1.0 (0 dBFS) is clipped to full scale, and every
  sample is rounded to the nearest of 2^24 steps, so a recording differs from the signal
  by up to half a step (about -144 dBFS).
- 32-bit float: the samples Live computed, unchanged. Nothing clips above 1.0 and nothing
  is rounded, so a take compares exactly with another or with what the code computed.

A check that measures levels above full scale, or compares samples more finely than 24-bit
rounding, needs 32-bit float. It says so (in its `tests/live/README.md` and its code) and
requires it: `bitDepth: 32` on `signalTracks`, or `requireRecordBitDepth(32)` before it
records. When Live is set otherwise the check refuses without recording. Checks that don't
need it work at either. `doctor.js` reports the current setting (`info records at 32-bit float`).
The setting is Live's, on each machine: the remote's is its own.

## Notes from Live

How Live behaves under the harness, found by running it: [live-notes.md](live-notes.md). Read
it when Live does something unexpected.
