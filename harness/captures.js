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
// once it is finished, whether it was given no path or a path here (startCapture): a file in
// the folder itself is whole, and remote.sh may bring it back.
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

// The real path of `file`, or null if it isn't there.
const real = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

// The hidden names this process's captures given no path are being written under.
const writingHere = new Set();

// A path for a capture given no path, by capturePath, that no capture in the folder has and
// none is being written under in this process: two of the same thing in one millisecond get
// "-2", "-3" after the name.
function freePath(name, ext, { root, now }) {
  for (let n = 1; ; n++) {
    const file = capturePath(n === 1 ? name : `${name}-${n}`, ext, { root, now });
    const writing = path.join(path.dirname(file), UNFINISHED, path.basename(file));
    if (!fs.existsSync(file) && !fs.existsSync(writing) && !writingHere.has(writing)) return file;
  }
}

// Starts a capture: every still, frame and video the harness saves goes through here. Its
// path is `file`, the caller's, its folder made if it is missing, or with none a new one in the
// folder (freePath, by `name` and `ext`). Returns { file, writing, finish(), finished(), abandon() }. `writing` is where the
// capture is to be written: in the folder, however the path names it, its hidden name, cleared
// of what a writer killed before left there; elsewhere `file` itself, as given. finish() moves
// what was written to `file` and returns the capture's path: one given a path replaces a file
// there, one given none replaces nothing and takes the next free name if another process's
// capture has taken its own meanwhile. finished() is for a writer that moves it itself, as a
// video's helper does, which replaces nothing. Either then prunes the folder, if the capture
// is in it. abandon() deletes what a failed writer left under a hidden name.
function startCapture(file, { name, ext, root = CAPTURES, now = new Date() } = {}) {
  const target = file === undefined ? freePath(name, ext, { root, now }) : file;
  const folder = path.dirname(path.resolve(target));
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (error) {
    const why = ["EACCES", "EPERM"].includes(error.code) ? "a folder above it can't be written" : error.message;
    throw new Error(`Couldn't save ${target}: its folder can't be made (${why}). Not captured`, { cause: error });
  }
  if (real(folder) !== real(root)) {
    const done = () => target;
    return { file: target, writing: target, finish: done, finished: done, abandon: done };
  }
  const hidden = path.join(folder, UNFINISHED);
  fs.mkdirSync(hidden, { recursive: true });
  const writing = path.join(hidden, path.basename(target));
  fs.rmSync(writing, { force: true });
  writingHere.add(writing);
  return {
    file: target,
    writing,
    finish() {
      writingHere.delete(writing);
      let saved = target;
      if (file === undefined) {
        // A link fails where a file has the name, as a rename doesn't.
        for (;;) {
          try {
            fs.linkSync(writing, saved);
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            saved = freePath(name, ext, { root, now });
          }
        }
        fs.rmSync(writing);
      } else {
        fs.renameSync(writing, target);
      }
      pruneCaptures(root);
      return saved;
    },
    finished() {
      writingHere.delete(writing);
      pruneCaptures(root);
      return target;
    },
    abandon() {
      writingHere.delete(writing);
      fs.rmSync(writing, { force: true });
      return target;
    },
  };
}

// Saves a capture as startCapture does, written by `write` at the path it is given, and then,
// not before, so a capture made from another one there can read it, prunes the folder. One
// that fails leaves nothing under a hidden name. Resolves with { file, value }, its path and
// what `write` resolved with.
async function saveCapture(file, options, write) {
  const capture = startCapture(file, options);
  let value;
  let saved;
  try {
    value = await write(capture.writing);
    saved = capture.finish();
  } catch (error) {
    capture.abandon();
    throw error;
  }
  return { file: saved, value };
}

// Deletes what is in `root` older than KEEP_DAYS by its modification time, and what is in its
// unfinished folder: a capture being written there has a recent one (a video's is the time of
// its last frame, written as it records), so one that old is one whose writer was killed, or a
// recording asked to last longer than KEEP_DAYS. Best effort: what can't be read or deleted is
// left.
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

module.exports = { CAPTURES, KEEP_DAYS, capturePath, startCapture, saveCapture, pruneCaptures, finishedCaptures };
