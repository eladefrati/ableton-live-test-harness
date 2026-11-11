"use strict";

// What several harness modules need from the system: running a command, building a Swift
// helper once, and escaping text for XML.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

// Runs `cmd args` and resolves with its stdout. A failure rejects with its stderr, or else
// the reason it couldn't run.
function run(cmd, args = []) {
  const words = args.map(String);
  return new Promise((resolve, reject) => {
    execFile(cmd, words, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${cmd} ${words.join(" ")} failed: ${(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

// Compiled helpers, by source hash. Not in the harness's temp folder (HARNESS_TEMP in
// macos.js), which relaunch.js empties after building a plug-in's set: the first build with
// an empty module cache took 53 s on the remote Mac.
const HELPER_CACHE = path.join(os.tmpdir(), "ableton-harness-tools");

// The path of the compiled helper for the Swift file `source`, built with swiftc if this
// version of the source hasn't been. It is built under a name of its own and renamed into
// place, so a run never finds half a binary.
async function helperBinary(source) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 16);
  const binary = path.join(HELPER_CACHE, `${path.basename(source, ".swift")}-${hash}`);
  if (fs.existsSync(binary)) return binary;
  // xcode-select fails without developer tools; swiftc would open the install dialog.
  await run("xcode-select", ["-p"]).catch(() => {
    throw new Error(`Building ${source} needs Xcode or the Command Line Tools (xcode-select --install)`);
  });
  fs.mkdirSync(HELPER_CACHE, { recursive: true });
  const partial = `${binary}.${process.pid}.${Date.now()}`;
  try {
    await run("swiftc", ["-O", source, "-o", partial]);
    fs.renameSync(partial, binary);
  } finally {
    fs.rmSync(partial, { force: true });
  }
  return binary;
}

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { run, helperBinary, escapeXml, HELPER_CACHE };
