#!/usr/bin/env node
"use strict";

// Checks the harness's MIDI input (midi.js, ADR-0018) and its map modes on Auto Filter. It
// opens the Harness port, MIDI-maps Frequency to a CC in MIDI Map Mode (a press through
// device-ui.js and a CC), and checks that CCs then move Frequency to its ends and between;
// then maps Resonance to a key in Key Map Mode and checks that pressing the key toggles it.
// Needs Remote on for the Harness input in Live's Settings > Link, Tempo & MIDI (open the port
// with `cli.js midi-port` to set it), and what device-ui.js needs (README, "What Live needs");
// run it on the click host. Brings Live to the front for the key. The track and its mappings
// are deleted afterwards. Exits 1 on failure.

const { connect } = require("../live.js");
const mac = require("../macos.js");
const { openDeviceUi } = require("../device-ui.js");
const { openMidiPort } = require("../midi.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRACK = "harness-midi-map";
const CC = 20;
const KEY = "k";
// Live takes a CC or a key and shows the parameter's new value within this time (measured
// well under it on an Intel Mac).
const SETTLE_MS = 600;

async function main() {
  const live = await connect({ timeout: 3000 });
  let port;
  let failed = false;
  const result = (pass, text) => {
    console.log(`${pass ? "PASS" : "FAIL"}: ${text}`);
    if (!pass) failed = true;
  };
  try {
    const track = await live.createAudioTrack(TRACK);
    const device = await live.loadDevice(track, "Audio Effects", "Auto Filter");
    const names = (await live.query("/live/device/get/parameters/name", track, device)).slice(2);
    const value = async (name) => (await live.query("/live/device/get/parameters/value", track, device)).slice(2)[names.indexOf(name)];
    port = await openMidiPort();
    const ui = await openDeviceUi(live, { track, device });

    await mac.setMidiMapMode(true);
    await ui.press("Frequency");
    await port.cc(1, CC, 64);
    await sleep(SETTLE_MS);
    await mac.setMidiMapMode(false);
    for (const [cc, expected] of [[0, 0], [127, 1], [30, 30 / 127]]) {
      await port.cc(1, CC, cc);
      await sleep(SETTLE_MS);
      const got = await value("Frequency");
      result(Math.abs(got - expected) < 1e-6, `CC ${CC} at ${cc} sets Frequency to ${got}, expected ${expected.toFixed(6)}`);
    }

    await mac.setKeyMapMode(true);
    await ui.press("Resonance");
    await mac.typeInLive(`keystroke "${KEY}"`);
    await sleep(SETTLE_MS);
    await mac.setKeyMapMode(false);
    for (let i = 0; i < 2; i++) {
      const before = await value("Resonance");
      await mac.typeInLive(`keystroke "${KEY}"`);
      await sleep(SETTLE_MS);
      const after = await value("Resonance");
      result(after === 1 - before && (before === 0 || before === 1), `key ${KEY} toggles Resonance from ${before} to ${after}`);
    }
  } finally {
    await mac.setMidiMapMode(false).catch(() => {});
    await mac.setKeyMapMode(false).catch(() => {});
    if (port) await port.close();
    await live.deleteTracks([TRACK]).catch(() => {});
    live.close();
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
