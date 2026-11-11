"use strict";

// Running a command where it sees this user's Audio Units. AudioToolbox finds the
// components in ~/Library/Audio/Plug-Ins/Components through the per-user
// AudioComponentRegistrar, a launchd agent of the user's GUI session (Aqua). A process
// started over ssh is in launchd's Background session, where that agent can't be reached:
// AudioToolbox asks the system's registrar instead, which lists only components in /Library
// and /System, and `auval -v` on a user's AU ends "didn't find the component" (the remote Mac,
// 2026-11-02). Outside the GUI session the command runs as a one-shot job in the user's GUI
// domain (`launchctl bootstrap gui/<uid>`, which needs no root), and its output and exit
// status come back through files.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { tempFolder } = require("./macos.js");
const { escapeXml } = require("./tools.js");

class UserSessionError extends Error {}

// Runs `cmd args` here and resolves with its stdout. A failure names stderr, or else the
// last line of stdout, where auval puts its reason ("FATAL ERROR: didn't find the
// component"), as runAsGuiJob does.
function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const why = stderr.trim() || stdout.trim().split("\n").pop() || error?.message;
      if (error) reject(new UserSessionError(`${cmd} ${args.join(" ")} failed: ${why}`));
      else resolve(stdout);
    });
  });
}

// A launchd job that runs `cmd args` once in `folder`, writing its stdout, stderr and exit
// status there. The status file is written last, by rename, so it appears whole.
function jobPlist(label, folder, cmd, args) {
  const script = '"$@" >stdout 2>stderr; echo $? >status.tmp; mv status.tmp status';
  const argv = ["/bin/sh", "-c", script, "sh", cmd, ...args];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${escapeXml(label)}</string>
<key>ProgramArguments</key><array>${argv.map((a) => `<string>${escapeXml(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escapeXml(folder)}</string>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
}

async function runAsGuiJob(cmd, args, timeoutMs) {
  const uid = process.getuid();
  const folder = tempFolder("gui-job-");
  const label = `local.ableton-live-test-harness.${path.basename(folder)}`;
  const plist = path.join(folder, "job.plist");
  fs.writeFileSync(plist, jobPlist(label, folder, cmd, args));
  const read = (name) => fs.readFileSync(path.join(folder, name), "utf8");
  try {
    try {
      await exec("launchctl", ["bootstrap", `gui/${uid}`, plist]);
    } catch (e) {
      throw new UserSessionError(`Could not start ${cmd} in the GUI session of user ${uid} (is the user logged in at the screen?): ${e.message}`);
    }
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(path.join(folder, "status"))) {
      if (Date.now() > deadline) throw new UserSessionError(`${cmd} ${args.join(" ")} did not finish within ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const status = Number(read("status").trim());
    if (status !== 0) {
      const why = read("stderr").trim() || read("stdout").trim().split("\n").pop();
      throw new UserSessionError(`${cmd} ${args.join(" ")} failed (exit status ${status}): ${why}`);
    }
    return read("stdout");
  } finally {
    // Removes the job, killing it if it is still running.
    await exec("launchctl", ["bootout", `gui/${uid}/${label}`]).catch(() => {});
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

// Runs `cmd args` in this user's GUI session and resolves with its stdout: directly when
// this process is already in it, otherwise as a launchd job there. `viaJob` forces the job.
async function runInUserSession(cmd, args, { timeoutMs = 120000, viaJob = false } = {}) {
  const session = (await exec("launchctl", ["managername"])).trim();
  if (session === "Aqua" && !viaJob) return exec(cmd, args);
  return runAsGuiJob(cmd, args, timeoutMs);
}

module.exports = { UserSessionError, jobPlist, runInUserSession };
