"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const { Live, LiveError, playedNotes } = require("../live.js");
const { encode, decode } = require("../osc.js");

const PORT = 21000;
const REPLY_PORT = 21001;

// handlers: address -> (args) => array of replies, each [address, ...args]
async function withFake(handlers, fn) {
  const server = dgram.createSocket("udp4");
  server.on("message", (data) => {
    const { address, args } = decode(data);
    for (const [replyAddress, ...replyArgs] of (handlers[address] || (() => []))(args)) {
      server.send(encode(replyAddress, replyArgs), REPLY_PORT, "127.0.0.1");
    }
  });
  await new Promise((resolve) => server.bind(PORT, "127.0.0.1", resolve));
  const live = await new Live({ port: PORT, replyPort: REPLY_PORT, timeout: 300 }).open();
  try {
    await fn(live);
  } finally {
    live.close();
    server.close();
  }
}

test("query resolves with the reply's arguments", () => withFake({
  "/live/song/get/tempo": () => [["/live/song/get/tempo", 120]],
}, async (live) => {
  assert.deepEqual(await live.query("/live/song/get/tempo"), [120]);
  assert.equal(await live.get("song", "tempo"), 120);
}));

test("chunked replies are joined in chunk order", () => withFake({
  "/live/clip/get/notes": ([track, clip]) => [
    ["/live/clip/get/notes", track, clip, 1, 2, 62, 1, 0.5, 90, false],
    ["/live/clip/get/notes", track, clip, 0, 2, 60, 0, 0.5, 100, false],
  ],
}, async (live) => {
  assert.deepEqual(await live.notes(3, 0), [
    { pitch: 60, start: 0, duration: 0.5, velocity: 100, mute: false },
    { pitch: 62, start: 1, duration: 0.5, velocity: 90, mute: false },
  ]);
}));

test("an empty clip is one empty chunk", () => withFake({
  "/live/clip/get/notes": ([track, clip]) => [["/live/clip/get/notes", track, clip, 0, 1]],
}, async (live) => {
  assert.deepEqual(await live.notes(0, 0), []);
}));

test("/live/error fails the request in flight", () => withFake({
  "/live/clip/get/notes": () => [["/live/error", "Index out of range"]],
}, async (live) => {
  await assert.rejects(live.notes(9, 0), (error) => error instanceof LiveError && /Index out of range/.test(error.message));
}));

test("a missing reply times out, and later requests still run", () => withFake({
  "/live/test": () => [["/live/test", "ok"]],
}, async (live) => {
  await assert.rejects(live.query("/live/nothing"), /No reply to \/live\/nothing/);
  await live.sync();
}));

test("a datagram that isn't OSC is dropped, and requests still run", () => withFake({
  "/live/test": () => [["/live/test", "ok"]],
}, async (live) => {
  const sender = dgram.createSocket("udp4");
  await new Promise((resolve) => sender.send(Buffer.from([0xff, 0xff, 0xff]), REPLY_PORT, "127.0.0.1", resolve));
  sender.close();
  await live.sync();
}));

test("requests run one at a time, in order", () => withFake({
  "/live/song/get/tempo": () => [["/live/song/get/tempo", 120]],
  "/live/song/get/loop": () => [["/live/song/get/loop", 0]],
}, async (live) => {
  const results = await Promise.all([live.get("song", "tempo"), live.get("song", "loop"), live.get("song", "tempo")]);
  assert.deepEqual(results, [120, 0, 120]);
}));

test("songNotes places notes in song time and drops notes outside the clip", () => withFake({
  // one clip: start_time, end_time, start_marker, looping, loop_start, loop_end, is_midi_clip
  "/live/track/get/arrangement_clips/properties": ([track]) =>
    [["/live/track/get/arrangement_clips/properties", track, 8, 12, 1, false, 0, 4, true]],
  "/live/arrangement_clip/get/notes": ([t, c]) => [["/live/arrangement_clip/get/notes", t, c, 0, 1,
    60, 0, 1, 100, false, // before the start marker: outside the clip
    62, 1, 1, 100, false, // at the start marker: beat 8
    64, 4.5, 1, 100, false, // beat 11.5
    65, 5, 1, 100, false]], // beat 12: at the clip's end, outside
}, async (live) => {
  const notes = await live.songNotes(2);
  assert.deepEqual(notes.map((n) => [n.pitch, n.start]), [[62, 8], [64, 11.5]]);
}));

test("arrangementClips reads every clip of the track from one reply, and none from an empty one", () => withFake({
  "/live/track/get/arrangement_clips/properties": ([track]) => [["/live/track/get/arrangement_clips/properties", track,
    ...(track === 1 ? [0, 4, 0, false, 0, 4, true, 8, 16, 2, true, 2, 6, false] : [])]],
}, async (live) => {
  assert.deepEqual(await live.arrangementClips(1), [
    { index: 0, start_time: 0, end_time: 4, start_marker: 0, looping: false, loop_start: 0, loop_end: 4, is_midi_clip: true },
    { index: 1, start_time: 8, end_time: 16, start_marker: 2, looping: true, loop_start: 2, loop_end: 6, is_midi_clip: false },
  ]);
  assert.deepEqual(await live.arrangementClips(0), []);
}));

test("a looping clip plays from its start marker to the loop end, then repeats the loop", () => {
  const clip = { start_time: 10, end_time: 19, start_marker: 1, looping: true, loop_start: 0, loop_end: 4 };
  const notes = [0, 1, 3].map((start) => ({ pitch: 60, start, duration: 0.5, velocity: 100, mute: false }));
  // Clip time 1..4 plays at beats 10..13, then 0..4 at 13..17, then 0..2 at 17..19.
  assert.deepEqual(playedNotes(clip, notes).map((n) => n.start), [10, 12, 13, 14, 16, 17, 18]);
});

test("notes are cut at the loop end and at the clip's end", () => {
  const clip = { start_time: 0, end_time: 6, start_marker: 0, looping: true, loop_start: 0, loop_end: 4 };
  const notes = [{ pitch: 60, start: 3, duration: 2, velocity: 100, mute: false }];
  // Plays at beat 3, cut at the loop end (beat 4); the repeat would start at 7, past the end.
  assert.deepEqual(playedNotes(clip, notes).map((n) => [n.start, n.duration]), [[3, 1]]);
  const unlooped = { ...clip, looping: false, end_time: 4.5 };
  assert.deepEqual(playedNotes(unlooped, notes).map((n) => [n.start, n.duration]), [[3, 1.5]]);
});

test("an error from a message sent without waiting fails the next sync", () => withFake({
  "/live/song/set/tempo": () => [["/live/error", "Bad tempo"]],
  "/live/test": () => [["/live/test", "ok"]],
}, async (live) => {
  live.set("song", "tempo", -1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(live.sync(), /Bad tempo/);
  await live.sync();
}));

test("test-hook reports are collected and awaited by topic and device", async () => {
  const live = await new Live({ port: PORT, replyPort: REPLY_PORT, timeout: 300 }).open();
  await live.openHooks({ port: 21002 });
  const device = dgram.createSocket("udp4");
  const report = (topic, ...args) => device.send(encode(`/hook/${topic}`, args), 21002, "127.0.0.1");
  try {
    const status = live.waitForHook("status", { track: 4, device: 1 });
    report("status", 3, 0, "other device");
    report("status", 4, 1, "ready: 5 items");
    assert.deepEqual((await status).args, ["ready: 5 items"]);
    const check = live.waitForHook("check", { match: (h) => h.args[0] === 1 });
    report("check", 4, 1, 0, "failed");
    report("check", 4, 1, 1, "ok");
    assert.equal((await check).args[1], "ok");
    await assert.rejects(live.waitForHook("status", { track: 9 }), /No \/hook\/status report/);
  } finally {
    device.close();
    live.close();
  }
});

// A song that plays at 120 BPM from start_playing on, for recordArrangement. As measured in
// Live: Play starts from the start marker, which setting start_time or a cue point jump
// moves; Stop while stopped puts it back at 0; setting the song time while stopped leaves it.
function playingSong(song = { cues: [] }) {
  let startedAt = null;
  let marker = 0;
  let stoppedAt = 0;
  // song.fromZero: Live plays from 0 whatever the marker
  const now = () => (startedAt === null ? stoppedAt : (song.fromZero ? 0 : marker) + (Date.now() - startedAt) / 500);
  const cues = () => song.cues.flatMap((time, i) => [String(i + 1), time]);
  return {
    "/live/song/get/track_data": () => [["/live/song/get/track_data"]],
    "/live/song/get/tempo": () => [["/live/song/get/tempo", 120]],
    "/live/song/start_playing": () => { startedAt = Date.now(); return []; },
    "/live/song/stop_playing": () => {
      if (startedAt === null) marker = 0;
      else [stoppedAt, startedAt] = [now(), null];
      return [];
    },
    "/live/song/set/current_song_time": ([time]) => { if (startedAt === null) stoppedAt = time; return []; },
    "/live/song/get/current_song_time": () => [["/live/song/get/current_song_time", now()]],
    "/live/song/get/cue_points": () => [["/live/song/get/cue_points", ...cues()]],
    "/live/song/cue_point/add_or_delete": () => {
      // song.snap: an add lands on the nearest bar, as in some sets
      const time = song.snap ? Math.round(stoppedAt / 4) * 4 : stoppedAt;
      const at = song.cues.indexOf(time);
      if (at >= 0) song.cues.splice(at, 1);
      else song.cues = [...song.cues, time].sort((a, b) => a - b);
      return [];
    },
    "/live/song/cue_point/jump": ([index]) => { marker = stoppedAt = song.cues[index]; return []; },
    "/live/song/get/start_time": () => [["/live/song/get/start_time", marker]],
    "/live/song/set/start_time": ([time]) => { if (startedAt === null) marker = time; return []; },
    "/live/song/get/session_automation_record": () => [["/live/song/get/session_automation_record", song.automationArm ? 1 : 0]],
    "/live/song/set/session_automation_record": ([on]) => { song.automationArm = Boolean(on); return []; },
    "/live/test": () => [["/live/test", "ok"]],
  };
}

const withSessionClip = (numerator, denominator) => ({
  // one track: unarmed, its Session clip in slot 0 active
  "/live/song/get/track_data": () => [["/live/song/get/track_data", false, 0]],
  "/live/song/get/signature_numerator": () => [["/live/song/get/signature_numerator", numerator]],
  "/live/song/get/signature_denominator": () => [["/live/song/get/signature_denominator", denominator]],
});

test("recordArrangement refuses while a track the caller didn't arm is armed", () =>
  withFake({ ...playingSong(), "/live/song/get/track_data": () => [["/live/song/get/track_data", true, -1, true, -1]] }, async (live) => {
    await assert.rejects(live.recordArrangement({ start: 0, length: 1, tracks: [0] }), /Track 1 is armed and not part of this test/);
  }));

test("placeClip writes the notes to the first Session slot and duplicates the clip to beat 0", () => {
  const seen = [];
  const note = (address) => (args) => { seen.push([address, ...args]); return []; };
  return withFake({
    "/live/clip_slot/create_clip": note("/live/clip_slot/create_clip"),
    "/live/clip/add/notes": note("/live/clip/add/notes"),
    "/live/track/duplicate_clip_to_arrangement": ([track]) => [["/live/track/duplicate_clip_to_arrangement", track, 3]],
  }, async (live) => {
    const index = await live.placeClip(2, [{ pitch: 60, start: 0.5, duration: 0.25, velocity: 100 }, { pitch: 62, start: 1, duration: 0.5, velocity: 90, mute: true }], 4);
    assert.equal(index, 3);
    assert.deepEqual(seen, [
      ["/live/clip_slot/create_clip", 2, 0, 4],
      ["/live/clip/add/notes", 2, 0, 60, 0.5, 0.25, 100, false, 62, 1, 0.5, 90, true],
    ]);
  });
});

test("trackData groups one reply's values by track", () => withFake({
  "/live/song/get/track_data": (args) => [["/live/song/get/track_data", ...(args.join(" ") === "0 -1 track.name track.arm" ? ["a", false, "b", true] : [])]],
}, async (live) => {
  assert.deepEqual(await live.trackData("name", "arm"), [["a", false], ["b", true]]);
}));

test("recordArrangement refuses a start off the bar while a track has an active Session clip", () =>
  withFake({ ...playingSong(), ...withSessionClip(4, 4) }, async (live) => {
    await assert.rejects(live.recordArrangement({ start: 9.25, length: 0.25, tracks: [] }),
      /Track 0 has an active Session clip, so Live would start Play from the bar at beat 8, not 9\.25/);
  }));

test("recordArrangement finds the bar from the time signature", () =>
  withFake({ ...playingSong(), ...withSessionClip(7, 8) }, async (live) => {
    await assert.rejects(live.recordArrangement({ start: 9, length: 0.25, tracks: [] }), /from the bar at beat 7, not 9/);
    const [w] = await live.recordArrangement({ start: 10.5, length: 0.25, tracks: [], during: [{ beat: 0, action: async () => {} }] });
    assert.ok(w.before >= 10.5 && w.before < 10.6, JSON.stringify(w));
  }));

test("recordArrangement records from a bar line while a track has an active Session clip", () =>
  withFake({ ...playingSong(), ...withSessionClip(4, 4) }, async (live) => {
    const [w] = await live.recordArrangement({ start: 8, length: 0.25, tracks: [], during: [{ beat: 0, action: async () => {} }] });
    assert.ok(w.before >= 8 && w.before < 8.1, JSON.stringify(w));
  }));

test("recordArrangement stops and fails when Live starts before its start", () => {
  const song = { cues: [], fromZero: true };
  return withFake(playingSong(song), async (live) => {
    await assert.rejects(live.recordArrangement({ start: 2, length: 0.25, tracks: [] }), /Live started at beat 0\.\d+, not 2/);
    assert.deepEqual(song.cues, []);
  });
});

test("recordArrangement turns Automation Arm off while it records and back on after", () => {
  const song = { cues: [], automationArm: true };
  return withFake(playingSong(song), async (live) => {
    let during;
    await live.recordArrangement({ length: 0.25, tracks: [], during: [{ beat: 0, action: async () => { during = song.automationArm; } }] });
    assert.deepEqual([during, song.automationArm], [false, true]);
  });
});

test("recordArrangement starts a later recording at its start, leaving cue points alone", () => {
  // snap: a cue add would land on the bar, so an off-bar start through a cue would fail
  const song = { cues: [1], snap: true };
  return withFake(playingSong(song), async (live) => {
    const [first] = await live.recordArrangement({ start: 9.25, length: 0.25, tracks: [], during: [{ beat: 0, action: async () => {} }] });
    assert.ok(first.before >= 9.25 && first.before < 9.35, JSON.stringify(first));
    assert.deepEqual(song.cues, [1]);
    // and a start at 0 afterwards starts at 0, not where the marker was left
    const [again] = await live.recordArrangement({ start: 0, length: 0.25, tracks: [], during: [{ beat: 0, action: async () => {} }] });
    assert.ok(again.before < 0.1, JSON.stringify(again));
  });
});

test("recordArrangement takes `during` actions once the song passes their beats, with the time window", () =>
  withFake(playingSong(), async (live) => {
    const ran = [];
    const windows = await live.recordArrangement({ length: 1, tracks: [], during: [
      { beat: 0.5, action: async () => ran.push(0.5) },
      { beat: 0.25, action: async () => ran.push(0.25) },
    ] });
    assert.deepEqual(ran, [0.25, 0.5]);
    assert.deepEqual(windows.map((w) => w.beat), [0.5, 0.25]);
    for (const w of windows) {
      assert.ok(w.before >= w.beat && w.after >= w.before, JSON.stringify(w));
      // fine polling near the beat: well under the 50 ms poll (0.1 beat at 120 BPM); the
      // fake answers at once, where Live answers once per 100 ms tick
      assert.ok(w.before - w.beat < 0.05, JSON.stringify(w));
    }
  }));

test("recordArrangement fails when the recording ends before an action's beat", () =>
  withFake(playingSong(), async (live) => {
    await assert.rejects(live.recordArrangement({ length: 0.25, tracks: [], during: [{ beat: 2, action: async () => {} }] }),
      /Recording ended before beat 2/);
  }));

test("findDevice finds the one device with the name on any track, else refuses", () => withFake({
  "/live/song/get/num_tracks": () => [["/live/song/get/num_tracks", 2]],
  "/live/track/get/devices/name": ([track]) => [["/live/track/get/devices/name", track,
    ...(track === 0 ? ["Pitch", "Upright Piano", "Plugin"] : ["Plugin Two", "Utility"])]],
}, async (live) => {
  assert.deepEqual(await live.findDevice("Plugin"), { track: 0, device: 2 });
  await assert.rejects(live.findDevice("Utility2"), /Found 0 devices named Utility2; expected one/);
}));

function loadingDevice(className, counts) {
  let reads = 0;
  return {
    "/live/browser/load": ([track]) => [["/live/browser/load", track, 0]],
    "/live/device/get/class_name": ([track, device]) => [["/live/device/get/class_name", track, device, className]],
    "/live/device/get/num_parameters": ([track, device]) =>
      [["/live/device/get/num_parameters", track, device, counts[Math.min(reads++, counts.length - 1)]]],
  };
}

test("loadDevice settles a plug-in listing only Device On once the count has held", () =>
  withFake(loadingDevice("AuPluginDevice", [1]), async (live) => {
    assert.equal(await live.loadDevice(0, "Plug-Ins", "Other Plugin", { pluginHoldMs: 300, readyMs: 0 }), 0);
  }));

test("loadDevice waits past Device On for a Max for Live device's parameters", async () => {
  await withFake(loadingDevice("MxDeviceMidiEffect", [1]), async (live) => {
    await assert.rejects(live.loadDevice(0, "*", "Device", { settleMs: 1000, readyMs: 0 }),
      /The parameters of Device did not settle within 1000 ms/);
  });
  await withFake(loadingDevice("MxDeviceMidiEffect", [1, 1, 1, 5]), async (live) => {
    assert.equal(await live.loadDevice(0, "*", "Device", { readyMs: 0 }), 0);
  });
});

test("findDevice refuses a name on two tracks, naming both", () => withFake({
  "/live/song/get/num_tracks": () => [["/live/song/get/num_tracks", 2]],
  "/live/track/get/devices/name": ([track]) => [["/live/track/get/devices/name", track, "Plugin"]],
}, async (live) => {
  await assert.rejects(live.findDevice("Plugin"), /Found 2 devices named Plugin \(track 0 device 0, track 1 device 0\)/);
}));

test("setParameters sets by name, a string by its menu item, and refuses unknown names and items", () => {
  const sent = [];
  return withFake({
    "/live/device/get/parameters/name": ([track, device]) => [["/live/device/get/parameters/name", track, device,
      "Device On", "Float", "Menu"]],
    "/live/device/get/parameter/value_items": ([track, device, index]) => [["/live/device/get/parameter/value_items",
      track, device, index, ...(index === 2 ? ["A", "B", "C"] : [])]],
    "/live/device/set/parameter/value": (args) => { sent.push(args); return []; },
    "/live/test": () => [["/live/test", "ok"]],
  }, async (live) => {
    await live.setParameters(0, 7, { Float: 0.25, Menu: "C" });
    assert.deepEqual(sent, [[0, 7, 1, 0.25], [0, 7, 2, 2]]);
    await assert.rejects(live.setParameters(0, 7, { Missing: 1 }), /has no parameter Missing/);
    await assert.rejects(live.setParameters(0, 7, { Menu: "D" }), /has no item D \(items: A, B, C\)/);
  });
});
