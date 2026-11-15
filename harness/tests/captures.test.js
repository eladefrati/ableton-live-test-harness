"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CAPTURES, capturePath, saveCapture, pruneCaptures, finishedCaptures } = require("../captures.js");

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

test("captures go to a folder of their own in the system temp folder, apart from the one relaunch.js empties", () => {
  assert.equal(CAPTURES, path.join(os.tmpdir(), "ableton-harness-captures"));
});

test("a capture's default path is in the captures folder, named by the local time to the millisecond and what it shows", (t) => {
  const root = folder(t);
  const now = new Date(2030, 0, 2, 3, 4, 5, 6);
  assert.equal(capturePath("live-window", ".mov", { root, now }), path.join(root, "2030-01-02T03-04-05-006-live-window.mov"));
  assert.ok(fs.existsSync(root));
});

test("a capture's default path deletes nothing", (t) => {
  const root = folder(t);
  const old = file(root, "old.png", 8);
  capturePath("live-window", ".png", { root });
  assert.ok(fs.existsSync(old));
});

test("a capture saved in the folder deletes the captures there older than 7 days once it is saved, not before", async (t) => {
  const root = folder(t);
  const old = file(root, "old.mov", 8);
  const saved = await saveCapture("live-window", ".png", async (at) => {
    assert.ok(fs.existsSync(old), "still there while the capture is made");
    fs.writeFileSync(at, "png");
  }, { root });
  assert.equal(path.dirname(saved), root);
  assert.equal(fs.readFileSync(saved, "utf8"), "png");
  assert.ok(!fs.existsSync(old), "deleted once it was saved");
});

test("a capture is written under a hidden name in the folder, and given its own once saved", async (t) => {
  const root = folder(t);
  let writing;
  const name = path.join(root, "2030-01-02T03-04-05-006-live-window.png");
  const saved = await saveCapture("live-window", ".png", async (at) => {
    writing = at;
    fs.writeFileSync(at, "png");
    assert.ok(!fs.existsSync(name), "not under its name until it is saved");
  }, { root, now: new Date(2030, 0, 2, 3, 4, 5, 6) });
  assert.equal(saved, name);
  assert.equal(writing, path.join(root, ".unfinished", "2030-01-02T03-04-05-006-live-window.png"));
  assert.equal(fs.readFileSync(saved, "utf8"), "png");
  assert.ok(!fs.existsSync(writing));
});

test("a capture that fails as it is written leaves nothing in the folder", async (t) => {
  const root = folder(t);
  await assert.rejects(saveCapture("live-window", ".png", async (at) => {
    fs.writeFileSync(at, "half");
    throw new Error("the capture failed");
  }, { root }), /the capture failed/);
  assert.deepEqual(fs.readdirSync(root), [".unfinished"]);
  assert.deepEqual(fs.readdirSync(path.join(root, ".unfinished")), []);
});

test("pruning deletes what is older than 7 days there, a hidden capture left unfinished too, and nothing newer or outside the folder", (t) => {
  const root = folder(t);
  const old = file(root, "old.png", 8);
  const recent = file(root, "recent.png", 6);
  fs.mkdirSync(path.join(root, ".unfinished"));
  const writing = file(root, ".unfinished/writing.mov", 0);
  const left = file(root, ".unfinished/left.mov", 8);
  fs.utimesSync(path.join(root, ".unfinished"), new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY));
  const oldFolder = path.join(root, "frames");
  fs.mkdirSync(oldFolder);
  fs.utimesSync(oldFolder, new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY));
  const outside = file(path.dirname(root), `${path.basename(root)}-outside.png`, 30);
  t.after(() => fs.rmSync(outside, { force: true }));
  pruneCaptures(root);
  assert.ok(!fs.existsSync(old), "older than 7 days");
  assert.ok(!fs.existsSync(oldFolder), "a folder older than 7 days");
  assert.ok(!fs.existsSync(left), "a hidden capture 8 days old, which nothing still writes");
  assert.ok(fs.existsSync(recent), "6 days old");
  assert.ok(fs.existsSync(writing), "a hidden capture being written");
  assert.ok(fs.existsSync(outside), "outside the folder");
});

test("the finished captures are the files there not under a hidden name", (t) => {
  const root = folder(t);
  file(root, "still.png");
  file(root, "done.mov");
  fs.mkdirSync(path.join(root, ".unfinished"));
  file(root, ".unfinished/recording.mov");
  file(root, ".hidden.png");
  fs.mkdirSync(path.join(root, "frames"));
  assert.deepEqual(finishedCaptures(root).sort(), ["done.mov", "still.png"]);
  assert.deepEqual(finishedCaptures(path.join(root, "missing")), []);
});
