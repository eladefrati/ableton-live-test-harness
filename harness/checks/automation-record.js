#!/usr/bin/env node
"use strict";

// Checks recordArrangement's `automation` option on Auto Filter, with no track armed. A pass
// sets Frequency to 0.8 at beat 1 and to 0.3 at beat 3, and must leave it at 0.3; a second
// pass, with nothing set, reads Frequency at beat 2. Without the option Live writes no
// automation, so the second pass reads 0.3, the value last set; with it Live writes
// automation, and the second pass reads 0.8. Each is run with Automation Arm off and then on
// before it, on a new track each time, and must leave Automation Arm as it found it. At the
// end Automation Arm is put back as it was before the check, and the tracks, with their
// automation, are deleted. Needs Live's Count-In off. Exits 1 on failure.

const { connect } = require("../live.js");

const TRACK = "harness-automation";
const close = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-3;

async function main() {
  const live = await connect({ timeout: 3000 });
  const arm = await live.get("song", "session_automation_record");
  const tracks = [];
  let failed = false;
  const result = (pass, text) => {
    console.log(`${pass ? "PASS" : "FAIL"}: ${text}`);
    if (!pass) failed = true;
  };
  try {
    for (const armBefore of [0, 1]) {
      for (const automation of [false, true]) {
        const name = `${TRACK} ${armBefore} ${automation}`;
        tracks.push(name);
        const track = await live.createAudioTrack(name);
        const device = await live.loadDevice(track, "Audio Effects", "Auto Filter");
        const names = (await live.query("/live/device/get/parameters/name", track, device)).slice(2);
        const index = names.indexOf("Frequency");
        if (index < 0) throw new Error(`Auto Filter has no parameter named Frequency (it has ${names.join(", ")})`);
        const frequency = async () => (await live.query("/live/device/get/parameter/value", track, device, index))[3];
        const setTo = (value) => async () => { live.setParameter(track, device, index, value); await live.sync(); };
        const label = `Automation Arm ${armBefore}, automation ${automation}`;

        live.set("song", "session_automation_record", armBefore);
        await live.recordArrangement({
          start: 0, length: 4, tracks: [], automation,
          during: [{ beat: 1, action: setTo(0.8) }, { beat: 3, action: setTo(0.3) }],
        });
        const after = await live.get("song", "session_automation_record");
        const left = await frequency();
        result(Boolean(after) === Boolean(armBefore) && close(left, 0.3),
          `${label}: Automation Arm is ${after} after the recording, Frequency ${left} (expected ${armBefore}, 0.3)`);
        // Read back with Automation Arm off, so the read pass writes nothing.
        live.set("song", "session_automation_record", 0);
        let read;
        await live.recordArrangement({ start: 0, length: 3, tracks: [], during: [{ beat: 2, action: async () => { read = await frequency(); } }] });
        const expected = automation ? 0.8 : 0.3;
        result(close(read, expected), `${label}: Frequency plays back at ${read} at beat 2, expected ${expected}`);
      }
    }
  } finally {
    await live.deleteTracks(tracks).catch(() => {});
    live.set("song", "session_automation_record", arm ? 1 : 0);
    await live.sync();
    live.close();
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
