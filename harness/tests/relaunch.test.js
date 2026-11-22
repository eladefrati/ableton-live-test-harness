"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { answerFor, tempProjectsSince, crashPrefix, parseArgs, warmUp, SUITE, installedLives, readApp, chooseLive } = require("../relaunch.js");
const { Live } = require("../live.js");
const { encode, decode } = require("../osc.js");

test("warmUp creates and deletes an audio and a MIDI track, waiting past the client's timeout", async () => {
  // A fake AbletonOSC whose first track creation holds it for 500 ms, as Live does when the
  // default track loads plug-ins, against a client that gives up after 200 ms.
  const PORT = 21010;
  const REPLY_PORT = 21011;
  const seen = [];
  let tracks = 1;
  let busyUntil = 0;
  const server = dgram.createSocket("udp4");
  server.on("message", (data) => {
    const { address, args } = decode(data);
    seen.push([address, ...args]);
    if (address === "/live/song/create_audio_track" || address === "/live/song/create_midi_track") {
      if (tracks === 1 && busyUntil === 0) busyUntil = Date.now() + 500;
      tracks++;
    }
    if (address === "/live/song/delete_track") tracks--;
    const reply = address === "/live/song/get/num_tracks" ? [address, tracks] : address === "/live/test" ? [address, "ok"] : null;
    if (reply) setTimeout(() => server.send(encode(reply[0], reply.slice(1)), REPLY_PORT, "127.0.0.1"), Math.max(0, busyUntil - Date.now()));
  });
  await new Promise((resolve) => server.bind(PORT, "127.0.0.1", resolve));
  const live = await new Live({ port: PORT, replyPort: REPLY_PORT, timeout: 200 }).open();
  try {
    await warmUp(live, 2000);
  } finally {
    live.close();
    server.close();
  }
  assert.deepEqual(seen, [
    ["/live/song/create_audio_track", -1],
    ["/live/song/get/num_tracks"],
    ["/live/song/delete_track", 1],
    ["/live/song/create_midi_track", -1],
    ["/live/song/get/num_tracks"],
    ["/live/song/delete_track", 1],
    ["/live/test"],
  ]);
  assert.equal(tracks, 1);
});

test("answerFor discards changes and deletes temp recordings, and knows no other dialog", () => {
  // Messages as Live 12.4.25b1 showed them on quitting.
  assert.equal(answerFor('Save changes to "Untitled" before closing?'), 0);
  assert.equal(answerFor("Would you like to delete the temporary files in "
    + "/Users/someone/Music/Ableton/Live Recordings/2026-11-01 220000 Temp Project?"), 2);
  assert.equal(answerFor("This action will stop audio. Proceed?"), null);
  assert.equal(answerFor(""), null);
});

test("tempProjectsSince keeps the Temp Projects named at or after the start's second", () => {
  const names = [
    "2026-11-01 221000 Temp Project",
    "2026-11-01 222000 Temp Project",
    "2026-11-01 223000 Temp Project",
    "2026-11-01 224000 My Set Project",
    ".DS_Store",
  ];
  const started = new Date(2026, 10, 1, 22, 15, 1, 500).getTime();
  assert.deepEqual(tempProjectsSince(names, started), ["2026-11-01 222000 Temp Project", "2026-11-01 223000 Temp Project"]);
  assert.deepEqual(tempProjectsSince(names, new Date(2026, 10, 1, 22, 10, 0).getTime()).length, 3);
});

test("crashPrefix names a time as Live's Crash folder does", () => {
  assert.equal(crashPrefix(new Date(2026, 10, 1, 9, 5, 7)), "2026_11_01__09_05_07_");
});

test("parseArgs reads --kill, --suite, --app <path> and --plugin <name>, and refuses anything else", () => {
  assert.deepEqual(parseArgs([]), { kill: false, suite: false, plugin: null, app: null });
  assert.equal(parseArgs(["--app", "/Applications/Live.app"]).app, "/Applications/Live.app");
  assert.throws(() => parseArgs(["--app"]), /needs the path/);
  assert.deepEqual(parseArgs(["--kill", "--plugin", "Other Plugin", "--suite"]), { kill: true, suite: true, plugin: "Other Plugin", app: null });
  assert.throws(() => parseArgs(["--plugin"]), /needs the plug-in's name/);
  assert.throws(() => parseArgs(["--plugin", "--kill"]), /needs the plug-in's name/);
  assert.throws(() => parseArgs(["--plugin=Plugin"]), /Unknown option --plugin=Plugin/);
  assert.throws(() => parseArgs(["--plugins", "Plugin"]), /Unknown option --plugins/);
  assert.throws(() => parseArgs(["--suite", "--app", "/Applications/Live.app"]), /pass one/);
});

test("chooseLive takes --app, then --suite, then local.json's app, then the running Live, then the only one installed", () => {
  const installed = ["/Applications/Ableton Live 12 Standard.app", "/Applications/Ableton Live 12 Suite.app"];
  const all = { local: "/Apps/Local.app", running: "/Apps/Running.app", installed };
  assert.equal(chooseLive({ app: "/Apps/Given.app", suite: false }, all), "/Apps/Given.app");
  assert.equal(chooseLive({ app: null, suite: true }, all), SUITE);
  assert.equal(chooseLive({}, all), "/Apps/Local.app");
  assert.equal(chooseLive({}, { ...all, local: null }), "/Apps/Running.app");
  assert.equal(chooseLive({}, { local: null, running: null, installed: [installed[0]] }), installed[0]);
});

test("chooseLive refuses to guess between Lives, or with none installed, and says how to name one", () => {
  const installed = ["/Applications/Ableton Live 12 Standard.app", "/Applications/Ableton Live 12 Suite.app"];
  assert.throws(() => chooseLive({}, { local: null, running: null, installed }),
    /2 are installed \(Ableton Live 12 Standard, Ableton Live 12 Suite\): set "app" in harness\/local.json/);
  assert.throws(() => chooseLive({}, { local: null, running: null, installed: [] }), /none is installed/);
});

test("readApp reads app from local.json, null with no file or no key, and refuses a broken file", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "relaunch-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, "local.json");
  assert.equal(readApp(file), null);
  fs.writeFileSync(file, JSON.stringify({ clickHost: "click-mac" }));
  assert.equal(readApp(file), null);
  fs.writeFileSync(file, JSON.stringify({ app: "/Applications/Ableton Live 12 Standard.app" }));
  assert.equal(readApp(file), "/Applications/Ableton Live 12 Standard.app");
  fs.writeFileSync(file, "{");
  assert.throws(() => readApp(file), /isn't valid JSON/);
});

test("installedLives lists only the Ableton Live apps in a folder", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "relaunch-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const name of ["Ableton Live 12 Suite.app", "Ableton Live 12 Standard.app", "Max.app", "Ableton Live 12 Suite.txt"]) fs.mkdirSync(path.join(folder, name));
  assert.deepEqual(installedLives(folder), [path.join(folder, "Ableton Live 12 Standard.app"), path.join(folder, "Ableton Live 12 Suite.app")]);
});
