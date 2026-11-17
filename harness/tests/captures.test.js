"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CAPTURES, capturePath, startCapture, saveCapture, pruneCaptures, finishedCaptures } = require("../captures.js");

function folder(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "captures-test-")));
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
  const saved = await saveCapture(undefined, { name: "live-window", ext: ".png", root }, async (at) => {
    assert.ok(fs.existsSync(old), "still there while the capture is made");
    fs.writeFileSync(at, "png");
    return "said";
  });
  assert.equal(path.dirname(saved.file), root);
  assert.equal(saved.value, "said", "what the writer resolved with");
  assert.equal(fs.readFileSync(saved.file, "utf8"), "png");
  assert.ok(!fs.existsSync(old), "deleted once it was saved");
});

test("a capture is written under a hidden name in the folder, and given its own once saved", async (t) => {
  const root = folder(t);
  let writing;
  const name = path.join(root, "2030-01-02T03-04-05-006-live-window.png");
  const saved = await saveCapture(undefined, { name: "live-window", ext: ".png", root, now: new Date(2030, 0, 2, 3, 4, 5, 6) }, async (at) => {
    writing = at;
    fs.writeFileSync(at, "png");
    assert.ok(!fs.existsSync(name), "not under its name until it is saved");
  });
  assert.equal(saved.file, name);
  assert.equal(writing, path.join(root, ".unfinished", "2030-01-02T03-04-05-006-live-window.png"));
  assert.equal(fs.readFileSync(saved.file, "utf8"), "png");
  assert.ok(!fs.existsSync(writing));
});

test("two captures given no file at the same moment, of the same thing, are both kept, each under a name of its own", async (t) => {
  const root = folder(t);
  const now = new Date(2030, 0, 2, 3, 4, 5, 6);
  const save = (text) => saveCapture(undefined, { name: "clip-1s", ext: ".png", root, now }, async (at) => {
    fs.writeFileSync(at, text);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fs.readFileSync(at, "utf8"), text, "nothing else writes under its hidden name meanwhile");
  });
  const [a, b] = await Promise.all([save("a"), save("b")]);
  assert.notEqual(a.file, b.file);
  assert.equal(fs.readFileSync(a.file, "utf8"), "a");
  assert.equal(fs.readFileSync(b.file, "utf8"), "b");
});

test("a capture given no file replaces no file that has taken its name while it was written", async (t) => {
  const root = folder(t);
  const saved = await saveCapture(undefined, { name: "clip-1s", ext: ".png", root }, async (at) => {
    // As another process's capture of the same moment would.
    fs.writeFileSync(path.join(root, path.basename(at)), "other");
    fs.writeFileSync(at, "mine");
  });
  assert.equal(fs.readFileSync(saved.file, "utf8"), "mine");
  const other = fs.readdirSync(root).filter((name) => name !== ".unfinished" && path.join(root, name) !== saved.file);
  assert.equal(other.length, 1);
  assert.equal(fs.readFileSync(path.join(root, other[0]), "utf8"), "other");
});

test("a capture given a path in the folder is written under its hidden name too, also when the path reaches the folder through a link", async (t) => {
  const root = folder(t);
  const link = path.join(folder(t), "link");
  fs.symlinkSync(root, link);
  for (const given of [path.join(root, "mine.png"), path.join(link, "linked.png")]) {
    let writing;
    const saved = await saveCapture(given, { root }, async (at) => {
      writing = at;
      fs.writeFileSync(at, "png");
      assert.ok(!fs.existsSync(given), "not under its name until it is saved");
    });
    assert.equal(path.basename(writing), path.basename(given));
    assert.equal(fs.realpathSync(path.dirname(writing)), path.join(root, ".unfinished"), given);
    assert.equal(fs.readFileSync(given, "utf8"), "png");
    assert.equal(fs.realpathSync(saved.file), path.join(root, path.basename(given)));
  }
});

test("a capture given a path in the folder replaces one there of that name, and clears what a writer killed before left under its hidden name", async (t) => {
  const root = folder(t);
  file(root, "mine.png");
  fs.mkdirSync(path.join(root, ".unfinished"));
  file(root, ".unfinished/mine.png");
  await saveCapture(path.join(root, "mine.png"), { root }, async (at) => {
    assert.ok(!fs.existsSync(at), "the left one is gone before the writer starts");
    fs.writeFileSync(at, "new");
  });
  assert.equal(fs.readFileSync(path.join(root, "mine.png"), "utf8"), "new");
});

test("a capture given a path outside the folder is written there as it is, and prunes nothing", async (t) => {
  const root = folder(t);
  const old = file(root, "old.png", 8);
  const elsewhere = path.join(folder(t), "kept.png");
  const saved = await saveCapture(elsewhere, { root }, async (at) => {
    assert.equal(at, elsewhere);
    fs.writeFileSync(at, "png");
  });
  assert.equal(saved.file, elsewhere);
  assert.equal(fs.readFileSync(elsewhere, "utf8"), "png");
  assert.ok(fs.existsSync(old), "the folder isn't pruned for a capture outside it");
});

test("a capture given a path in a folder that doesn't exist makes the folder", async (t) => {
  const root = folder(t);
  const missing = path.join(folder(t), "new", "sub", "made.png");
  const saved = await saveCapture(missing, { root }, async (at) => fs.writeFileSync(at, "png"));
  assert.equal(saved.file, missing);
  assert.equal(fs.readFileSync(missing, "utf8"), "png");
});

test("a capture that fails as it is written leaves nothing in the folder, and prunes nothing", async (t) => {
  const root = folder(t);
  const old = file(root, "old.png", 8);
  await assert.rejects(saveCapture(undefined, { name: "live-window", ext: ".png", root }, async (at) => {
    fs.writeFileSync(at, "half");
    throw new Error("the capture failed");
  }), /the capture failed/);
  assert.deepEqual(fs.readdirSync(root).sort(), [".unfinished", "old.png"]);
  assert.deepEqual(fs.readdirSync(path.join(root, ".unfinished")), []);
});

test("a capture whose writer moves it itself is given its path and the hidden one, and prunes the folder once finished", (t) => {
  const root = folder(t);
  const old = file(root, "old.mov", 8);
  const capture = startCapture(undefined, { name: "live-window", ext: ".mov", root, now: new Date(2030, 0, 2, 3, 4, 5, 6) });
  assert.equal(capture.file, path.join(root, "2030-01-02T03-04-05-006-live-window.mov"));
  assert.equal(capture.writing, path.join(root, ".unfinished", "2030-01-02T03-04-05-006-live-window.mov"));
  fs.writeFileSync(capture.file, "mov");
  assert.ok(fs.existsSync(old), "not pruned before it is finished");
  capture.finished();
  assert.ok(!fs.existsSync(old), "pruned once it is finished");
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
