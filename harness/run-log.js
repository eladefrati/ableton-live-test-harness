"use strict";

// Saves each run of a project's in-Live check in the project's own repo, so a later session
// can see what was tested and the result: one text file per run in <repo>/tests/live/logs/.
// The file holds a header (script, arguments, machine, time, commit, whether the code had
// uncommitted changes), then everything the run prints, as it prints, then the exit code. A
// file with no exit line is a run that was killed.
//
// connect() starts it, since every check goes through connect(). Harness tools connect too
// but test nothing, so only a script inside a tests/live/ folder is logged; so is no inline
// script (`node -e`), which has no file. A log that can't be written never fails the check.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { logStamp } = require("./log.js");

const LOGS = path.join("tests", "live", "logs");
const LOCAL = path.join(__dirname, "local.json");

let started = false;

function checkLocation(script) {
  const marker = `${path.sep}tests${path.sep}live${path.sep}`;
  const at = script.lastIndexOf(marker);
  if (at < 0) return null;
  return { repo: script.slice(0, at), name: script.slice(at + marker.length) };
}

function git(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// The machine as "remote" on the Mac harness/local.json names as "remote", "local" anywhere
// else: the log goes into a project's repo, which must not carry machine names.
function machineLabel(hostname = os.hostname(), file = LOCAL) {
  let remote = null;
  try {
    remote = JSON.parse(fs.readFileSync(file, "utf8")).remote;
  } catch {
    // No file or not JSON: no remote is known.
  }
  const host = (name) => String(name).split("@").pop().split(".")[0].toLowerCase();
  return typeof remote === "string" && remote && host(remote) === host(hostname) ? "remote" : "local";
}

function header(repo, name, now) {
  // The logs themselves don't count: an earlier run's log is not a change to what is tested.
  const changes = git(repo, "status", "--porcelain", "--", ".", `:(exclude)${LOGS}`);
  const uncommitted = changes === null ? "unknown" : changes ? "yes" : "no";
  return [
    `script: tests/live/${name}`,
    `args: ${process.argv.slice(2).join(" ")}`,
    `machine: ${machineLabel()}`,
    `started: ${logStamp(now)}`,
    `commit: ${git(repo, "rev-parse", "--short", "HEAD") || "unknown"}`,
    `uncommitted: ${uncommitted}`,
    "",
    "",
  ].join("\n");
}

function tee(stream, append) {
  const write = stream.write;
  stream.write = function teed(chunk, encoding, callback) {
    append(typeof chunk === "string"
      ? Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8")
      : chunk);
    return write.call(this, chunk, encoding, callback);
  };
}

function startRunLog() {
  if (started) return;
  started = true;
  try {
    // The entry module, not process.argv[1]: under `node -e` that is the first argument or
    // undefined, and require.main is undefined.
    if (!require.main) return;
    const script = fs.realpathSync(require.main.filename);
    const location = checkLocation(script);
    if (!location) return;
    const { repo, name } = location;
    const now = new Date();
    const folder = path.join(repo, LOGS);
    fs.mkdirSync(folder, { recursive: true });
    const stamp = logStamp(now).replace(/[:.]/g, "-");
    const label = name.replace(/\.js$/, "").split(path.sep).join("-");
    const fd = fs.openSync(path.join(folder, `${stamp}-${label}.txt`), "a");
    const append = (data) => {
      try {
        fs.writeSync(fd, data);
      } catch {
        // Keep the check running; its printed output is still there.
      }
    };
    append(header(repo, name, now));
    tee(process.stdout, append);
    tee(process.stderr, append);
    // Node prints an uncaught error itself, past process.stderr.
    process.on("uncaughtExceptionMonitor", (error) => append(`${error && error.stack || error}\n`));
    process.on("exit", (code) => append(`\nexit: ${code}\n`));
  } catch (error) {
    console.error(`Run log not saved: ${error.message}`);
  }
}

module.exports = { startRunLog, checkLocation, machineLabel };
