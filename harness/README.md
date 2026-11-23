# Harness

A Node client for this AbletonOSC fork, for driving Live from tests. No dependencies;
Node 18 or later. See [ADR-0001](../docs/adr/0001-fork-abletonosc.md) for the design.
Paths here assume a clone at `~/dev/ableton-live-test-harness`, with the projects whose
checks it runs beside it.

- `osc.js`: OSC encoding. Integers go out as int32, other numbers as float32; wrap a value
  in `float()` or `double()` to choose.
- `live.js`: the client. `connect()` binds UDP 11001, so only one client can run at a
  time. Requests are sent one at a time and wait for their reply; a message on
  `/live/error` fails the request in flight. Setters and methods send no reply. Call
  `sync()` to wait until Live has handled them. Any address in
  [osc-api.md](../docs/osc-api.md) works through `query(address, ...args)` (resolves with
  the reply's arguments) and `send(address, ...args)`, or `get(object, property, ...indices)`
  and `set(...)` for `/live/<object>/get|set/<property>`: `live.set("view",
  "selected_track", 1)` selects track 1. `on(address, fn)` calls `fn(args)` for every message
  on that address, such as the replies a `/live/.../start_listen/...` sends; `off(address)`
  stops it. `deleteTracks(names, from)` deletes the tracks whose names are in `names`, from track index `from` on, last first;
  `dialog()` resolves with Live's open dialog, or null. `trackData(...properties)` reads
  properties of every track in one reply (null for one that doesn't apply to a track); `placeClip(track, notes, beats)` puts a clip of
  notes on a MIDI track in the Arrangement from beat 0.
  For plug-ins: `findDevice(name)` (`{track, device}`, refusing unless exactly
  one top-level device has the name), `setParameters(track, device, {name: value})` (a
  string picks a menu item by name), `moveDevice(track, device, target, position)`
  (keeps the instance and its state), `createAudioTrack(name)` and
  `arrangementAudioFiles(track)`.
- `compare.js`: `compareNotes` compares expected notes with recorded ones, with timing errors in ms. Live
  records at audio-sample resolution, so the errors have a floor of one sample: 0.021 ms at
  48 kHz, 0.023 ms at 44.1 kHz (Live runs at the audio device's rate). Where a beat is a
  whole number of samples (120 BPM at either rate) an error is 0 or 1 sample, depending on
  where Play started against the audio buffer; at other tempos it rounds to up to half a
  sample. Figures under one sample don't tell runs apart.
- `device-checks.js`: the runner for a project's checks of a MIDI device. `main(cases,
  {device, builds, build, longNames, notes, beats, compare, openHooks, onFail, tempo, reachMs})` loads the
  newest `<device> YYYY.MM.DD.N.amxd` in `builds` (or the file `build` names, for another
  naming: a file name, or a function of the folder returning one) onto a new track, from whichever Places
  folder has it (it refuses, saying what to fix, unless exactly one does), places a clip in
  the Arrangement there, and for each case sets parameters, records the device's Post FX
  output on a second track and compares it with the case's `expect(ctx)`. Both tracks are
  deleted afterwards (`--keep` leaves them; `--tempo <bpm>` sets the song's tempo first and
  leaves it). Settings use long names when the project passes
  `longNames`, a function of the build file that returns every visible parameter's long name (needed when short names repeat),
  otherwise Live's short names. `compare: {edgeBeats}` skips notes near
  the start and the stop, for a device whose first notes are late by design. Durations are
  compared only with `compare: {durationToleranceMs}`. Set it for a device whose note
  lengths matter. The case shape,
  the options and `ctx` are described at the top of `run()`. A case's `during` actions run
  while Live records; each gets the song time just before and after it, a window about one
  AbletonOSC tick (100 ms) wide. A `{beat, set: {name: value}}` entry sends the change
  without waiting, so the window brackets only it (an action that syncs or sleeps widens
  it). With `grid`, a case fails when its change may have crossed a grid line, which
  leaves the step it hit unknown; the grid step must be well over one tick plus `reachMs`
  (about 250 ms), or every run fails. `reachMs` is how long after a `during` window a change may still reach the device (default 50 ms). `buildScript(file)` reads the
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
  `swiftc` on first use and kept in the system temp folder's `ableton-harness-tools`, where
  each new build of a helper deletes that helper's builds unused for 7 days),
  has `auval -v` validate it, and starts each parameter at its default, the plug-in with
  no saved state.
  `checkPluginLoaded(live, name, parameters)` checks that Live lists them all and runs the
  plug-in itself, not a stand-in: an enum's value string must be the plug-in's own.
  `exposePluginParameters(live, name)` returns the plug-in if the open set already holds it
  that way; otherwise it opens such a set in the running Live, behind other windows (the
  song becomes the fixture's, at 120 BPM). It resolves with `{track, device, parameters,
  file}`, and refuses to replace a set the harness didn't make (one outside its temp folder),
  since opening discards unsaved changes; after a relaunch, `relaunch.js --plugin <name>`
  starts Live on the set instead.
  Instruments (`aumu`) and VST3 plug-ins refuse. Instruments are untested, and VST3 parameter
  IDs need a VST3 host to read.
- `audio.js`: measuring an audio effect's output. `signalTracks(live, {track, device,
  notes, beats, instrument, bitDepth})` adds a MIDI track (`harness-signal`, Operator unless
  `instrument` names another `[root, item]`) playing `notes` in the Arrangement, moves the
  effect onto an audio track of its own (`harness-plugin`) fed by it, and adds
  `harness-dry` and `harness-wet` to record the signal and the effect's Post FX output; its
  `restore()` moves the effect back to where it was and deletes the four tracks. It refuses
  in a set that already holds a `harness-signal` or `harness-plugin` track, as one saved
  with a rig in it does.
  `recordSignal(live, rig, {start, length, during})` records both (through
  `recordArrangement`, so `during` actions work) and resolves with `{dry, wet,
  sampleRate, files, windows}`, one `Float32Array` per channel; sample 0 is the recording's
  start, `start` in song beats, in both takes. `recordedSamples(live, track)` reads a
  track's last recorded clip. A check that needs float passes `bitDepth: 32`.
  `signalTracks` then refuses before adding tracks unless Live records at 32-bit float, and
  `recordSignal` refuses a take that isn't (see "Record bit depth" below).
- `wav.js`: `readWav(file)` reads a WAV file (PCM 8/16/24/32-bit, float 32/64-bit) into
  `{sampleRate, bits, float, channels}`, samples scaled to -1..1.
- `midi.js`: MIDI into Live as from a controller (ADR-0018). `openMidiPort()` opens the
  harness's own MIDI input port, `Harness`, and resolves with `cc(channel, controller,
  value)`, `noteOn(channel, pitch, velocity)`, `noteOff(channel, pitch)` (channels 1-16,
  each resolving once the message is sent) and `close()`. With MIDI Map Mode on
  (`setMidiMapMode`, `macos.js`), a press on a control (`device-ui.js`) and a CC map the
  control to that CC; with it off, the CC sets it. A key is mapped the same way in Key Map
  Mode, and pressed with `typeInLive`. Needs Remote on for the port ("What Live needs").
- `macos.js`: what the LOM can't do, through Live's menus with AppleScript: save (`saveSet`), save as (`saveSetAs`),
  open a set (`openSetAndWait(live, file)`: behind other windows, stopping the transport first, answering "Save changes?" and "This action
  will stop audio?", and resolving once the set has loaded), Key Map and MIDI Map Mode (`setKeyMapMode`, `setMidiMapMode`), and the name of the step Edit > Undo would
  undo (`undoName`). `tempFolder(prefix)` makes a folder in `<system temp>/ableton-harness/`, where every
  set the harness saves goes; `relaunch.js` and `quit.js` empty it.
- `device-ui.js`: presses a device's controls with real mouse events (ADR-0004), and
  captures its panel; does the same in a plug-in's own window (ADR-0008). Its clicks, with
  the asking and the overlay below, are **harness-computer-use**.
  On the machine `local.json` names as `clickHost` it clicks at once. On any other, a run's
  first press builds the click helper and the overlay, if they aren't built, then shows a
  dialog, and the run clicks only after Allow. Don't Allow or no answer in 2 minutes throws
  `DeviceUiError` (ADR-0006). From Allow until the run's process ends, the overlay
  (`computer-use-overlay.swift`) shows that the run may take the pointer: a breathing purple
  glow in from the screen's edges, and a pill naming the run. A notification says when the
  run has ended.
  Stop on the pill, or the stop key, takes the mouse back. How Stop works is in
  [ADR-0012](../docs/adr/0012-stop-a-run-from-its-pill-whatever-fails.md),
  [ADR-0015](../docs/adr/0015-keep-the-pill-up-while-a-stopped-run-ends.md), which replaces
  part of ADR-0012, and [ADR-0017](../docs/adr/0017-stop-a-run-with-a-key-too.md). Stop
  removes the run's click token, without which the run and its click helper don't click. The
  glow goes at once, and the pill stays, its button reading Stopping, until the run's process
  has ended. A run still going 10 s after Stop is left running, and the notification says
  so. If Stop can't remove the token, it signals the run instead. The glow then stays until
  the run has ended, and a run still there 10 s after the signal is killed. A killed run
  cleans nothing up.
  For a check, Stop means this. The press under way stops, with a button it holds released,
  and throws `DeviceUiError`, as do the run's later presses. So a check fails at the press
  that throws and still cleans up. After the signal, it has 10 s to clean up and end. If only the press's release was left, the
  click or the drag has happened. `error.done` is `true` on that press's error, and set on no
  other, so a check that must undo what a click did reads it in its cleanup. A stopped run
  doesn't bring Live to the front, so a capture of a plug-in's window throws too.
  The stop key is Control-Option-Command-Space (⌃⌥⌘Space), which the pill shows before its
  Stop and the dialog names. While the overlay runs, no app gets that key, Live included. A
  run whose overlay couldn't claim the key, or can't show, or goes while the run goes on and
  wasn't stopped, says so on stderr in a line starting `warn harness-computer-use`, and
  clicks on. When the overlay couldn't be built, the dialog says that nothing on screen will
  show that the run may take the pointer, and that there will be no Stop and no stop key.
  The dialog, the pill and the
  notification name a check in `tests/live/` as
  `tests/live/<check>.js`, another script by its file, and code run with `node -e` or given
  on stdin not at all.
  `openDeviceUi(live, {track, device, build})` takes the controls from the
  `.amxd`; `ui.press(name)` or `ui.press(tabName, item)` clicks, with
  `{ double: true }` or `{ shift: true }` after them a double-click or a Shift-click (ADR-0019;
  Stop between a double-click's clicks ends it with the first made, its error saying `done`), `ui.drag(name, {up, right})`
  turns a control by dragging it that many whole points with the button down, in one move
  (ADR-0013; a fraction of a point throws `DeviceUiError`; Auto Filter's knobs turn one of
  their 126 steps per point up, and a Max for Live number box in 2-point steps, with the
  distances to drag it by, `live-notes.md`),
  `ui.drag(name, {up, right}, {hold, then: {up, right}})` keeps the button down and the
  pointer still for `hold` ms (whole, 1 to 2000) after that move, then moves `then` further
  before the release, for a view that acts on what happens while the button is down (ADR-0021;
  the second drag event goes to the press point plus both moves; Stop during the hold brings
  the button up at once with no second move, its error saying `done`; a knob of one of Live's
  devices counts both events from the press point, so it turns further than both moves),
  `ui.choose(name, item)` opens the menu a control opens (a chooser) and clicks the one row
  that reads `item`, closing the menu with Escape if no row or more than one row reads `item` or anything else fails once the menu's control was clicked (ADR-0014; after Stop, once no modifier key is held, waiting 2 s at most and leaving the menu open with a warning if one still is, since the stop key's may be; see ADR-0017), and `ui.text([x, y, w, h])`
  resolves with the lines shown in that part of the panel, in device units. A press looks
  for the panel again, brings Live to the front, and throws `DeviceUiError` without clicking
  unless the screen is unlocked, Live's main window is on top at the point and the Info View
  names the control. It finds the panel from the device's frame in Device Detail, which
  Accessibility gives (ADR-0020). It needs the Info View and Device Detail visible, Live at
  100% zoom, the device in view and its name unique on its track, an unfrozen `.amxd`, and an
  `annotation_name` on the control; a `live.tab` must be a single column. Most of a press's
  time goes to reading the Info View from a capture. `press` resolves when the click is sent. Read what
  it did from Live.
  Any other device or plug-in (its controls in Live's device view, not its own window) is
  pressed at measured points (ADR-0007):
  `openDeviceUi(live, {track, device, controls, width})`, with `controls` as
  `{name: {x, y, info}}`, each control's centre in points from the panel's corner at 100% zoom
  and the Info View title expected over it. With neither `build` nor `controls`, the points
  come from the harness's own measurements (`MEASURED_DEVICES`, by class name): Auto Filter's
  knobs, named as its parameters (`Frequency`, `Resonance`, `Dry/Wet` and the others).
  `ui.capture(file)` saves a PNG of the device, title bar and frame included, from a capture
  of Live's window; its width comes from the build, the measured device or `width`. A device
  whose frame isn't wholly inside Live's window throws `DeviceUiError`, which says to bring
  it into view.
  A plug-in's own window, where its editor opens (ADR-0008):
  `openPluginWindow(live, {track, device, size, controls})` selects the device and opens the
  window if it isn't open (through Accessibility, no pointer), and resolves with an object
  whose `press(name)` clicks a control, `drag(name, {up, right})` turns one (ADR-0013; mainly
  what dragging is for, as Live's own devices are set over OSC; one move only, a held drag
  throws), `capture(file)` saves a PNG of the editor without
  Live's title bar, and `close()` closes the window. `size` is the editor's `[w, h]` and
  `controls` is `{name: {x, y}}`, each control's centre, both in points from the editor's top
  left. Live shows the window only while it is in front with the display on, so `press` and
  `capture` wake the display and bring Live to the front; `capture` gives the front back. A
  press throws `DeviceUiError` without clicking unless the screen is unlocked, the editor is
  `size`, the point inside it, and the plug-in's window on top at the point. There is no Info
  View to confirm the control. A moved point clicks another control of the plug-in, so take
  the evidence from Live. A press needs `size`; opening and capturing don't.
  How to measure a plug-in's points is in
  [writing-checks.md](../skills/verify-ableton/writing-checks.md#measure-a-plug-ins-points).
- `video.js`: a video of Live, for proof of something that changes over time (ADR-0016),
  for any project's checks as for the harness's own; a fixed state needs a still
  (`captureWindow`, `ui.capture`). `recordVideo(file, {window, screen, seconds})` records
  Live's main window, another of Live's windows by its id (from `liveWindows`), or with
  `screen` the whole main display, to `file` (a `.mov`; its folder is made, a file there
  replaced), or with no `file` to a new one in the captures folder (`captures.js`). It
  resolves once the recording has started, with `{file, pid, stop(), done()}`: `pid` is the
  recording helper's, `stop()` ends the recording now and `done()` waits for it to end by
  itself, both resolving with `{file, seconds, bytes}`, the video's length and size, and
  `early`, the reason, when it ended before it was stopped. A window recording ends when its
  window closes (a relaunch of Live closes the main window). A window is recorded alone, as
  `captureWindow` captures it: behind other windows, without harness-computer-use's border and
  pill, and without the menus, dialogs and other windows that open over it, each a window of
  its own; the screen has everything on it, those, the border, the pill and other apps
  included. The pointer shows in both. It records H.264 at up to 30 frames a second, at the
  data rate the Mac's encoder picks. Measured with Live idle or playing, the rate is about
  0.1 MB a second for
  Live's window on a 2x display and 0.2 for that display on an Intel Mac, and 0.46 and 0.75
  on an Apple-silicon one, so a recording of the default 10 minutes can reach about
  280 MB for a window and 450 MB for the screen; more movement costs more. It builds the
  helper first, then wakes the display, and keeps it on while it records. A display that
  sleeps leaves the video on its last picture. The recording stops after `seconds` (10
  minutes if not given), on `stop()`, when the run's process ends, however it ends, or, when
  the run's stderr is a pipe or a socket, once nothing reads it any more, as when the ssh
  session of a run on the remote ends (the run itself goes on; the result doesn't say why it
  stopped). A run whose stderr goes to a process still reading it, a check that started the
  run, say, records on. The file is whole each time. A run that fails or is killed still
  leaves the video up to then, and need not wait for it. A helper killed itself leaves its
  file whole too, but one it was writing in the captures folder stays under its hidden name
  there, in `.unfinished`, until the folder's prune deletes it (`captures.js`). The helper runs in a
  session of its own, a process group with no terminal, so Ctrl-C on the run doesn't reach
  it. The run stops it. A plug-in's own window shows only while
  Live is in front (ADR-0008), so recording it needs Live in front throughout.
  `videoFrame(file, seconds, png)` saves the frame the video shows at that time and resolves
  with `{file, at, w, h, seconds}`, the last the video's length. This is how an agent, which can't
  watch a video, sees what the video shows. With no `png` it goes to the captures folder, named as
  other captures are: the time, then `<video's name>-<seconds>s.png`. Both need macOS 15 or later, refused below with that reason; the
  helper (`video.swift`) is built with `swiftc` on first use, as the click helper is. A
  recording also needs what "What Live needs" lists for it.
- `captures.js`: where a capture given no path goes, from `cli.js`'s `capture`,
  `plugin-window`, `video` and `video-frame` and from `recordVideo` and `videoFrame`. Such a
  capture goes to the
  captures folder, `ableton-harness-captures` in the system temp folder, apart from the
  harness's temp folder that `relaunch.js` and `quit.js` empty, and is named by the local time and
  what it shows. Every capture they make goes through `startCapture`, given a path or none.
  `captureWindow` and `ui.capture` take a path; code that saves one of theirs uses
  `saveCapture(file, { name, ext }, write)`, with no `file` for the folder. A capture is proof to show
  once, not part of a project, so no project keeps a folder or a `.gitignore` line for one.
  macOS doesn't clear unused files from that temp folder within days. On macOS 26, whose
  clean-up (`dirhelper`) is set to 3 days, files more than 3 days old by both their times
  were still there after its daily runs. So each capture saved there deletes, once it is
  saved, the captures there older than 7 days. A capture left there lasts until a capture is saved
  more than 7 days after it. Two captures of one thing named in one millisecond get `-2`,
  `-3` after the name, and none given no path replaces a file. A capture is written in the folder's hidden `.unfinished`
  folder and moved out once it is finished, a video by its helper, so a file in the captures
  folder itself is whole (a folder, as `screencapture` refuses a file name that starts with a
  dot). A path the caller gives outside the folder is used as given, its folder made if it is
  missing, and nothing deletes it; one inside it follows the folder's rules. A capture of
  Live's window (`captureWindow`, `cli.js capture`) is written beside its file as
  `<name>-capturing-<random>.png` and renamed to it once whole. A run killed while it captures
  can leave that file there, and nothing deletes it outside the captures folder.
  `node harness/captures.js finished` lists the folder's finished captures, for `remote.sh`.
- `doctor.js`: read-only check that Live is ready to be driven; run it first. What it
  checks and what to do about each line are in the
  [`verify-ableton` skill](../skills/verify-ableton/SKILL.md).
- `relaunch.js [--kill] [--suite | --app <path>] [--plugin <name>]`: quits Live if it runs and starts the Live named by
  `--app <path>`, else Ableton Live 12 Suite with `--suite`, else `"app"` in `local.json`, else the Live that was running, else the only one in
  `/Applications`, and refuses to guess between several. It checks the Live exists before quitting anything. Live starts behind other windows, not on the user's template but on a fresh copy
  of `sets/empty.als`. That set has one MIDI track, unarmed, no
  devices, no returns, nothing on Main, and Main at -inf dB so runs are silent (recordings take tracks' Post FX, before Main); it was saved by Live 12.4.25b1 and opens in Suite 12.4.3.
  `relaunch.js` answers "Save changes?" with Don't Save and "delete the temporary files?" with Delete, and kills Live if it is
  still running 10 s after the quit or the last answer (`--kill` kills at once). After a
  kill, or when it finds that Live crashed, it moves Live's recovery data into the
  preferences folder's `Crash` folder, so Live starts without asking to recover. Once the old Live has exited it deletes that Live's
  Temp Projects and empties the harness's temp folder. It stops at any other dialog, leaving it
  open. Once Live is up it creates and deletes an audio and a MIDI track (`warmUp`). Live's
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
- `tools.js` and `amxd.js`: shared by the modules above. `run(cmd, args, {env, started})` runs a
  command, in the environment `env` if one is given, and hands its process to `started` if
  one is given, for a caller that may have to signal it,
  `helperBinary(source)` compiles a Swift helper once per version of its source into
  `ableton-harness-tools` in the system temp folder and, after each build it makes, deletes
  that helper's other builds there unused for 7 days (not found by a process of this
  checkout, which marks a build when it first finds it, nor run, by the later of its access
  and modification times; an older checkout of the harness doesn't mark the builds it finds,
  so one it has found but not yet run can be deleted under it),
  `escapeXml(text)`; `patcherChunk(bytes)` finds the patcher in an `.amxd`.
- `user-session.js`: runs a command where it sees the user's own Audio Units. A process
  started over ssh can't reach the user's component registrar, so outside the GUI session the
  command runs as a one-shot launchd job in the user's GUI domain (`launchctl bootstrap
  gui/<uid>`, no root needed), and its output and exit status come back through files.
- `settings.js`: Live's settings, read from `Preferences.cfg` without touching Live's
  window. `recordBitDepth()` resolves with `{bits, float}` (16, 24, or 32 and float);
  `requireRecordBitDepth(bits)` rejects unless Live records at `bits`, with a message
  saying what to ask the user. A check that records but isn't on `audio.js` calls it before
  setting up its recording. `sampleRate()` resolves with `{rate}` in Hz, read from Live's
  log (`Log.txt`), and `requireSampleRate(rate)` rejects unless Live runs at `rate`, the
  same way; a check that needs a sample rate calls it before recording.
- `log.js`: Live's own log. `maxMessages({since})` resolves with the Max console messages
  (`{at, level, text}`) Live logged from `since` (ms timestamp or Date) on. Take the time
  before a run and read them after it, to see why a device that loaded and answers OSC
  does nothing.
- `run-log.js`: saves each run of a project's check in `tests/live/` in that project's repo,
  one file per run in `tests/live/logs/` ("Running"). `connect()` starts it. Only a script
  inside a `tests/live/` folder is logged, and no `node -e` script. A log that can't be
  written never fails the check.
- `cli.js`: `node harness/cli.js ping | reload | query <address> [args] | send <address> [args] | notes <track> <clip> [--arrangement] | song-notes <track> | max-log [since] | windows | capture [<png>] [--window <id>] | plugin-window <track> <device> [<png>] | video [<file.mov>] [--seconds <n>] [--window <id> | --screen] [-- <command...>] | video-frame <file.mov> <seconds> [<png>] | midi-port [--seconds <n>]`.
  `max-log` reads Live's log, not OSC, so it runs beside a check; `since` is ms or a local
  time such as `2026-10-31T11:18`, and defaults to Live's start. `windows` lists Live's
  windows on screen with their layer (`liveWindows` in `device-ui.js`). A dialog or a panel
  is a window of its own, and so is a plug-in's window (layer 3), listed only while Live is
  in front. `capture` saves a picture of Live's main window, or with `--window <id>` of one
  from that list, taken with Live behind other windows (`captureWindow`). Both need Screen
  Recording for the terminal app, and Automation for System Events. They wake the display
  first, as `macos.js` does. `plugin-window` opens a plug-in's own window if it isn't open
  and saves a picture of its editor (`openPluginWindow`), bringing Live to the front while it
  captures; it also needs Accessibility. `video` records Live's main window, a window from
  `windows` with `--window <id>`, or the main display with `--screen` (`recordVideo`). It says
  `recording <file>` on stderr once it records, and nothing before that line is in the video;
  then it records until the command after `--` ends, the `--seconds` given, Ctrl-C or SIGTERM,
  10 minutes at most without `--seconds`, and prints `{file, seconds, bytes}`, with `early`
  when it ended before it was stopped. With a command, the command runs in a session of its
  own with no input. Each Ctrl-C, SIGTERM, SIGHUP or SIGQUIT `video` gets reaches the
  command's whole process group once, as a terminal's would, the recording goes on until the
  command has ended, and `video` exits with the command's status, adding it as `status`; a
  recording that fails as it stops is reported as `error`, the status kept. What the command
  leaves running in its group gets SIGTERM as the command ends, or as `video` ends first,
  unless a signal `video` doesn't handle ends it (SIGKILL, SIGUSR2, an abort).
  It needs no OSC, so it runs around a check, which is the way to record one; from a
  project's repo, `node ~/dev/ableton-live-test-harness/harness/cli.js video -- node
  tests/live/<check>.js`. `video-frame` saves the frame a video
  shows at a time, in seconds (`videoFrame`). `capture`, `plugin-window`, `video` and
  `video-frame` given a file make its folder if it is missing, given no file save to the
  captures folder (`captures.js`), and each prints the file's path. `midi-port` holds the
  `Harness` port open until Ctrl-C, or for the seconds given.
- `checks/record-roundtrip.js`: checks the recording path and the note addresses. It adds
  two tracks, records one's clip into the other through MIDI routing, and compares both the
  clip's notes read back (`songNotes()`) and the recording with the notes the clip plays.
  Then it reads the Session clip the Arrangement clip was copied from, and removes its
  notes, with no arguments, and deletes the tracks. The clip holds notes at pitches 0 and
  127 and two outside the clip, more than 8192 beats before and after its start, which only
  the Session read and the removal see. It prints a PASS/FAIL line per comparison, with the
  missing and extra notes on a failure.
- `checks/automation-record.js`: checks `recordArrangement`'s `automation` option on Auto
  Filter, with no track armed. A pass sets Frequency to 0.8 at beat 1 and to 0.3 at beat 3. A
  second pass, with nothing set, reads Frequency at beat 2: 0.3 without the option, as Live
  then writes no automation, and 0.8 with it. Each runs with Automation Arm off and then on,
  on a new track each time, and must leave Automation Arm as it found it. The tracks are
  deleted at the end. Needs Count-In off.
- `checks/plugin-record.js [--keep]`: checks the plug-in path on Apple's AUDelay, which
  every Mac has. It exposes the parameters, records Operator through the plug-in and checks
  the output equals the signal at Dry/Wet Mix 0, and at Mix 1 trails it by the Delay Time
  set, at two settings (floats; the control that the output track records the plug-in).
  AUDelay has no enum parameters, so enum slots are not checked in Live. It replaces the
  open set with one holding only the plug-in, as `exposePluginParameters` does, so it refuses a set the harness
  didn't make.
- `checks/plugin-set.js <name> [--keep]`: checks the set built for the AU effect `<name>`
  against the plug-in as Live lists it itself. It exposes the parameters, loads the
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
- `checks/pointer-guards.js`: checks what `device-ui.swift` posts and what it refuses, and
  what Stop on the pill of `computer-use-overlay.swift` and its stop key do, with real mouse
  events. It runs only on the click host, with no Live, and takes about 290 s. Its cases are
  listed at the top of the file.
- `checks/editor-guards.js`: checks what the helper's `click-editor` and `drag-editor`
  refuse, which `pointer-guards.js` can't run, since they take only a plug-in window of
  Live's (ADR-0008). In Live, it adds an audio track with Apple's AUDelay, opens its window
  and runs the helper against the editor's Dry/Wet Mix slider, with a click token as a
  run's helpers have, once for each command in each case. It compares the helper's exit
  status and error, the mouse events the helper posted (`checks/event-tap.swift`, a
  listen-only event tap) and Dry/Wet Mix, read over OSC. A click and a drag reach the
  editor, under harness-computer-use's border too, and the drag moves the slider as
  measured. Each command is refused, posting nothing and leaving the value as it was, for a
  window of another app over the point; for an editor that isn't the size given, by its
  width or by its height; for a point on any of the editor's four edges, or left of it in
  its window; for the plug-in's window closed; for a coordinate that is no number; and for
  a notification's banner that keeps the screen covered past the 10 s the helper waits for
  it to go. A window that comes over the point during the hover gets no button event and is
  named in the error, the helper having posted only the hover's two moves. The tap
  suspends the helper at its first move (SIGSTOP) until that window shows. A run whose
  token is gone posts nothing and exits 3. A drag is refused too for a fraction of a point,
  for no distance, for over 400 points, and for an end off the screen, a point past the
  main display's top edge, or its left edge where the top is more than 400 points away, so
  the check assumes no display beyond either. A case fails if the system turned the tap off
  during it. Not run: the locked screen, which staging would lock the Mac; a point under
  the pill, which AUDelay's editor can't reach, lying 194 points below the top of its
  window; two windows of the editor's title, which Live doesn't show at once; and an
  editor with other than one group in its window. It takes the pointer, so it runs only
  on the click host, with Live open; it brings Live to the front, deletes its track at the
  end, and takes about 80 s.
- `checks/video-record.js [--out <folder>]`: checks `video.js` and its helper in Live. With
  Live playing, so its window changes, it records Live's main window, and the main display
  with Live in front, for 4 s; a video around a command that runs 3 s and exits 3 (the
  status must come back); one around a command given Ctrl-C after 2 s, as a terminal gives
  it, to the run's whole process group, which takes 1 s to clean up and exits 5 (the command
  must get one SIGINT, the status must come back, the video must hold the clean-up, and a
  `cli.js video` still running 15 s after fails the case); one that `cli.js video` stops on
  SIGTERM after 3 s (it must exit 0 within 30 s and finish the file); one whose run's stderr closes after
  2 s, as an ssh session's does when it ends (the recording must end then); one of a window that
  closes after 2 s (a panel of its own, `checks/pointer-target.swift`; the result must say it
  ended early); and one whose run is killed after 3 s (its helper must end within 15 s, the
  file whole and 3 s long). Each video must be within 0.6 s of its length (the one around
  the command within 1.2 s over it, the Ctrl-C one at least 2.4 s), a window's frames the
  window's size at the display's scale, and each must have a frame at each time checked,
  saved beside it; the frames of a video that moved, at each second and 0.25 s before its
  end, must each differ from the one before, so a video that froze, as one does while the
  display sleeps, fails. It also runs `cli.js video`, `capture` and `video-frame` with no
  file. Each must save to the captures folder, moved out of its unfinished folder, and say
  where; it deletes what they saved. The frames are for looking at. With `--out` the videos
  and frames are kept in that folder, otherwise deleted. Leaves the transport stopped; takes
  about 70 s.
- `checks/midi-map.js`: checks `midi.js` (ADR-0018) and the map modes on Auto Filter. It
  opens the `Harness` port, maps Frequency to a CC in MIDI Map Mode (a press through
  `device-ui.js` and a CC), and checks that CCs then move Frequency to its ends and between.
  Then it maps Resonance to a key in Key Map Mode and checks that pressing the key toggles it.
  It needs Remote on for the `Harness` input and what `device-ui.js` needs ("What Live
  needs"), and runs on the click host. It brings Live to the front for the key, and deletes
  the track and its mappings afterwards.

Project checks live in each project's repo, in `tests/live/`, and use this folder as a
library by path. Checks of a MIDI device run on `device-checks.js`; checks of audio or a
control signal have their own loop.

## Settings

What differs per machine is in `harness/local.json`, which git ignores; copy
`local.example.json` to start one. Every key is optional, and `doctor.js` prints what each
is set to and what is off without it. `remote.sh` copies the file to the remote with the
rest of the clone, so both machines read the same values.

- `app`: the path of the Live `relaunch.js` and `add-place.js` use when `--app` and
  `--suite` aren't given. Unset, `relaunch.js` uses the running Live, else the only one in
  `/Applications`. `add-place.js` runs with Live quit, so it uses the only one. Both refuse
  when several are installed.
- `remote`: the ssh destination (`user@host`) of the second Mac `remote.sh` runs on
  ("Running on a second Mac"). `LIVE_REMOTE` names another for one run.
- `clickHost`: the hostname (without `.local`) of the one machine `device-ui.js` clicks on
  without asking. A click takes that machine's pointer, so name your own only if the agent
  may take it from you (ADR-0005); any other machine asks first (ADR-0006).

## Running

From the repo root, with Live open and AbletonOSC selected:

```sh
node harness/checks/record-roundtrip.js   # the harness's own recording path
node harness/checks/automation-record.js  # recordArrangement's automation option, on Auto Filter
node harness/checks/example-device-check.js  # a template for a project's check
node harness/checks/example-transpose-check.js  # the same on device-checks.js (needs harness/devices in Places)
node harness/checks/plugin-record.js      # the plug-in path, on AUDelay (replaces a set the harness made)
node harness/checks/plugin-set.js <name>  # a plug-in's built set against Live's own (replaces a set the harness made)
node harness/checks/save-reopen.js        # the save and reopen path (replaces the open set)
node harness/checks/pointer-guards.js     # what the click helper posts and refuses (Live not needed; on the click host only)
node harness/checks/editor-guards.js      # what the click helper refuses in a plug-in's editor, on AUDelay (on the click host only)
node harness/checks/video-record.js       # video recordings of Live, and their frames
node harness/checks/midi-map.js           # MIDI and key mapping through the Harness port, on Auto Filter (on the click host)
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
skill tells agents to commit these logs in the project's repo. The harness works without
that.

## Running on a second Mac

The remote is a second Mac with its own Live, for running checks without touching this Mac's.
`remote.sh` runs any command there from this Mac:

```sh
harness/remote.sh ableton-live-test-harness node harness/doctor.js
harness/remote.sh <repo> node tests/live/<check>.js --tempo 97
```

The repos are the folders beside this clone (`~/dev` for a clone at
`~/dev/ableton-live-test-harness`), which must be under your home folder; on the remote they
are the folder at the same path under its user's home. `<repo>` is a git repo there or one
level down (`product/repo`, for a folder that holds a repo per format), or a git worktree of
such a repo at any depth there (`project/.worktrees/branch`); `remote.sh` refuses any other
path, and a folder that isn't a repo, so it never syncs, or deletes in, a parent of a repo on
the remote. For a worktree it copies its repo's `.git` too and points the remote's copy of the
worktree's `.git` file at it, so git, and the commit in a check's log, work there; the rest of
the repo's working copy isn't copied. To run checks from a worktree of this clone, so that runs from
the clone don't see changes in progress, put the worktree in a folder beside the clone
(`../<clone>-<branch>` from the clone), not inside it, where `remote.sh` refuses it, as its
repo isn't then one of the repos; run the worktree's own `remote.sh`, with the
worktree's folder name as `<repo>` for its own checks. It copies the working copies of this clone and of `<repo>` to the same
paths in the remote's home (uncommitted changes included; the remote can't fetch from this
Mac), runs the command in `<repo>` there, with `LIVE_HARNESS` set to the remote's copy of
`harness/`, and exits with its status. The remote is the host named
as `remote` in `harness/local.json` ("Settings"). The remote's own `.venv`, `node_modules` and `__pycache__` are not copied or deleted. A
project that needs them installs them there over ssh. A check's logs (`tests/live/logs/`, at
any depth, so a worktree's inside a repo too) are not copied or deleted either. `remote.sh`
moves those of `<repo>` to this Mac after the command, after a failure too, and logs it can't
move come back after the next run. A worktree's logs come back when the run names the
worktree, not its repo. Stills, videos and frames taken on the
remote with no path come back too, from its captures folder to this Mac's (`captures.js`).
Only finished ones come back, not a video still being recorded, and none whose name this
Mac's folder
has already, which stays on the remote and is said so; `remote.sh` names each one it brings
back, at its path here. A path given on the remote stays there. Ctrl-C on `remote.sh` ends
it and its ssh, as the terminal signals both, and no signal reaches the remote. The run there
goes on to its end. A SIGTERM sent to `remote.sh` alone ends only `remote.sh`. Its ssh, and
so the session, goes on to the run's end. A recording there whose run's stderr is the
session's stops when the session ends, as nothing reads that stderr any more (`video.js`),
and its file is finished; one whose run's stderr goes to another process there records on.
The run's logs and captures stay there and come back after the next run. There is no lock; the slot rule below is what keeps two runs apart.

The remote only runs checks. Its copies are mirrors, replaced on every run, `.git` included.
Never edit or commit in them, since the next run discards the work. Changes are made and
committed on this Mac.

The session working on the remote holds the remote's Live, with full control (launch, quit,
save, settings, anything). Before taking it, that session asks the user whether another session
is working in Live there; if one is, it agrees slots with that session.

On the remote, link AbletonOSC into `~/Music/Ableton/User Library/Remote Scripts` from the
remote's copy of this repo, and give Live the same settings as on this Mac (Control Surface,
Count-In, any Options.txt entries). A project's builds folder must be in the remote's Places, pointing at the remote's copy
(`<repo>/builds` there): with Live quit there,
`harness/remote.sh <repo> node ../ableton-live-test-harness/harness/add-place.js builds`
(`../../ableton-live-test-harness` for a repo one level down; the clone's folder name if it
has another). A worktree's builds folder isn't in Places unless added the same way, and a
build is found by its file name in every Places folder (`device-checks.js`), so a worktree's
build named as the repo's is refused as being in two Places. Either give the worktree's builds
names of their own and add its builds folder to Places, or copy the build into the repo's
builds folder there before the check (a run that names the worktree doesn't replace the
repo's working copy; one that names the repo does).
`macos.js` there runs under sshd, so give
`/usr/libexec/sshd-keygen-wrapper` Accessibility (System Settings > Privacy & Security);
System Events then needs no separate Automation approval. A command run
over ssh can't see the user's own Audio Units, so `plugin.js` runs `auval` and its
parameter helper as launchd jobs in the GUI session, which needs the user logged in at the screen (`user-session.js`).

While the remote's display sleeps, Live can't be brought to the front, so `macos.js` wakes the
display (declares user activity) before any step through Live's menus. The screen saver
must stay off there. Waking doesn't reliably dismiss it.

## What Live needs

- AbletonOSC selected as a Control Surface.
- For `macos.js` and `doctor.js`: the terminal app that runs node allowed in System Settings > Privacy &
  Security > Accessibility, and under Automation > (that app) > System Events.
- For `device-ui.js` and `cli.js windows` and `capture`: Screen Recording for the terminal
  app, to capture Live's window; the two `cli.js` commands also need the Automation
  permission above. `device-ui.js` also needs Accessibility, and Automation for System
  Events: every press, `ui.text` and `ui.capture` finds the panel through Accessibility
  (ADR-0020) and wakes the display through System Events.
- For `video.js` and `cli.js video`: macOS 15 or later, Screen Recording for the terminal app,
  and Automation for System Events, which wakes the display first, as for `capture`; for
  `video-frame`, macOS 15 or later only. A recording that can't wake the display says why,
  and names the Automation permission when System Events refused the terminal app.
- For a plug-in's own window (`openPluginWindow`, `cli.js plugin-window`): Accessibility for
  the terminal app too, and a Live that names its device view over Accessibility, as Live
  12.4 does (seen in 12.4.25b1; earlier versions not tried). Without it the window isn't
  opened, and the error says what it didn't find.
- Live in front while `saveSetAs()` types into it, since keystrokes go to the frontmost app. It
  brings Live forward itself and types only from a script that finds Live in front; if
  another app comes forward, it brings Live back; it tries three times in all, then fails
  having typed nothing. It puts the app that was in front back afterwards. Don't click or type in another
  app meanwhile, or the save fails. Menu commands
  (`clickMenu`: `saveSet`, Key and MIDI Map Mode) bring Live forward for the click and put
  it back too. A plug-in window's `press` and `capture` bring Live forward, since Live shows
  the window only then; `capture` puts the app back. Device presses (`ui.press`, `ui.drag`, `ui.choose`) also
  bring Live forward and leave it there, and so does `typeInLive` outside `saveSetAs`.
- For `midi.js`: Remote on for the MIDI input `Harness` in Live's Settings > Link, Tempo &
  MIDI, and Track on for notes into a track, set once per Mac while `node harness/cli.js
  midi-port` holds the port open. Live keeps it after the port closes and after a relaunch.
- Count-In off (see "Installation" in the main README).
- Recording uses the Arrangement. `recordArrangement()` turns the loop off and sets Record
  Quantization to None, and leaves them that way. It turns Automation Arm off while it
  records, or on with `automation: true` to write automation, and puts it back after. A
  relocation while it records ends Live's take, so it throws if Record is off after a
  `during` action or at the end (`live-notes.md`).
- The record bit depth a check needs, if it needs one (see "Record bit depth").

## Record bit depth

Live records audio at the bit depth set in Settings > Record, Warp & Launch > Bit Depth. Two
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
The setting is Live's, on each machine, and the remote's is its own.

## Notes from Live

[live-notes.md](live-notes.md) records how Live behaves under the harness, found by running it. Read
it when Live does something unexpected.
