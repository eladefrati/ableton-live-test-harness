# Writing checks

`harness/checks/example-device-check.js` is a template to copy for anything that isn't a Max
for Live device, on a stock Live device.

`harness/checks/save-reopen.js` replaces the open set with a copy in a temp folder, so later
runs work in that copy.

For a MIDI device, write the checks on `harness/device-checks.js`.
It checks that Live sees the newest build in the project's builds
folder in exactly one Places folder, and says what to fix if not. It loads the build onto a
new track with Live's default-template devices removed, writes a known clip, records the
device's Post FX output on a second track, and compares. Each case sets device parameters
and says what it expects. The top of `run()` in that file describes the case shape, the
options and what a case gets. Settings use long names only when the project passes
`longNames`, and Live's short names otherwise. Note durations aren't compared unless the check
passes `compare: {durationToleranceMs}`; set it when lengths matter.

`harness/checks/example-transpose-check.js` is a check on the runner to copy, on an example
device in the repo.

By default the runner loads the highest `<device> YYYY.MM.DD.N.amxd`. For another naming,
pass `build`, either a file name in `builds` or a function of the folder that returns one.

A check that needs a record bit depth or a sample rate says so in its README and requires it
before recording. For the bit depth, see "Record bit depth" in `harness/README.md`; for the
sample rate, use `requireSampleRate(rate)` from `settings.js`.

Expected notes should come from the project's own code (an engine render or a sandbox
running the built script), not be written out by hand, except for cases as plain as "plays
the clip as written".
