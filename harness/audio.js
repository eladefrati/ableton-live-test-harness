"use strict";

// Measuring an audio effect's output: a known signal into the effect, its Post FX output
// recorded into the Arrangement, the recorded files read back as float arrays.
//
// The LOM can't place an audio file in a clip, so the signal comes from a MIDI track with a
// stock instrument (Operator by default) playing a clip of notes. The effect is moved onto
// an audio track of its own that takes that signal as input, so it hears the signal only,
// whatever track it sat on (an effect after an instrument can't take audio input in place).

const fs = require("node:fs");
const { float } = require("./osc.js");
const { readWav } = require("./wav.js");
const { requireRecordBitDepth, describeDepth } = require("./settings.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NAMES = { source: "harness-signal", plugin: "harness-plugin", dry: "harness-dry", wet: "harness-wet" };
const MONITOR_IN = 0; // Track.current_monitoring_state: 0 In, 1 Auto, 2 Off

// Sets up, at the end of the set:
//   harness-signal  MIDI track, `instrument` playing `notes` in the Arrangement from beat 0
//   harness-plugin  audio track, input harness-signal Post FX, monitoring In, holding the
//                   device moved from (track, device) to its first position
//   harness-dry     audio track recording harness-signal Post FX
//   harness-wet     audio track recording harness-plugin Post FX
// Resolves with their indices, the device's index on harness-plugin, and restore(), which
// moves the device back to (track, device) and deletes the four tracks. Call restore in a
// `finally`. notes: [{pitch, start, duration, velocity}] in beats, within `beats`.
// bitDepth: the bit depth the check needs Live to record at (32 for float, which doesn't
// clip above 1.0 or quantize); it refuses before adding tracks if Live is set otherwise,
// and recordSignal then checks the recorded files.
async function signalTracks(live, { track, device, notes, beats, instrument = ["Instruments", "Operator"], bitDepth }) {
  if (bitDepth !== undefined) await requireRecordBitDepth(bitDepth);
  const first = await live.get("song", "num_tracks");
  let moved = null;
  const restore = async () => {
    if (moved !== null) await live.moveDevice(pluginTrack, moved, track, device);
    moved = null;
    await live.deleteTracks(Object.values(NAMES), first);
  };
  let pluginTrack;
  try {
    const source = await live.createMidiTrack(NAMES.source);
    await live.loadDevice(source, instrument[0], instrument[1]);
    // With Options.txt's -EnableArmOnSelection, loading the instrument armed its track, and
    // recordArrangement then refuses (measured 2026-10-31; live-notes.md).
    live.set("track", "arm", source, 0);
    live.send("/live/clip_slot/create_clip", source, 0, float(beats));
    live.send("/live/clip/add/notes", source, 0,
      ...notes.flatMap((n) => [n.pitch, float(n.start), float(n.duration), n.velocity, false]));
    await live.query("/live/track/duplicate_clip_to_arrangement", source, 0, float(0));
    // The Session clip is deleted; the Arrangement copy plays.
    live.send("/live/clip_slot/delete_clip", source, 0);

    pluginTrack = await live.createAudioTrack(NAMES.plugin);
    await live.setInputRouting(pluginTrack, NAMES.source, "Post FX");
    live.set("track", "current_monitoring_state", pluginTrack, MONITOR_IN);
    moved = await live.moveDevice(track, device, pluginTrack, 0);

    const dry = await live.createAudioTrack(NAMES.dry);
    await live.setInputRouting(dry, NAMES.source, "Post FX");
    const wet = await live.createAudioTrack(NAMES.wet);
    await live.setInputRouting(wet, NAMES.plugin, "Post FX");
    await live.sync();
    return { source, pluginTrack, device: moved, dry, wet, restore, bitDepth };
  } catch (error) {
    await restore().catch(() => {});
    throw error;
  }
}

// Waits until `file` exists and its size has stopped changing: Live finishes writing a
// recording after the transport stops.
async function settledFile(file, { timeoutMs = 10000, stableMs = 300 } = {}) {
  let last = -1;
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(stableMs)) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return file;
    last = size;
  }
  throw new Error(`${file} was not written within ${timeoutMs} ms`);
}

async function recordedSamples(live, track) {
  const files = await live.arrangementAudioFiles(track);
  if (files.length === 0) throw new Error(`Track ${track} has no recorded audio clip`);
  const { file } = files[files.length - 1];
  const { sampleRate, bits, float, channels } = readWav(await settledFile(file));
  return { file, sampleRate, bits, float, channels };
}

// Records harness-dry and harness-wet from `start` for `length` beats (recordArrangement:
// `during` actions apply) and reads both takes. Resolves with { dry, wet } (one
// Float32Array per channel), sampleRate, files and the `during` windows. Both takes start
// at the same moment, so sample i of one lines up with sample i of the other.
async function recordSignal(live, rig, { start = 0, length, during = [] }) {
  // A take recorded over an earlier one would leave two clips to tell apart.
  await live.deleteArrangementClips(rig.dry);
  await live.deleteArrangementClips(rig.wet);
  live.set("track", "arm", rig.dry, 1);
  live.set("track", "arm", rig.wet, 1);
  let windows;
  try {
    windows = await live.recordArrangement({ start, length, tracks: [rig.dry, rig.wet], during });
  } finally {
    live.set("track", "arm", rig.dry, 0);
    live.set("track", "arm", rig.wet, 0);
    await live.sync();
  }
  const dry = await recordedSamples(live, rig.dry);
  const wet = await recordedSamples(live, rig.wet);
  for (const take of rig.bitDepth === undefined ? [] : [dry, wet]) {
    if (take.bits !== rig.bitDepth || take.float !== (rig.bitDepth === 32)) {
      throw new Error(`${take.file} is ${describeDepth(take)}, although Preferences.cfg says Live records `
        + `at the ${rig.bitDepth}-bit the check needs: Live may not have saved the setting yet`);
    }
  }
  if (dry.sampleRate !== wet.sampleRate) throw new Error(`Takes at ${dry.sampleRate} and ${wet.sampleRate} Hz`);
  return { dry: dry.channels, wet: wet.channels, sampleRate: dry.sampleRate, files: [dry.file, wet.file], windows };
}

module.exports = { signalTracks, recordSignal, recordedSamples, settledFile, NAMES };
