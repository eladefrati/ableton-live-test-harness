#!/usr/bin/env node
"use strict";

// Checks the path for measuring an audio-effect plug-in, on Apple's AUDelay (installed on
// every Mac, no state of its own): makes all of its parameters reachable (plugin.js, which
// replaces the open set with one holding only the plug-in), and moves it onto a new audio
// track fed by a new MIDI track playing Operator. It records the signal and the plug-in's
// Post FX output side by side, reads both files and checks that with Dry/Wet Mix 0 the
// output equals the signal, and that with Mix 1 (the delayed signal alone) and Feedback 0
// it trails the signal by the Delay Time set, at two settings. A trail of the time set
// shows the output track records the plug-in and that both floats reach it; a float
// written into the wrong slot reads back in Live but may never reach the plug-in. AUDelay
// has no enum parameters, so the enum slots are not checked here. The plug-in goes back to
// its own track and place, and the new tracks are deleted (--keep leaves them, with the
// plug-in on its test track). Needs Count-In off. Exits 1 on failure.
//
//   node harness/checks/plugin-record.js [--keep]

const { connect } = require("../live.js");
const { exposePluginParameters } = require("../plugin.js");
const { signalTracks, recordSignal } = require("../audio.js");

const DEVICE = "AUDelay";
const BEATS = 8;

// One short A4 per beat, then a held one: onsets to align by, and a steady tone.
const NOTES = [0, 1, 2, 3].map((beat) => ({ pitch: 69, start: beat, duration: 0.25, velocity: 100 }))
  .concat([{ pitch: 69, start: 4, duration: 3, velocity: 100 }]);

// AUDelay's ranges (auval -v aufx dely appl). Over the LOM a plug-in float is normalized
// 0..1 across its range (harness/live-notes.md).
const DELAY = { min: 0.0001, max: 2 };
const delaySeconds = (normalized) => DELAY.min + normalized * (DELAY.max - DELAY.min);
const FEEDBACK_ZERO = 0.5; // -99.9..99.9 %
const LAG_TOLERANCE = 0.005; // seconds

const rms = (x) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / Math.max(1, x.length));
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const onset = (x) => x.findIndex((v) => Math.abs(v) > 0.01);

async function main() {
  const keep = process.argv.slice(2).includes("--keep");
  const live = await connect({ timeout: 5000 });
  let rig;
  try {
    const plugin = await exposePluginParameters(live, DEVICE);
    console.log(`${DEVICE}: ${plugin.parameters.length} parameters reachable; set now ${plugin.file}`);
    rig = await signalTracks(live, { track: plugin.track, device: plugin.device, notes: NOTES, beats: BEATS });
    const report = (pass, text) => {
      console.log(`${pass ? "PASS" : "FAIL"}: ${text}`);
      if (!pass) process.exitCode = 1;
    };

    await live.setParameters(rig.pluginTrack, rig.device, { "Dry/Wet Mix": 0, Feedback: FEEDBACK_ZERO });
    const dry = await recordSignal(live, rig, { start: 0, length: BEATS });
    const n = Math.min(dry.dry[0].length, dry.wet[0].length);
    const diff = new Float32Array(n);
    for (let i = 0; i < n; i++) diff[i] = dry.wet[0][i] - dry.dry[0][i];
    const level = rms(dry.dry[0].subarray(0, n));
    report(level > 0.01, `signal ${db(level).toFixed(1)} dBFS over ${(n / dry.sampleRate).toFixed(2)} s at `
      + `${dry.sampleRate} Hz, read from ${dry.files[0]}`);
    const off = db(rms(diff)) - db(level);
    report(off < -60, `Dry/Wet Mix 0: output minus signal is ${off.toFixed(1)} dB relative to the signal`);

    for (const normalized of [0.05, 0.25]) {
      await live.setParameters(rig.pluginTrack, rig.device, { "Dry/Wet Mix": 1, "Delay Time": normalized });
      const take = await recordSignal(live, rig, { start: 0, length: BEATS });
      const lag = (onset(take.wet[0]) - onset(take.dry[0])) / take.sampleRate;
      const want = delaySeconds(normalized);
      report(Math.abs(lag - want) <= LAG_TOLERANCE, `Dry/Wet Mix 1, Delay Time ${normalized}: the output trails `
        + `the signal by ${(lag * 1000).toFixed(1)} ms, expected ${(want * 1000).toFixed(1)} ms`);
    }
  } finally {
    // An error in cleanup must not keep the sockets open: Node would never exit.
    try {
      if (rig && !keep) await rig.restore();
    } finally {
      live.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
