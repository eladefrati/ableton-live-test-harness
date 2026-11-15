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
// the reason it couldn't run, after the command line; the error's `stderr` is the command's
// alone, and its `cause` is execFile's own, whose `code` is the exit status and whose `signal`
// is the signal that ended the command, if one did.
function run(cmd, args = [], { env, started } = {}) {
  const words = args.map(String);
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, words, { maxBuffer: 16 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(new Error(`${[cmd, ...words].join(" ")} failed: ${(stderr || error.message).trim()}`, { cause: error }), { stderr }));
      else resolve(stdout);
    });
    if (started) started(child);
  });
}

// Compiled helpers, by source hash. Not in the harness's temp folder (HARNESS_TEMP in
// macos.js), which relaunch.js empties after building a plug-in's set: the first build with
// an empty module cache took 53 s on the remote Mac.
const HELPER_CACHE = path.join(os.tmpdir(), "ableton-harness-tools");
// How long a build stays in the cache unused. A build's last use is the later of its access
// and modification times: this module sets both when a process first finds the build, and an
// older checkout of the harness, which sets neither, still updates the access time by
// running it. An unchanged source keeps its hash, and its build, for weeks. An older
// checkout's build that it has found but not yet run can still be deleted under it, which
// nothing here can prevent.
const UNUSED_DAYS = 7;
// The builds this process has marked used.
const marked = new Set();

// The path of the compiled helper for the Swift file `source`, built with swiftc if this
// version of the source hasn't been. It is built under a name of its own and renamed into
// place, so a run never finds half a binary. After a build, the call deletes the same
// helper's other builds in `cache` that no process has used for UNUSED_DAYS. Marking and
// deleting are best effort: neither fails the call.
async function helperBinary(source, cache = HELPER_CACHE) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 16);
  const name = path.basename(source, ".swift");
  const binary = path.join(cache, `${name}-${hash}`);
  if (marked.has(binary) ? fs.existsSync(binary) : markUsed(binary)) return binary;
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
  marked.add(binary);
  pruneUnused(cache, name);
  return binary;
}

// Sets the build's access and modification times to now, on this process's first lookup, and
// says whether the build is there: one that is gone, as one another process has just pruned,
// is built again. Times it can't set are left as they are.
function markUsed(binary) {
  const now = new Date();
  try {
    fs.utimesSync(binary, now, now);
  } catch (error) {
    if (error.code === "ENOENT" || !fs.existsSync(binary)) return false;
  }
  marked.add(binary);
  return true;
}

// Deletes the builds of the helper `name` in `cache` last used more than UNUSED_DAYS ago,
// leftover partial builds included; a build under way, or just made, is newer. Other
// helpers' builds, and anything else, are left, as is what can't be read or deleted, or what
// another process deleted first.
function pruneUnused(cache, name) {
  const before = Date.now() - UNUSED_DAYS * 24 * 60 * 60 * 1000;
  // `name`, a hash, and for a partial build its process and time (helperBinary).
  const isBuild = (entry) => entry.startsWith(`${name}-`) && /^[0-9a-f]{16}(\.\d+\.\d+)?$/.test(entry.slice(name.length + 1));
  let entries = [];
  try {
    entries = fs.readdirSync(cache).filter(isBuild);
  } catch {}
  for (const entry of entries) {
    const file = path.join(cache, entry);
    try {
      const { atimeMs, mtimeMs } = fs.lstatSync(file);
      if (Math.max(atimeMs, mtimeMs) < before) fs.rmSync(file, { recursive: true, force: true });
    } catch {}
  }
}

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { run, helperBinary, escapeXml };
