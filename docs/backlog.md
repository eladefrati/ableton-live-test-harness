# Backlog

Open work, not scheduled. An item leaves this list when it is done or dropped.

- **A runner for checks of audio.** `device-checks.js` tests MIDI devices only, so each project
  whose output is audio or a control signal writes its own loop of loading the device, running
  cases and printing PASS/FAIL. Projects that compare Live's recording with an offline render
  are the first users. Build it when a project needs one.
- **VST3 plug-ins.** `plugin.js` handles Audio Unit effects only and refuses VST3, because
  reading a VST3 plug-in's parameter IDs needs a VST3 host.
- **The circular require between `settings.js` and `log.js`.** `log.js` requires
  `settings.js` for the preferences folder, so `sampleRate` in `settings.js` requires
  `log.js` inside the function. Move one side so both can require at the top.
- **A lock for `remote.sh`.** Two runs at once can replace files under a running check; the
  slot rule in `harness/README.md` is the only guard.
- **`plugin-record.js` leaves the plug-in's track armed.** With `-EnableArmOnSelection` in
  Options.txt, `doctor.js` reports no armed tracks before the check and track 0 armed after
  it (Live 12.4.25b1, 2026-11-11, 3 of 3 runs). Which step arms it isn't known; `restore()`
  in `audio.js` is the place to disarm what it leaves.
- **A check on a set with a group track.** No harness check runs on one, and the harness
  can't make one, so what `doctor.js` and `recordArrangement()` read from a group track
  (`arm`, `playing_slot_index`) is untested; a property that doesn't apply reads nil, proven
  only with `fold_state` on a MIDI track. Add a fixture set holding a group track, saved
  from Live as `sets/empty.als` was, and a check that runs both on it.
- **A selection setter that checks.** `/live/view/set/selected_track` can leave the selection
  unchanged with no error (`harness/live-notes.md`), and `send` waits for nothing. Add a
  `selectTrack()` to `live.js` that sets the track, reads `get/selected_track` back and
  throws on a mismatch.
