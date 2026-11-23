# Writing checks

`harness/checks/example-device-check.js` is a template to copy for anything that isn't a Max
for Live device, on a stock Live device.

`harness/checks/example-transpose-check.js` is a check on `harness/device-checks.js` (the runner) to copy,
on an example device in the repo.

For a check that saves and reopens the set, start from `harness/checks/save-reopen.js`. It
replaces the open set with a copy in a temp folder, so later
runs work in that copy.

For a Max for Live MIDI device, write the checks on `harness/device-checks.js`.
It checks that Live sees the newest build in the project's builds
folder in exactly one Places folder, and says what to fix if not. It loads the build onto a
new track with Live's default-template devices removed, writes a known clip, records the
device's Post FX output on a second track, and compares. Each case sets device parameters
and says what it expects. The comment above `run()` in that file describes the case shape, the
options, and what a case gets. A case's `settings` use long names only when the project passes
`longNames`, and Live's short names otherwise. Note durations aren't compared unless the check
passes `compare: {durationToleranceMs}`. Set it when lengths matter.

By default the runner loads the highest `<device> YYYY.MM.DD.N.amxd`. For another naming,
pass `build`, either a file name in `builds` or a function of the folder that returns one.

A check that needs a record bit depth or a sample rate says so in its README and requires it
before recording. For the bit depth, see "Record bit depth" in `harness/README.md`. For the
sample rate, use `requireSampleRate(rate)` from `settings.js`.

Take expected notes from the project's own code, such as an engine render or a sandbox that
runs the built script. Write them by hand only for a case as plain as "plays the clip as
written".

## Measure a plug-in's points

1. Run `node harness/cli.js plugin-window <track> <device> [<png>]`. It prints the editor's
   size (`editor: {w, h}`, the `size` to give) and saves a picture of the editor.
2. Take each control's centre from the plug-in's own layout code, whose coordinates are these
   points when the editor isn't scaled, or from the picture. The picture's pixels are points
   times the display's scale, which is the picture's width in pixels divided by `editor.w`.
3. Press each control once, and check that the parameter Live reads is the one meant, as a
   check does.
