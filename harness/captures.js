#!/usr/bin/env node
"use strict";

// Where the harness saves a still, a video or a frame given no path (ADR-0016): a folder of its
// own in the system temp folder. Not in the harness's temp folder (HARNESS_TEMP in macos.js),
// which relaunch.js and quit.js empty. A capture is proof to show once, not part of a
// project, so no project keeps a folder for it. macOS doesn't clear this folder of files left
// unused (measured on macOS 26: files more than 3 days old outlived its daily clean-up), so
// each capture saved here deletes, once it is saved, the captures older than KEEP_DAYS. A path
// the caller gives outside this folder is used as given, and nothing here deletes it.
//
// A capture is written here under a hidden name, `.unfinished/<name>`, and moved to its own
// once it is finished: a file in the folder itself is whole, and remote.sh may bring it back.
// A video's helper moves it, so a run that ends while it records still leaves a finished video.
// A hidden folder rather than a hidden file name: screencapture refuses to write a file whose
// name starts with a dot, saying so but exiting 0 (macOS 26).
//
//   node harness/captures.js finished    the folder, then the name of each finished capture in
//                                        it, one a line (for remote.sh)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CAPTURES = path.join(os.tmpdir(), "ableton-harness-captures");
const KEEP_DAYS = 7;
const UNFINISHED = ".unfinished";

const two = (n, width = 2) => String(n).padStart(width, "0");
// The local time, to the millisecond, in a form a file name can hold.
const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}-${two(d.getMilliseconds(), 3)}`;

// The path of a new capture in the folder, named by the time and `name`, what it shows, with
// the extension `ext`. Makes the folder; deletes nothing.
function capturePath(name, ext, { root = CAPTURES, now = new Date() } = {}) {
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, `${stamp(now)}-${name}${ext}`);
}

// The hidden name `file` is written under until it is finished; its folder is made.
function unfinished(file) {
  const folder = path.join(path.dirname(file), UNFINISHED);
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, path.basename(file));
}

// Saves a capture in the folder, as capturePath names it: `write` makes it at the hidden name
// it is given, which then becomes the capture's own; a capture that fails leaves nothing.
// Then, and not before, so a capture made from another one there can read it, deletes the
// folder's old captures. Resolves with the capture's path.
async function saveCapture(name, ext, write, { root = CAPTURES, now = new Date() } = {}) {
  const file = capturePath(name, ext, { root, now });
  const writing = unfinished(file);
  try {
    await write(writing);
    fs.renameSync(writing, file);
  } finally {
    fs.rmSync(writing, { force: true });
  }
  pruneCaptures(root);
  return file;
}

// Deletes what is in `root` older than KEEP_DAYS by its modification time, and what is in its
// unfinished folder: a capture being written there has a recent one (a video's is the time of
// its last frame, and none records past 10 minutes), so one that old is one whose writer was
// killed. Best effort: what can't be read or deleted is left.
function pruneCaptures(root = CAPTURES, now = new Date()) {
  const before = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const prune = (folder, keep = []) => {
    let names = [];
    try {
      names = fs.readdirSync(folder);
    } catch {}
    for (const name of names.filter((n) => !keep.includes(n))) {
      const file = path.join(folder, name);
      try {
        if (fs.lstatSync(file).mtimeMs < before) fs.rmSync(file, { recursive: true, force: true });
      } catch {}
    }
  };
  prune(root, [UNFINISHED]);
  prune(path.join(root, UNFINISHED));
}

// The names of the finished files in `root`: those not under a hidden name.
function finishedCaptures(root = CAPTURES) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {}
  return entries.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name);
}

if (require.main === module) {
  if (process.argv[2] !== "finished") {
    console.error("usage: captures.js finished");
    process.exitCode = 2;
  } else {
    console.log([CAPTURES, ...finishedCaptures()].join("\n"));
  }
}

module.exports = { CAPTURES, KEEP_DAYS, capturePath, saveCapture, unfinished, pruneCaptures, finishedCaptures };
