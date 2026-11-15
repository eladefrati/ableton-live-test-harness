"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { CAPTURES, capturePath, pruneCaptures, markRecording, finishedCaptures } = require("../captures.js");

function folder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "captures-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const DAY = 24 * 60 * 60 * 1000;
function file(root, name, ageDays = 0) {
  const at = path.join(root, name);
  fs.writeFileSync(at, "x");
  const when = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(at, when, when);
  return at;
}

// A process that stays alive until the test ends, as a recorder does while it records.
function alive(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => child.kill());
  return child.pid;
}

// A process id that no longer runs.
async function gone() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.on("exit", resolve));
  return child.pid;
}

test("captures go to a folder of their own in the system temp folder, apart from the one relaunch.js empties", () => {
  assert.equal(CAPTURES, path.join(os.tmpdir(), "ableton-harness-captures"));
});

test("a capture's default path is in the captures folder, named by the local time to the millisecond and what it shows", (t) => {
  const root = folder(t);
  const now = new Date(2030, 0, 2, 3, 4, 5, 6);
  assert.equal(capturePath("live-window", ".mov", { root, now }), path.join(root, "2030-01-02T03-04-05-006-live-window.mov"));
  assert.ok(fs.existsSync(root));
});

test("a new capture's path deletes captures there older than 7 days, but not one still being recorded", (t) => {
  const root = folder(t);
  const old = file(root, "old.png", 8);
  const recent = file(root, "recent.png", 6);
  const recording = file(root, "recording.mov", 8);
  markRecording(recording, alive(t));
  const oldFolder = path.join(root, "frames");
  fs.mkdirSync(oldFolder);
  fs.utimesSync(oldFolder, new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY));
  capturePath("live-window", ".png", { root });
  assert.ok(!fs.existsSync(old), "older than 7 days");
  assert.ok(!fs.existsSync(oldFolder), "a folder older than 7 days");
  assert.ok(fs.existsSync(recent), "6 days old");
  assert.ok(fs.existsSync(recording), "still recording");
});

test("pruning deletes the mark of a recording whose recorder has ended, and nothing outside the folder", async (t) => {
  const root = folder(t);
  const done = file(root, "done.mov");
  markRecording(done, await gone());
  const outside = file(path.dirname(root), `${path.basename(root)}-outside.png`, 30);
  t.after(() => fs.rmSync(outside, { force: true }));
  pruneCaptures(root);
  assert.deepEqual(fs.readdirSync(root), ["done.mov"]);
  assert.ok(fs.existsSync(outside));
});

test("the finished captures are the files whose recorder, if any, has ended; marks and folders are left out", async (t) => {
  const root = folder(t);
  file(root, "still.png");
  markRecording(file(root, "done.mov"), await gone());
  markRecording(file(root, "recording.mov"), alive(t));
  fs.mkdirSync(path.join(root, "frames"));
  assert.deepEqual(finishedCaptures(root).sort(), ["done.mov", "still.png"]);
  assert.deepEqual(finishedCaptures(path.join(root, "missing")), []);
});
