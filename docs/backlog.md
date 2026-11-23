# Backlog

The items here are open work, not scheduled. An item leaves this list when it is done or
dropped.

- **A runner for checks of audio.** `harness/device-checks.js` tests MIDI devices only. Each project
  whose output is audio or a control signal writes its own loop that loads the device, runs the
  cases, and prints `PASS` or `FAIL`. Projects that compare Live's recording with an offline render
  are the first users. Build it when a project needs one.
- **VST3 plug-ins.** `harness/plugin.js` handles Audio Unit effects only and refuses VST3, because
  reading a VST3 plug-in's parameter IDs needs a VST3 host.
- **The circular require between `harness/settings.js` and `harness/log.js`.** `harness/log.js` requires
  `harness/settings.js` for the preferences folder, so `sampleRate` in `harness/settings.js` requires
  `harness/log.js` inside the function. Move one side so both can require at the top.
- **A lock for `harness/remote.sh`.** Two runs at once can replace files under a running check. The
  slot rule in `harness/README.md` is the only guard.
- **`harness/checks/plugin-record.js` leaves the plug-in's track armed.** With `-EnableArmOnSelection` in
  Options.txt, `harness/doctor.js` reports no armed tracks before the check and track 0 armed after
  it. Which step arms it isn't known. The `restore()` that `signalTracks()` in `harness/audio.js` returns
  is the place to disarm what it leaves.
- **A check on a set with a group track.** No harness check runs on one, and the harness
  can't make one, so what `harness/doctor.js` and `recordArrangement()` read from a group track
  (`arm`, `playing_slot_index`) is untested. AbletonOSC answers nil for a property that doesn't apply, but that is
  proven only for `fold_state` on a MIDI track. Add a fixture set holding a group track, saved
  from Live as `harness/sets/empty.als` was, and a check that runs both on it.
- **A selection setter that checks.** `/live/view/set/selected_track` can leave the selection
  unchanged with no error (`harness/live-notes.md`), and `send` waits for nothing. Add a
  `selectTrack()` to `harness/live.js` that sets the track, reads `/live/view/get/selected_track` back and
  throws on a mismatch.
