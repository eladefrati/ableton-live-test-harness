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
// A video being recorded here has a hidden mark beside it, `.<name>.recording`, holding its
// recorder's process id: remote.sh brings back only finished captures, and pruning leaves a
// recording alone.
//
//   node harness/captures.js finished    the folder, then the name of each finished capture in
//                                        it, one a line (for remote.sh)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CAPTURES = path.join(os.tmpdir(), "ableton-harness-captures");
const KEEP_DAYS = 7;
const MARK = /^\.(.+)\.recording$/;

const two = (n, width = 2) => String(n).padStart(width, "0");
// The local time, to the millisecond, in a form a file name can hold.
const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}-${two(d.getMilliseconds(), 3)}`;

// The path of a new capture in the folder, named by the time and `name`, what it shows, with
// the extension `ext`. Makes the folder; deletes nothing.
function capturePath(name, ext, { root = CAPTURES, now = new Date() } = {}) {
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, `${stamp(now)}-${name}${ext}`);
}

// Saves a capture in the folder, as capturePath names it: `write` (its path) makes it. Then,
// and not before, so a capture made from another one there can read it, deletes the folder's
// old captures. Resolves with the capture's path.
async function saveCapture(name, ext, write, { root = CAPTURES, now = new Date() } = {}) {
  const file = capturePath(name, ext, { root, now });
  await write(file);
  pruneCaptures(root, now);
  return file;
}

const markOf = (file) => path.join(path.dirname(file), `.${path.basename(file)}.recording`);

// Marks `file` as being recorded by the process `pid`; unmarkRecording takes the mark away.
function markRecording(file, pid) {
  fs.writeFileSync(markOf(file), String(pid));
}
function unmarkRecording(file) {
  fs.rmSync(markOf(file), { force: true });
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Whether `file` is being recorded: its mark names a process that still runs.
function recording(file) {
  try {
    return running(Number(fs.readFileSync(markOf(file), "utf8")));
  } catch {
    return false;
  }
}

// Deletes what is in `root` older than KEEP_DAYS by its modification time, except a video still
// being recorded, and the marks of recordings that have ended. Best effort: what can't be read
// or deleted is left.
function pruneCaptures(root = CAPTURES, now = new Date()) {
  const before = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {}
  for (const name of names) {
    const file = path.join(root, name);
    try {
      const mark = name.match(MARK);
      if (mark) {
        if (!recording(path.join(root, mark[1]))) fs.rmSync(file, { force: true });
      } else if (fs.lstatSync(file).mtimeMs < before && !recording(file)) {
        fs.rmSync(file, { recursive: true, force: true });
      }
    } catch {}
  }
}

// The names of the files in `root` that are finished: not hidden, and not being recorded.
function finishedCaptures(root = CAPTURES) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {}
  return entries.filter((e) => e.isFile() && !e.name.startsWith(".") && !recording(path.join(root, e.name))).map((e) => e.name);
}

if (require.main === module) {
  if (process.argv[2] !== "finished") {
    console.error("usage: captures.js finished");
    process.exitCode = 2;
  } else {
    console.log([CAPTURES, ...finishedCaptures()].join("\n"));
  }
}

module.exports = { CAPTURES, KEEP_DAYS, capturePath, saveCapture, pruneCaptures, markRecording, unmarkRecording, recording, finishedCaptures };
