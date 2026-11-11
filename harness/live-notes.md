# Notes from Live

How Live behaves under the harness, found by running it. Read this when Live does something
unexpected.

## Dialogs

- Live's dialogs show over the LOM while open (`open_dialog_count`, message, button count)
  and OSC keeps working, but their buttons have no names there or over Accessibility. In
  "Save changes to ... before closing?" the buttons are 0 Don't Save, 1 Cancel, 2 Save. In
  "Would you like to delete the temporary files in .../<time> Temp Project?", asked after
  it on quitting a set never saved that recorded audio, they are 0 leave them, 1 Cancel, 2
  Delete. "This action will stop audio. Proceed?" (0 Cancel, 1 OK) comes when a set is
  opened while the transport plays and the open set has no unsaved changes; stopped, Live
  doesn't ask.
- After a kill, Live starts at "Live unexpectedly quit... Would you like to recover your
  work?" (No, Yes). It isn't a LOM dialog, takes keys only with Live frontmost, and Escape
  doesn't answer it. Live asks while its recovery data (`CrashRecoveryInfo.cfg`, `Undo`,
  `BaseFiles` in its preferences folder) is there; `CrashDetection.cfg`, which reads
  "Running" while Live runs and is gone after a clean quit, doesn't decide it. With the
  data moved into `Crash`, Live starts with a new set and doesn't ask. `open -a` fails with
  error -600 for a few seconds after a kill.
- While Live starts, AbletonOSC can answer while the LOM still reports a dialog with no
  message; it is gone a second later.
- After File > New Live Set (`clickMenu`) with unsaved changes, the LOM can't read or press
  Live's "Save changes?" dialog: it reports no message and no buttons. `saveSetAs` into a
  temp folder first. `openSetAndWait`'s path (opening a file) does get the message.

## Saving and opening sets

- Live's Save panel counts as an open dialog over the LOM (no message, no buttons), and
  some requests fail while it is open (a fresh track's input routing reads ""). `saveSetAs()`
  closes the panel if it fails.
- Live's Save panel takes keys about a second after it appears, and Go to Folder's
  highlighted suggestion lags the typed path: Return half a second after typing went to
  the previous temp folder. `saveSetAs` waits for both. Go to Folder lists the folder that
  holds the typed one, and with 15,857 entries there (the system temp folder) it was still
  "Loading..." when Return was pressed, which was lost: `saveSetAs` presses Return again
  until the sheet closes, and saves into a folder under the harness's own small
  `ableton-harness/`. Accessibility shows only that the sheet is open, nothing in it. With
  Live's windows on another Space, Live comes to the front without them: Accessibility
  lists no windows and `saveSetAs` can't find or close its panel. Keep Live on the Space the harness runs on.
- AbletonOSC keeps running across opening another set.
- `relaunch.js` and `quit.js` empty the harness's temp folder, where every set the harness
  saves or starts Live on is, while they hold UDP 11001, the port a check holds while it
  runs. So `quit.js` refuses while another client runs, also when Live isn't running.
- A new Live writes one `Temp Project` folder in `~/Music/Ableton/Live Recordings`, named
  for a time some seconds after it started, and records into it a set never saved or one
  saved outside a Live project (a lone `.als`). Quitting asks about deleting it only for a
  set never saved.

## Menus and windows

- Live updates its menus' check marks about a second after a change; `setToggle()` waits.
- Edit > Undo names a change made over OSC "Custom Action"; the same change made in the UI
  gets its own name (a track rename: "Track Name"). Checks of undo step names must make
  the change in the UI.
- `macos.js` addresses Live's process as "Live", which Suite and Beta share: run one Live at
  a time.
- Live and Max take posted mouse events (`CGEvent`, HID tap) like a real mouse. Over a
  transparent `live.tab` above a `v8ui` with `ignoreclick`, both the Info View and the click
  reach the tab (on the remote Mac, 2026-11-08). The Info View's title is on the same row as
  the device titles, and it changes when the pointer moves.
- While the remote Mac's display sleeps, `screencapture -l` fails with "could not create image from
  window", and the session reports the screen locked until the display wakes.

## Tracks and devices

- New MIDI tracks get the devices of Live's default MIDI track template; `createMidiTrack()`
  removes them so they can't alter a recording.
- New audio tracks get the devices of Live's default audio track template, as MIDI tracks
  do; `createAudioTrack()` removes them.
- A Max for Live device's parameters arrive seconds after the device; `loadDevice()` waits.
  Their names are the short names, which can repeat within a device. Live lists the visible
  (automated) parameters after "Device On" sorted by long name, which
  `parameterIndices()` uses to map long names to indices. Stored Only parameters are not
  in the list and cannot be set. The sort order is presumably Max's `parameter_order`
  attribute at its default of 0 (not verified); a device that sets it breaks the mapping,
  which `parameterIndices()` then reports.
- The browser lists `.amxd` devices without the extension.
- Live crashes loading an `.amxd` whose patcher has a `project` without a `searchpath`: Max
  reads it unchecked while it builds the device (seen in Live 12.4.25b1).
- A track whose MIDI From source is deleted can no longer be armed or disarmed ("The Track
  in question cannot be armed!"): delete the recording track before its source.
- Live's input routing list follows a track rename a tick later, and the routing setter
  only logs an unknown name; use `setInputRouting()`, which waits and checks.
- Loading a device from the browser selects its track.
- `-EnableArmOnSelection` is an optional Options.txt entry; without it, none of this
  applies. With it, the arm follows the selection: while a track is armed, selecting another
  moves the arm to it; with no track armed, selecting a track arms nothing (Live 12.4.16,
  2026-11-10). Loading an instrument armed its track (2026-10-31): `signalTracks` disarms the source track after loading its
  instrument, or `recordArrangement` refuses. Loading a MIDI effect onto a track, with no
  track armed, armed nothing.
- `/live/view/set/selected_track` once left the selection unchanged, with no error sent or
  logged: after a track had been armed, recorded in the Arrangement (`recordArrangement`)
  and disarmed, setting another track and then `sync()` still read the old track from
  `/live/view/get/selected_track`, and the Detail View still showed it. Live was frontmost
  in Arrangement view (Live 12.4.16, 2026-11-09). The same steps on a Live whose window
  wasn't redrawing (it showed none of the changes) selected the track every time, so the
  cause is not known.
  `/live/view/set/selected_device` on a device of the wanted track selected that track.
  Read `get/selected_track` back after setting it. `/live/browser/load` does: it refuses,
  loading nothing, when the track it selected isn't the selected one.
- A value listener left on a parameter by an earlier session kept sending after its client
  was gone (`stop_listen` answered "Observer not connected"). Its updates arrive on
  `/live/device/get/parameter/value`, the address a `parameter/value` query answers on, so
  every such query returned the listened parameter's value; the `parameters/value` list was
  unaffected. Queries answered right again once the device holding the listener (a Utility)
  was deleted. Found 2026-11-03.

## Recording and timing

- Note times from `/live/clip/get/notes` and `/live/arrangement_clip/get/notes` are in the
  clip's own time. `songNotes()` places an Arrangement clip's notes in song beats, including
  loop repeats.
- Play starts from the start marker, `Song.start_time`; `recordArrangement()` sets it to
  `start` and leaves cue points alone. Setting `current_song_time` while stopped doesn't
  move the marker, Stop while stopped puts it back at 0, and turning `record_mode` on while
  stopped starts Play at once, so the marker goes first. Don't reach a start through a cue
  point: in some sets a cue point added while stopped snaps to the bar.
- While any track's Session clip is active (`playing_slot_index` 0 or more, even with the
  transport stopped), Live starts Play from the bar at or before the start marker: bars of
  4 x numerator / denominator beats from beat 0 (time signature changes in the Arrangement
  are not seen). `recordArrangement()` then refuses a start off a bar line, naming the bar
  Live would use: start on a bar line, stop the clips, or record from 0. One set, after a
  crash, started at the marker instead. Stop while the transport is stopped leaves the
  clip active (measured in Live 12.4.15b7), so the Stop
  `recordArrangement()` sends before Play doesn't change this.
- With Automation Arm on, a parameter changed while Live records (a `during` action) is
  written as automation on the device's track and replays later. `recordArrangement()`
  turns Automation Arm off while it records and back on afterwards.
- Live records audio as WAV at the record bit depth (see "Record bit depth" in `README.md`) and the
  audio device's rate, into the set's `Samples/Recorded`, named
  `<track> 0001 [<date> <time>].wav`; `file_path` of the
  Arrangement clip gives it. The take starts at the recording's start: notes at beats 0, 1,
  2 began within 3 samples of their beat at 120 BPM. A track whose input is another
  track's Post FX and monitoring In passes that signal without being armed.
- Overlapping notes of the same pitch in a clip came back shortened once (inferred to be
  Live trimming the overlap); keep test fixtures free of same-pitch overlaps.

## Plug-ins

- A plug-in's parameters are DeviceParameters only when it has at most 64 (Ableton's help
  documents the Options.txt entry `-_PluginAutoPopulateThreshold`, default 64, range 1 to
  128; forum reports say it is unreliable for AU and VST3; not tried here, as it needs a
  Live restart). Above that, Live lists only "Device On" (and sometimes "Bypass") until
  parameters are added in Configure mode. A plug-in with more than 64 showed this (Live 12.4.25b1).
  So `loadDevice()` takes a plug-in's count once it has held for a second, even at 1, where
  a Max for Live device must also list more than Device On.
- Live keeps a plug-in's configured parameters in the set: the device's `ParameterList`
  holds 128 pairs of slots, a `PluginFloatParameter` (Id 2i) then a `PluginEnumParameter`
  (Id 2i+1), each with a `ParameterId` (the AU parameter ID, -1 when free), a
  `ParameterName`, a `VisualIndex` (the order Live lists them in), a `Manual` value and,
  for enums, a `LastItemCount`. Live puts the parameter at index i of the AU's
  `ParameterList` in pair i, in the slot of its kind, and leaves the other empty (seen for
  a plug-in Live populated itself); its own population lists them in that order
  (2026-11-03). Filling slots that way and reopening the set makes Live list them, settable
  over the LOM (`plugin.js`). Filled instead into the first free slot of each kind, so a
  float and an enum shared a pair, every parameter read back in Live but some floats never
  reached the plug-in: with one plug-in, one float did not while another did (measured
  2026-10-31).
  `Manual` is the value Live shows, not read from the plug-in nor pushed into it at load
  (a float with `Manual` below its default showed the `Manual` while the plug-in held its
  default, 2026-11-03): normalized 0..1 for a float
  (AUDelay's 50 % Dry/Wet is 0.5, its -99.9..99.9 % Feedback at 50 % is 0.75), on a log
  scale for one flagged Display Logarithmic (its 10..22050 Hz Lowpass at 15000 Hz is 0.95), an item index
  for an enum; unfilled it reads 0.1234567687. An enum slot left at `LastItemCount` 1 reads
  every value as 0. An unconfigured device keeps a slot named "Bypass" with ID -1 in
  slot 1. Over the LOM, a plug-in float's value is normalized too (AUDelay's Dry/Wet takes
  0..1, not 0..100), and its `value_string` can be that number, not the plug-in's text
  (a time parameter reads a number such as "0.43", not its text).
- Live's own population can leave parameters out: for AUDelay it listed 3 of its 4 (not
  Delay Time, flagged Not Real Time); written into the set, Delay Time is listed too.
- `auval -v <type> <subtype> <manufacturer>` lists an AU's parameters with their IDs,
  units ("Parameter Type": Indexed and Boolean are enums; Generic, Percent, Seconds, Hertz
  and the rest are floats), ranges, defaults and value strings, but clump by clump, not in
  the AU's `ParameterList` order, and with ranges and defaults as the plug-in's display
  text when it supplies one (a parameter that is 0 to 1 raw prints times in ms and s),
  so `plugin.js` reads them from the AU instead. The codes are in the set file's
  `AuPluginInfo` as integers. Live's `class_name` for an AU is `AuPluginDevice`.
- `Song.move_device` moves a device to another track, keeping the instance: a plug-in kept
  its parameters and state across moves. An effect after an instrument on a MIDI track
  can't take audio input there, so `audio.js` moves it to an audio track.
- While a track's input is silent, Live zeroes a plug-in's output in whole blocks once that
  output is quiet, and the plug-in's reported tail does not stop it. Seen 2026-11-01
  (Live 12.4.25b1, VST3, 44.1 kHz) with a plug-in fed bursts of noise: the recording drops
  to exact zero in runs of 12928 to 13184 samples (about 0.3 s), each starting on a
  512-sample boundary, while the input is silent between bursts and the plug-in's output is
  a decaying tail under 2e-6 (about -114 dBFS); an offline render matches everywhere else.
  The plug-in passes its output through unchanged, and reporting a tail (0.25 s tried)
  changed nothing. The rule Live applies is not known.

## Logs and settings

- Places are in `Library.cfg` in Live's preferences folder, one file per Live version. Two
  entries with one `Id` make Live reject the whole file as corrupt, and AbletonOSC then
  doesn't answer (2026-11-08). Live renumbers the `Id`s between launches, so an `Id` can't
  be kept. `add-place.js` makes the edit.
- Live logs every Max console message to `~/Library/Preferences/Ableton/Live <version>/Log.txt`
  (the version without a Beta's build, e.g. `Live 12.4.25b1`), appended to at each launch
  after an `info: Started: Live <version>` line, as
  `<local time, microseconds>: error: Message from Max:  <text>`. A gen~ codebox
  that fails to compile ("declarations must come before any expressions") leaves a device
  that loads, answers OSC and outputs silence, with the reason only there (found 2026-10-31).
- Live keeps its settings in `Preferences.cfg` in its preferences folder, a binary file
  `settings.js` reads (its layout is at the top of that file, worked out from Live
  12.2 to 12.4.25b1's files). Bit Depth is `SongPrefData.RecordBitDepth`: 1 is 24-bit
  and 2 is 32-bit float, matched with the takes Live recorded at each (2026-11-01); 0 for
  16-bit is inferred, not seen. Live writes the file when its Settings window closes, not
  when a setting changes: a sample rate changed with Settings open was in the file only
  once it closed (2026-11-05); `recordSignal` checks the takes' own headers in case it lags.
  The file holds the sample rate as `SongAgent.AudioInOut.AudioInOutData.SampleRate` (a
  float, in Hz), named `SelectedSampleRate` from the 12.4.15 betas on, outside the
  `PreferenceMembers` that `readSetting` finds.
- Live logs its sample rate to `Log.txt` (`info: Audio In Out: Sample Rate: 48000`) each
  time its audio engine starts: at launch, and within a second of a change in Settings,
  with Settings still open. Changes from 44100 to 48000 and back matched the output
  device's rate (2026-11-05); the remote Mac's 12.4.16 logs the same line. Live starts a new
  `Log.txt` from time to time (one 12.4.25b1 log began 2026-11-03); whether it does
  while running isn't known, and `sampleRate()` throws when the log has no such line.
