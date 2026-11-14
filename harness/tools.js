"use strict";

// What several harness modules need from the system: running a command, building a Swift
// helper once, and escaping text for XML.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

// Runs `cmd args` and resolves with its stdout, in the environment `env` if one is given and
// in this process's if not. `started`, if given, is called with the command's process as it
// starts, for a caller that may have to signal it. A failure rejects with its stderr, or else
// the reason it couldn't run; the error's `cause` is execFile's own, whose `code` is the exit
// status and whose `signal` is the signal that ended the command, if one did.
function run(cmd, args = [], { env, started } = {}) {
  const words = args.map(String);
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, words, { maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${[cmd, ...words].join(" ")} failed: ${(stderr || error.message).trim()}`, { cause: error }));
      else resolve(stdout);
    });
    if (started) started(child);
  });
}

// Compiled helpers, by source hash. Not in the harness's temp folder (HARNESS_TEMP in
// macos.js), which relaunch.js empties after building a plug-in's set: the first build with
// an empty module cache took 53 s on the remote Mac.
const HELPER_CACHE = path.join(os.tmpdir(), "ableton-harness-tools");
// How long a build stays in the cache unused. A build's modification time is its last use:
// an unchanged source keeps its hash, and its build, for weeks.
const UNUSED_DAYS = 7;

// The path of the compiled helper for the Swift file `source`, built with swiftc if this
// version of the source hasn't been. It is built under a name of its own and renamed into
// place, so a run never finds half a binary. Each call marks the build used and deletes the
// others in `cache` that no call has used for UNUSED_DAYS.
async function helperBinary(source, cache = HELPER_CACHE) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 16);
  const binary = path.join(cache, `${path.basename(source, ".swift")}-${hash}`);
  if (markUsed(binary)) {
    pruneUnused(cache, binary);
    return binary;
  }
  // xcode-select fails without developer tools; swiftc would open the install dialog.
  await run("xcode-select", ["-p"]).catch(() => {
    throw new Error(`Building ${source} needs Xcode or the Command Line Tools (xcode-select --install)`);
  });
  fs.mkdirSync(cache, { recursive: true });
  const partial = `${binary}.${process.pid}.${Date.now()}`;
  try {
    await run("swiftc", ["-O", source, "-o", partial]);
    fs.renameSync(partial, binary);
  } finally {
    fs.rmSync(partial, { force: true });
  }
  pruneUnused(cache, binary);
  return binary;
}

// Sets the build's modification time to now, its last use. False if there is no build: none
// yet, or another process pruned it a moment ago.
function markUsed(binary) {
  const now = new Date();
  try {
    fs.utimesSync(binary, now, now);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Deletes what in `cache`, other than `inUse`, was last used more than UNUSED_DAYS ago,
// leftover partial builds included. A build under way is newer. Another process may be
// pruning the same files: one already gone is skipped.
function pruneUnused(cache, inUse) {
  const before = Date.now() - UNUSED_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(cache)) {
    const file = path.join(cache, name);
    if (file === inUse) continue;
    try {
      if (fs.lstatSync(file).mtimeMs < before) fs.rmSync(file, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { run, helperBinary, escapeXml };
