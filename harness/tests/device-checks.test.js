"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { latestBuild, chooseBuild, placesProblem, straddleProblem, buildScript, clipNotes, commandLine, run } = require("../device-checks.js");

function folder(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "device-checks-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "");
  return dir;
}

// An .amxd as build tools write it: "ampf", "meta" and "ptch" chunks, the last the patcher.
function amxd(boxes) {
  const chunk = (tag, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(payload.length);
    return Buffer.concat([Buffer.from(tag, "latin1"), length, payload]);
  };
  const patcher = Buffer.from(JSON.stringify({ patcher: { boxes: boxes.map((box) => ({ box })) } }) + "\0");
  return Buffer.concat([chunk("ampf", Buffer.from("mmmm")), chunk("meta", Buffer.alloc(4)), chunk("ptch", patcher)]);
}

test("chooseBuild takes a file name or a function, and defaults to the highest version", () => {
  const dir = folder(["Device 2030.1.9.3.amxd", "Device 2030.1.18.1.amxd", "Device-v2.amxd"]);
  assert.equal(chooseBuild(null, dir, "Device"), "Device 2030.1.18.1.amxd");
  assert.equal(chooseBuild("Device-v2.amxd", dir, "Device"), "Device-v2.amxd");
  assert.equal(chooseBuild((d) => fs.readdirSync(d).find((n) => n.endsWith("-v2.amxd")), dir, "Device"), "Device-v2.amxd");
  assert.throws(() => chooseBuild("Missing.amxd", dir, "Device"), /No Missing\.amxd in /);
  assert.throws(() => chooseBuild(() => undefined, dir, "Device"), /gave no file name/);
});

test("latestBuild takes the highest version, numerically, of that device only", () => {
  const dir = folder(["Device 2030.1.9.3.amxd", "Device 2030.1.18.1.amxd", "Device 2030.1.18.10.amxd",
    "Device 2030.1.18.2.amxd", "Device Two 2030.1.19.1.amxd", "Device Three 2030.1.20.1.amxd", "notes.txt"]);
  assert.equal(latestBuild(dir, "Device"), "Device 2030.1.18.10.amxd");
  assert.equal(latestBuild(dir, "Device Two"), "Device Two 2030.1.19.1.amxd");
  assert.throws(() => latestBuild(dir, "Other Device"), /No Other Device build/);
});

test("buildScript finds the [v8] object's script by its text", () => {
  const dir = folder([]);
  const file = path.join(dir, "Device 2030.1.18.1.amxd");
  fs.writeFileSync(file, amxd([
    { text: "v8ui", textfile: { text: "view" } },
    { text: "v8 @embed 1", textfile: { text: "const HOOK = true;" } },
    { text: "midiout" },
  ]));
  assert.equal(buildScript(file), "const HOOK = true;");
  assert.equal(buildScript(file, /^v8ui/), "view");
  assert.throws(() => buildScript(file, /^js /), /found 0/);
});

test("clipNotes has no two notes of one pitch overlapping", () => {
  const notes = clipNotes();
  assert.equal(notes.length, 16);
  for (const a of notes) {
    for (const b of notes) {
      if (a !== b && a.pitch === b.pitch) assert.ok(a.start + a.duration <= b.start || b.start + b.duration <= a.start);
    }
  }
});

test("commandLine reads --keep and --tempo with its value, and refuses anything else", () => {
  assert.deepEqual(commandLine([]), { flags: new Set() });
  assert.deepEqual(commandLine(["--keep", "--tempo", "97.5"]), { flags: new Set(["--keep"]), tempo: 97.5 });
  assert.deepEqual(commandLine(["--tempo", "143", "--keep"]), { flags: new Set(["--keep"]), tempo: 143 });
  assert.throws(() => commandLine(["--tempo"]), /--tempo needs a tempo in BPM, not undefined/);
  assert.throws(() => commandLine(["--tempo", "fast"]), /not fast/);
  assert.throws(() => commandLine(["--tempp", "97"]), /Unknown option --tempp/);
});

test("run refuses a tempo outside Live's range before it connects", async () => {
  const options = { device: "Device", builds: "/nowhere" };
  await assert.rejects(run([], { ...options, tempo: 10 }), /Tempo 10 is outside 20-999 BPM/);
  await assert.rejects(run([], { ...options, tempo: 1000 }), /outside/);
});

test("placesProblem: the build must be in exactly one Places folder", () => {
  const build = "Other Device 2030.1.18.2.amxd";
  const builds = "/Users/someone/dev/other-device/builds";
  assert.equal(placesProblem(build, builds, ["builds"]), null);
  assert.match(placesProblem(build, builds, []),
    /^Other Device 2030\.1\.18\.2\.amxd isn't in Live's Places: add \/Users\/someone\/dev\/other-device\/builds to Places/);
  assert.match(placesProblem(build, builds, ["builds", "builds"]),
    /is in 2 Places folders \(builds, builds\): remove all but \/Users\/someone\/dev\/other-device\/builds/);
});

test("straddleProblem fails a during window that may cross a grid line, reach included", () => {
  // a 1/16 grid (0.25 beats); 50 ms at 120 BPM is 0.1 beat
  assert.equal(straddleProblem({ beat: 2.1, before: 2.12, after: 2.13 }, 0.25, 0.1), null);
  assert.match(straddleProblem({ beat: 2.1, before: 2.12, after: 2.16 }, 0.25, 0.1),
    /the change at beat 2\.1 landed between 2\.120 and 2\.260, across the grid line at 2\.25/);
  assert.match(straddleProblem({ beat: 2.2, before: 2.24, after: 2.26 }, 0.25, 0), /grid line at 2\.25/);
});

test("straddleProblem: a window wider than the grid says so; a non-dyadic grid has no float noise", () => {
  assert.match(straddleProblem({ beat: 2.01, before: 2.02, after: 2.22 }, 0.25, 0.1), /wider than the grid \(0\.25 beats\)/);
  assert.equal(straddleProblem({ beat: 0.3, before: 0.3, after: 0.33 }, 0.1, 0), null);
});

test("run refuses a bad during entry before it connects", async () => {
  const options = { device: "Device", builds: "/nowhere" };
  const cases = (during) => [{ name: "c", during, expect: () => [] }];
  await assert.rejects(run(cases([{ beat: 1 }]), options), /c: a during entry needs an action or a set/);
  await assert.rejects(run(cases([{ beat: 1, set: { A: 1 }, action: () => {} }]), options), /not both or neither/);
  await assert.rejects(run(cases([{ beat: 1, set: { A: 1 }, grid: 0 }]), options), /grid must be a positive number/);
});
