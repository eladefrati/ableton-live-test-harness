#!/usr/bin/env node
"use strict";

// A template for a project's check, runnable as it stands: it loads Live's stock Pitch
// device onto a new track, places a known clip in the Arrangement there, and for each case
// sets the device, records its output (Post FX) on a second new track and compares that
// with what the case expects. Both tracks are deleted afterwards. Exits 1 if any case fails.
//
// To use it, copy it to a project's tests/live/ and replace the device and the cases. A Max
// for Live device is simpler on device-checks.js, which takes only the cases; see
// skills/verify-ableton/writing-checks.md.

const path = require("node:path");

// In a project's tests/live/, fall back to the clone's harness folder instead of this one.
const HARNESS = process.env.LIVE_HARNESS || path.resolve(__dirname, "..");
const { connect } = require(path.join(HARNESS, "live.js"));
const { compareNotes, summary } = require(path.join(HARNESS, "compare.js"));
const { clipNotes } = require(path.join(HARNESS, "device-checks.js"));

const DEVICE_TRACK = "example-under-test";
const RECORD_TRACK = "example-record";
const BEATS = 16;

const NOTES = clipNotes();

const CASES = [
  { name: "passes the clip through at 0", pitch: 0, expect: NOTES },
  { name: "transposes up an octave", pitch: 12, expect: NOTES.map((n) => ({ ...n, pitch: n.pitch + 12 })) },
];

async function main() {
  const live = await connect({ timeout: 5000 });
  let first;
  try {
    first = await live.get("song", "num_tracks");
    const deviceTrack = await live.createMidiTrack(DEVICE_TRACK);
    const recordTrack = await live.createMidiTrack(RECORD_TRACK);
    const device = await live.loadDevice(deviceTrack, "MIDI Effects", "Pitch");
    const parameters = await live.parameterIndices(deviceTrack, device);

    await live.placeClip(deviceTrack, NOTES, BEATS);
    await live.setInputRouting(recordTrack, DEVICE_TRACK, "Post FX");
    const tempo = await live.get("song", "tempo");

    for (const testCase of CASES) {
      live.setParameter(deviceTrack, device, parameters.get("Pitch"), testCase.pitch);
      live.set("track", "arm", recordTrack, 1);
      await live.sync();
      await live.recordArrangement({ start: 0, length: BEATS, tracks: [recordTrack] });
      live.set("track", "arm", recordTrack, 0);
      const result = compareNotes(testCase.expect, await live.songNotes(recordTrack), { tempo, from: 0, to: BEATS });
      console.log(`${testCase.name}: ${summary(result)}`);
      if (!result.pass) {
        process.exitCode = 1;
        console.log(JSON.stringify({ missing: result.missing, extra: result.extra }));
      }
      await live.deleteArrangementClips(recordTrack);
    }
  } finally {
    // An error in cleanup must not keep the sockets open: Node would never exit.
    try {
      // deleteTracks goes from the last track, so the recording goes before its source: a
      // track whose MIDI source is gone can't be disarmed.
      if (first !== undefined) await live.deleteTracks([DEVICE_TRACK, RECORD_TRACK], first);
    } finally {
      live.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
