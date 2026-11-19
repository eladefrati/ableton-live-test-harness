#!/usr/bin/env node
"use strict";

// Checks the harness's own recording path: places a clip of off-grid notes in the
// Arrangement on one new track, records its MIDI output into a second new track, and
// compares the recording with the clip. The clip's notes include MIDI's lowest and highest
// pitches, which a note query must not leave out. Both tracks are deleted afterwards. Needs
// Live's Count-In off. Exits 1 on a failed comparison.

const { connect } = require("../live.js");
const { compareNotes, summary } = require("../compare.js");

const SOURCE = "harness-source";
const RECORD = "harness-record";
const BEATS = 16;

function testNotes() {
  const notes = [];
  for (let i = 0; i < 24; i++) {
    // Off-grid starts (up to 26 ms off a 0.6-beat grid at 120 BPM) and varied velocities.
    notes.push({ pitch: 60 + (i * 7) % 24, start: i * 0.6 + 0.013 * (i % 5), duration: 0.3, velocity: 90 + i });
  }
  notes.push({ pitch: 0, start: 14.5, duration: 0.3, velocity: 100 }, { pitch: 127, start: 15, duration: 0.3, velocity: 100 });
  return notes;
}

async function main() {
  const live = await connect({ timeout: 5000 });
  let first;
  try {
    first = await live.get("song", "num_tracks");
    const source = await live.createMidiTrack(SOURCE);
    const record = await live.createMidiTrack(RECORD);
    await live.setInputRouting(record, SOURCE);
    const placed = testNotes();
    await live.placeClip(source, placed, BEATS);
    live.set("track", "arm", record, 1);
    await live.recordArrangement({ start: 0, length: BEATS, tracks: [record] });
    live.set("track", "arm", record, 0);
    const sourceNotes = await live.songNotes(source);
    if (sourceNotes.length !== placed.length) {
      console.log(`FAIL: the clip's notes read back ${sourceNotes.length} of the ${placed.length} placed`);
      process.exitCode = 1;
    }
    const result = compareNotes(sourceNotes, await live.songNotes(record),
      { tempo: await live.get("song", "tempo"), durationToleranceMs: 1 });
    console.log(summary(result));
    if (!result.pass || result.matched === 0) process.exitCode = 1;
  } finally {
    // An error in cleanup must not keep the sockets open: Node would never exit.
    try {
      if (first !== undefined) await live.deleteTracks([SOURCE, RECORD], first);
    } finally {
      live.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
