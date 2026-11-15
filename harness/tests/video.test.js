"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { VideoError, parseVideoArgs, recordVideo, runVideoCommand, parseFrameArgs, videoFrame } = require("../video.js");

// A stand-in for the video helper: a Node script that saves its arguments to `args.json` beside
// itself and then does what `body` says. It is run by Node (`runByNode`), never as a program
// of its own: macOS scans each new program the first time it runs, and with the other test
// files' new programs that queue of scans held up their starts past their tests' times.
function fakeHelper(t, body) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "video-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, "helper.js");
  fs.writeFileSync(file, `require("node:fs").writeFileSync(${JSON.stringify(path.join(folder, "args.json"))}, JSON.stringify(process.argv.slice(2)));
require("node:fs").writeFileSync(${JSON.stringify(path.join(folder, "pid"))}, String(process.pid));
${body}
`);
  return {
    folder, file,
    args: () => JSON.parse(fs.readFileSync(path.join(folder, "args.json"), "utf8")),
    pid: () => Number(fs.readFileSync(path.join(folder, "pid"), "utf8")),
  };
}

// Says it is recording, and on SIGINT says how long the file is and exits. It listens for the
// signal before it says so, as the helper does.
const RECORDS_UNTIL_SIGINT = `
process.on("SIGINT", () => { console.log(JSON.stringify({ seconds: 1.5, bytes: 1000 })); process.exit(0); });
console.log("recording");
setInterval(() => {}, 1000);
`;

// spawn() and tools.run() for a stand-in helper, run by Node.
const runByNode = (file, args, options) => spawn(process.execPath, [file, ...args], options);
const runToEnd = (file, args) => require("../tools.js").run(process.execPath, [file, ...args]);
const RUN_BY_NODE = `(file, args, options) => require("node:child_process").spawn(process.execPath, [file, ...args], options)`;

function fakeSystem(helper, { release = "25.6.0", windows = [{ id: 7, title: "Set", layer: 0 }], startedMs = 5000 } = {}) {
  const calls = [];
  const said = [];
  return {
    calls,
    said,
    captures: path.join(helper.folder, "captures"),
    say: (text) => said.push(text),
    startedMs,
    release: () => release,
    wake: async () => { calls.push("wake"); },
    mainWindow: async () => { calls.push("mainWindow"); return { id: 7 }; },
    windows: async () => { calls.push("windows"); return windows; },
    binary: async () => { calls.push("binary"); return helper.file; },
    frontmost: async () => "com.example.app",
    spawn: runByNode,
    run: runToEnd,
  };
}

const out = (helper, name = "video.mov") => path.join(helper.folder, "out", name);

test("the video command reads a file, a length, a window or the screen, and a command after --", () => {
  assert.deepEqual(parseVideoArgs(["a.mov"]), { file: "a.mov", seconds: undefined, window: undefined, screen: false, command: [] });
  assert.deepEqual(parseVideoArgs([]), { file: undefined, seconds: undefined, window: undefined, screen: false, command: [] });
  assert.deepEqual(parseVideoArgs(["--seconds", "3", "--", "node", "a.js"]),
    { file: undefined, seconds: 3, window: undefined, screen: false, command: ["node", "a.js"] });
  assert.deepEqual(parseVideoArgs(["a.mov", "--seconds", "2.5", "--window", "12"]),
    { file: "a.mov", seconds: 2.5, window: 12, screen: false, command: [] });
  assert.deepEqual(parseVideoArgs(["--screen", "a.mov", "--", "node", "check.js", "--tempo", "97"]),
    { file: "a.mov", seconds: undefined, window: undefined, screen: true, command: ["node", "check.js", "--tempo", "97"] });
});

test("the video command refuses what it can't record, saying how to call it", () => {
  for (const argv of [
    ["a.png"], ["a.mov", "b.mov"], ["a.mov", "--window", "3", "--screen"], ["a.mov", "--seconds", "0"],
    ["a.mov", "--seconds", "x"], ["a.mov", "--seconds"], ["a.mov", "--window", "1.5"], ["a.mov", "--keep"], ["a.mov", "--"],
  ]) {
    assert.throws(() => parseVideoArgs(argv), (e) => e instanceof VideoError && /usage: cli\.js video/.test(e.message), argv.join(" "));
  }
});

test("a Mac before macOS 15 is refused, saying so, before the helper is built", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper, { release: "23.6.0" });
  await assert.rejects(recordVideo(out(helper), {}, system), (e) => e instanceof VideoError && /macOS 15 or later/.test(e.message));
  assert.deepEqual(system.calls, []);
});

test("a window and the screen together are refused", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  await assert.rejects(recordVideo(out(helper), { window: 7, screen: true }, system), VideoError);
  assert.deepEqual(system.calls, []);
});

test("a file that isn't a .mov is refused", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  await assert.rejects(recordVideo(out(helper, "video.mp4"), {}, fakeSystem(helper)), /\.mov/);
});

test("by default Live's main window is recorded for up to 10 minutes, by a helper whose process is given; stop() ends it and resolves with the file's length and size", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  const file = out(helper);
  const video = await recordVideo(file, {}, system);
  assert.deepEqual(helper.args(), ["record", file, "window", "7", "600"]);
  assert.equal(video.pid, helper.pid(), "the helper's process");
  assert.deepEqual(await video.stop(), { file, seconds: 1.5, bytes: 1000 });
  assert.ok(fs.existsSync(path.dirname(file)), "the file's folder is made");
});

test("with no file, a video goes to the captures folder under the time and what it shows, written under a hidden name the helper renames it from when finished", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  const video = await recordVideo(undefined, {}, system);
  t.after(() => video.stop().catch(() => {}));
  assert.equal(path.dirname(video.file), system.captures);
  assert.match(path.basename(video.file), /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}-live-window\.mov$/);
  assert.deepEqual(helper.args(), ["record", path.join(system.captures, ".unfinished", path.basename(video.file)), "window", "7", "600", "then", video.file]);
  await video.stop();
  const screen = await recordVideo(undefined, { screen: true }, system);
  assert.match(path.basename(screen.file), /-live-screen\.mov$/);
  await screen.stop();
});

test("a video at a path of the caller's is written there under that name, unless the path is in the captures folder", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  const file = out(helper);
  await (await recordVideo(file, {}, system)).stop();
  assert.deepEqual(helper.args(), ["record", file, "window", "7", "600"]);
  const there = path.join(system.captures, "mine.mov");
  await (await recordVideo(there, {}, system)).stop();
  assert.deepEqual(helper.args(), ["record", path.join(system.captures, ".unfinished", "mine.mov"), "window", "7", "600", "then", there]);
});

test("a window given by id must be one of Live's on screen", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper, { windows: [{ id: 3 }] });
  await assert.rejects(recordVideo(out(helper), { window: 4 }, system), /Live has no window 4 on screen/);
  const video = await recordVideo(out(helper), { window: 3, seconds: 2 }, system);
  assert.deepEqual(helper.args().slice(2), ["window", "3", "2"]);
  await video.stop();
});

test("the helper is built before the display is woken, and the window looked up after, so a long build can't let it sleep again", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  await (await recordVideo(out(helper), {}, system)).stop();
  assert.deepEqual(system.calls, ["binary", "wake", "mainWindow"]);
  system.calls.length = 0;
  const video = await recordVideo(out(helper), { screen: true }, system);
  assert.deepEqual(helper.args().slice(2), ["screen", "600"]);
  assert.deepEqual(system.calls, ["binary", "wake"]);
  await video.stop();
});

test("a display that can't be woken is refused, saying why", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  system.wake = async () => { throw new Error("No app is frontmost 3000 ms after declaring user activity; Live can't be brought to the front"); };
  await assert.rejects(recordVideo(out(helper), {}, system), (e) => e instanceof VideoError
    && /^The display couldn't be woken for the recording: No app is frontmost 3000 ms/.test(e.message) && !/Automation/.test(e.message));
});

test("a display that can't be woken because System Events refuses the terminal app names the permission it needs", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  system.wake = async () => { throw new Error("No app is frontmost 3000 ms after declaring user activity; Live can't be brought to the front"); };
  system.frontmost = async () => { throw new Error("execution error: Not authorized to send Apple events to System Events. (-1743)"); };
  await assert.rejects(recordVideo(out(helper), {}, system), (e) => e instanceof VideoError
    && /couldn't be woken for the recording/.test(e.message) && /Not authorized to send Apple events to System Events/.test(e.message)
    && /Privacy & Security > Automation/.test(e.message));
});

test("a recording given a length ends by itself: done() resolves with the file's length and size", async (t) => {
  const helper = fakeHelper(t, `
console.log("recording");
setTimeout(() => { console.log(JSON.stringify({ seconds: 0.2, bytes: 10 })); process.exit(0); }, 200);
`);
  const video = await recordVideo(out(helper), { seconds: 0.2 }, fakeSystem(helper));
  assert.deepEqual(await video.done(), { file: out(helper), seconds: 0.2, bytes: 10 });
  assert.deepEqual(await video.stop(), { file: out(helper), seconds: 0.2, bytes: 10 }, "stop() after the end resolves the same");
});

test("a helper that ends before it records rejects with its reason", async (t) => {
  const helper = fakeHelper(t, `console.error("No window 7 is on screen"); process.exit(1);`);
  await assert.rejects(recordVideo(out(helper), {}, fakeSystem(helper)), (e) => e instanceof VideoError && /No window 7 is on screen/.test(e.message));
});

test("a helper that fails while recording rejects stop() and done() with its reason", async (t) => {
  const helper = fakeHelper(t, `
console.log("recording");
setTimeout(() => { console.error("The recording failed: disk full"); process.exit(1); }, 100);
`);
  const video = await recordVideo(out(helper), {}, fakeSystem(helper));
  await assert.rejects(video.done(), /The recording failed: disk full/);
  await assert.rejects(video.stop(), /The recording failed: disk full/);
});

test("a helper that doesn't start recording in time is ended, and the call rejects", async (t) => {
  const helper = fakeHelper(t, `setInterval(() => {}, 1000);`);
  let child;
  const system = fakeSystem(helper, { startedMs: 300 });
  system.spawn = (...args) => (child = runByNode(...args));
  await assert.rejects(recordVideo(out(helper), {}, system), /didn't start recording within 300 ms/);
  await new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", resolve)));
  assert.equal(child.signalCode, "SIGTERM");
});

test("a recording around a command lasts until the command ends, and returns its exit status", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const result = await runVideoCommand({ file: out(helper), screen: true, command: [process.execPath, "-e", "setTimeout(() => process.exit(3), 100)"] },
    fakeSystem(helper));
  assert.deepEqual(result, { file: out(helper), seconds: 1.5, bytes: 1000, status: 3 });
});

test("Ctrl-C on a recording around a command reaches the command once, and the recording ends after the command", { timeout: 20000 }, async (t) => {
  // The helper notes when it was told to stop; the command counts the SIGINTs it gets, takes
  // 500 ms to clean up after the first, notes when it ended, and exits 7.
  const helper = fakeHelper(t, `
const fs = require("node:fs");
process.on("SIGINT", () => {
  fs.writeFileSync(require("node:path").join(__dirname, "stopped"), String(Date.now()));
  console.log(JSON.stringify({ seconds: 1, bytes: 1 }));
  process.exit(0);
});
console.log("recording");
setInterval(() => {}, 1000);
`);
  const at = (name) => path.join(helper.folder, name);
  fs.writeFileSync(at("command.js"), `
const fs = require("node:fs");
let count = 0;
process.on("SIGINT", () => {
  if (count++ === 0) setTimeout(() => { fs.writeFileSync(${JSON.stringify(at("command.json"))}, JSON.stringify({ count, at: Date.now() })); process.exit(7); }, 500);
});
fs.writeFileSync(${JSON.stringify(at("command-started"))}, "");
setInterval(() => {}, 1000);
`);
  fs.writeFileSync(at("run.js"), `
const { runVideoCommand } = require(${JSON.stringify(path.join(__dirname, "..", "video.js"))});
const system = { startedMs: 5000, release: () => "25.6.0", wake: async () => {}, mainWindow: async () => ({ id: 7 }),
  windows: async () => [], binary: async () => ${JSON.stringify(helper.file)}, spawn: ${RUN_BY_NODE}, say: () => {}, captures: ${JSON.stringify(at("captures"))} };
runVideoCommand({ file: ${JSON.stringify(at("video.mov"))}, screen: true, command: [process.execPath, ${JSON.stringify(at("command.js"))}] }, system)
  .then((result) => { process.exitCode = result.status; });
`);
  // A group of its own, as a terminal's foreground job is: Ctrl-C signals the whole group.
  const run = spawn(process.execPath, [at("run.js")], { detached: true, stdio: "ignore" });
  const ended = new Promise((resolve) => run.on("exit", (code) => resolve(code)));
  t.after(() => { try { process.kill(-run.pid, "SIGKILL"); } catch {} });
  for (const until = Date.now() + 5000; !fs.existsSync(at("command-started")) && Date.now() < until;) await new Promise((r) => setTimeout(r, 50));
  process.kill(-run.pid, "SIGINT");
  assert.equal(await ended, 7, "the run exits with the command's status");
  const command = JSON.parse(fs.readFileSync(at("command.json"), "utf8"));
  assert.equal(command.count, 1, "the command got one SIGINT");
  assert.ok(Number(fs.readFileSync(at("stopped"), "utf8")) >= command.at, "the recording was stopped after the command ended");
});

// Writes run.js beside `helper`: it records around `command` with runVideoCommand and exits with
// the command's status, `then` (code) run once the recording has started.
function videoRun(helper, command, then = "") {
  const at = (name) => path.join(helper.folder, name);
  fs.writeFileSync(at("run.js"), `
const { runVideoCommand } = require(${JSON.stringify(path.join(__dirname, "..", "video.js"))});
const system = { startedMs: 5000, release: () => "25.6.0", wake: async () => {}, mainWindow: async () => ({ id: 7 }),
  windows: async () => [], binary: async () => ${JSON.stringify(helper.file)}, spawn: ${RUN_BY_NODE}, say: () => {}, captures: ${JSON.stringify(at("captures"))} };
runVideoCommand({ file: ${JSON.stringify(at("video.mov"))}, screen: true, command: ${JSON.stringify(command)} }, system)
  .then((result) => { process.exitCode = result.status; });
${then}
`);
  // A group of its own, as a terminal's foreground job is: Ctrl-C signals the whole group.
  const run = spawn(process.execPath, [at("run.js")], { detached: true, stdio: "ignore" });
  const ended = new Promise((resolve) => run.on("exit", (code, signal) => resolve(code ?? signal)));
  return { run, ended };
}

async function until(test, ms = 5000) {
  for (const end = Date.now() + ms; !test() && Date.now() < end;) await new Promise((r) => setTimeout(r, 50));
  return test();
}

const running = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
};

// A command that notes its process, counts `signal`, and after the first takes 300 ms to clean
// up, notes the count and exits 7.
function countingCommand(helper, signal) {
  const at = (name) => path.join(helper.folder, name);
  fs.writeFileSync(at("command.js"), `
const fs = require("node:fs");
let count = 0;
process.on(${JSON.stringify(signal)}, () => {
  if (count++ === 0) setTimeout(() => { fs.writeFileSync(${JSON.stringify(at("command.json"))}, JSON.stringify({ count })); process.exit(7); }, 300);
});
fs.writeFileSync(${JSON.stringify(at("command.pid"))}, String(process.pid));
setInterval(() => {}, 1000);
`);
  return at("command.js");
}

test("Ctrl-C on a recording around a shell reaches the shell's own command once", { timeout: 20000 }, async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const command = countingCommand(helper, "SIGINT");
  // A second command after it keeps the shell from replacing itself with the first.
  const { run, ended } = videoRun(helper, ["/bin/sh", "-c", `"${process.execPath}" "${command}"; exit $?`]);
  t.after(() => { try { process.kill(-run.pid, "SIGKILL"); } catch {} });
  assert.ok(await until(() => fs.existsSync(path.join(helper.folder, "command.pid"))), "the command started");
  process.kill(-run.pid, "SIGINT");
  const code = await Promise.race([ended, new Promise((r) => setTimeout(() => r("still running 5 s after Ctrl-C"), 5000))]);
  t.after(() => { try { process.kill(Number(fs.readFileSync(path.join(helper.folder, "command.pid"), "utf8")), "SIGKILL"); } catch {} });
  assert.equal(code, 7, "the run exits with the shell's status, its command's");
  assert.equal(JSON.parse(fs.readFileSync(path.join(helper.folder, "command.json"), "utf8")).count, 1, "the command got one SIGINT");
});

test("SIGQUIT on a recording around a command reaches the command", { timeout: 20000 }, async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const { run, ended } = videoRun(helper, [process.execPath, countingCommand(helper, "SIGQUIT")]);
  t.after(() => { try { process.kill(-run.pid, "SIGKILL"); } catch {} });
  assert.ok(await until(() => fs.existsSync(path.join(helper.folder, "command.pid"))), "the command started");
  t.after(() => { try { process.kill(Number(fs.readFileSync(path.join(helper.folder, "command.pid"), "utf8")), "SIGKILL"); } catch {} });
  process.kill(-run.pid, "SIGQUIT");
  assert.equal(await ended, 7, "the run exits with the command's status");
  assert.equal(JSON.parse(fs.readFileSync(path.join(helper.folder, "command.json"), "utf8")).count, 1);
});

test("a run that dies while it records around a command takes the command's processes with it", { timeout: 20000 }, async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  // The shell's command ignores SIGINT, so only the end of the run can end it.
  const command = path.join(helper.folder, "stubborn.js");
  fs.writeFileSync(command, `process.on("SIGINT", () => {});
require("node:fs").writeFileSync(${JSON.stringify(path.join(helper.folder, "command.pid"))}, String(process.pid));
setInterval(() => {}, 1000);`);
  const { run, ended } = videoRun(helper, ["/bin/sh", "-c", `"${process.execPath}" "${command}"; exit $?`],
    `const fs = require("node:fs");
const wait = setInterval(() => { if (fs.existsSync(${JSON.stringify(path.join(helper.folder, "command.pid"))})) { clearInterval(wait); throw new Error("the run fails"); } }, 50);`);
  t.after(() => { try { process.kill(-run.pid, "SIGKILL"); } catch {} });
  assert.equal(await ended, 1, "the run died of its error");
  // The stand-in helper doesn't watch its run, as the helper does.
  const stand = helper.pid();
  t.after(() => { try { process.kill(stand, "SIGKILL"); } catch {} });
  const pid = Number(fs.readFileSync(path.join(helper.folder, "command.pid"), "utf8"));
  t.after(() => { try { process.kill(pid, "SIGKILL"); } catch {} });
  assert.ok(await until(() => !running(pid), 3000), "the command's process ended with the run");
});

test("the video command says on stderr when it has started recording, and where to", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  let saidBeforeCommand;
  const marker = path.join(helper.folder, "said");
  system.say = (text) => { system.said.push(text); fs.writeFileSync(marker, text); };
  await runVideoCommand({ file: out(helper), screen: true,
    command: [process.execPath, "-e", `process.exit(require("node:fs").existsSync(${JSON.stringify(marker)}) ? 0 : 9)`] }, system)
    .then((result) => { saidBeforeCommand = result.status === 0; });
  assert.equal(system.said[0], `recording ${out(helper)}`);
  assert.ok(saidBeforeCommand, "said before the command started");
  const timed = fakeHelper(t, `
console.log("recording");
setTimeout(() => { console.log(JSON.stringify({ seconds: 0.2, bytes: 10 })); process.exit(0); }, 200);
`);
  const timedSystem = fakeSystem(timed);
  await runVideoCommand({ file: out(timed), seconds: 0.2, screen: true }, timedSystem);
  assert.deepEqual(timedSystem.said, [`recording ${out(timed)}`]);
});

test("a recording around a command that fails as it stops still returns the command's status, and says why it failed", async (t) => {
  const helper = fakeHelper(t, `
process.on("SIGINT", () => { console.error("The recording failed: the window closed"); process.exit(1); });
console.log("recording");
setInterval(() => {}, 1000);
`);
  const system = fakeSystem(helper);
  const result = await runVideoCommand({ file: out(helper), screen: true, command: [process.execPath, "-e", "process.exit(3)"] }, system);
  assert.deepEqual(result, { file: out(helper), status: 3, error: "The recording failed: the window closed" });
  assert.ok(system.said.some((line) => /The recording failed: the window closed/.test(line)), system.said.join("\n"));
});

test("the video-frame command reads a video, a time in seconds and a PNG, or no PNG", () => {
  assert.deepEqual(parseFrameArgs(["a.mov", "1.5", "a.png"]), { file: "a.mov", at: 1.5, png: "a.png" });
  assert.deepEqual(parseFrameArgs(["a.mov", "1.5"]), { file: "a.mov", at: 1.5, png: undefined });
  for (const argv of [[], ["a.mov"], ["a.mov", "x", "a.png"], ["a.mov", "-1", "a.png"], ["a.mov", "1", "a.jpg"], ["a.mp4", "1", "a.png"], ["a.mov", "1", "a.png", "b"]]) {
    assert.throws(() => parseFrameArgs(argv), (e) => e instanceof VideoError && /usage: cli\.js video-frame/.test(e.message), argv.join(" "));
  }
});

test("a frame is saved by the helper at the time asked, and resolves with the time it has and its size", async (t) => {
  const helper = fakeHelper(t, `console.log(JSON.stringify({ at: 1.5, w: 20, h: 10 }));`);
  const video = path.join(helper.folder, "video.mov");
  fs.writeFileSync(video, "");
  const png = path.join(helper.folder, "frames", "one.png");
  assert.deepEqual(await videoFrame(video, 1.5, png, fakeSystem(helper)), { file: png, at: 1.5, w: 20, h: 10 });
  assert.deepEqual(helper.args(), ["frame", video, "1.5", png]);
  assert.ok(fs.existsSync(path.dirname(png)), "the PNG's folder is made");
});

test("a frame on a Mac before macOS 15 is refused, saying so, before the helper is built", async (t) => {
  const helper = fakeHelper(t, `console.log("{}");`);
  const video = path.join(helper.folder, "video.mov");
  fs.writeFileSync(video, "");
  const system = fakeSystem(helper, { release: "23.6.0" });
  await assert.rejects(videoFrame(video, 1, path.join(helper.folder, "a.png"), system), (e) => e instanceof VideoError && /macOS 15 or later/.test(e.message));
  assert.deepEqual(system.calls, []);
});

// Saves an empty PNG where it is asked to, and says what a frame does, failing if the video
// isn't there to read.
const SAVES_A_FRAME = `
const [, video, , png] = process.argv.slice(2);
if (!require("node:fs").existsSync(video)) { console.error("Can't read " + video + " as a video"); process.exit(1); }
require("node:fs").writeFileSync(png, "");
console.log(JSON.stringify({ at: 1.5, w: 20, h: 10, seconds: 3 }));`;

test("with no PNG, a frame goes to the captures folder, named by the time as other captures are, then the video and the time in it", async (t) => {
  const helper = fakeHelper(t, SAVES_A_FRAME);
  const video = path.join(helper.folder, "clip.mov");
  fs.writeFileSync(video, "");
  const system = fakeSystem(helper);
  const frame = await videoFrame(video, 1.5, undefined, system);
  assert.equal(path.dirname(frame.file), system.captures);
  assert.match(path.basename(frame.file), /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}-clip-1\.5s\.png$/);
  assert.equal(helper.args()[3], path.join(system.captures, ".unfinished", path.basename(frame.file)), "written under a hidden name");
  assert.ok(fs.existsSync(frame.file));
});

test("a frame of a video in the captures folder older than 7 days is saved before the folder is pruned", async (t) => {
  const helper = fakeHelper(t, SAVES_A_FRAME);
  const system = fakeSystem(helper);
  fs.mkdirSync(system.captures, { recursive: true });
  const video = path.join(system.captures, "old.mov");
  fs.writeFileSync(video, "");
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(video, old, old);
  const frame = await videoFrame(video, 1.5, undefined, system);
  assert.ok(fs.existsSync(frame.file));
  assert.ok(!fs.existsSync(video), "pruned after the frame was saved");
});

test("a video given no file prunes the captures folder once it has ended, not while it records", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  fs.mkdirSync(system.captures, { recursive: true });
  const old = path.join(system.captures, "old.png");
  fs.writeFileSync(old, "");
  const when = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, when, when);
  const video = await recordVideo(undefined, {}, system);
  t.after(() => video.stop().catch(() => {}));
  assert.ok(fs.existsSync(old), "still there while it records");
  await video.stop();
  assert.ok(!fs.existsSync(old), "pruned once it ended");
});

test("a frame of a video that isn't there is refused before the helper runs", async (t) => {
  const helper = fakeHelper(t, `console.log("{}");`);
  const system = fakeSystem(helper);
  await assert.rejects(videoFrame(path.join(helper.folder, "none.mov"), 1, path.join(helper.folder, "a.png"), system), /No video at/);
  assert.deepEqual(system.calls, []);
});

test("a frame the helper can't save rejects with its reason", async (t) => {
  const helper = fakeHelper(t, `console.error("video.mov is 2.00 s long, so it has no frame at 3 s"); process.exit(1);`);
  const video = path.join(helper.folder, "video.mov");
  fs.writeFileSync(video, "");
  await assert.rejects(videoFrame(video, 3, path.join(helper.folder, "a.png"), fakeSystem(helper)),
    (e) => e instanceof VideoError && e.message === "video.mov is 2.00 s long, so it has no frame at 3 s");
});

const hasDeveloperTools = (() => {
  try { require("node:child_process").execFileSync("xcode-select", ["-p"], { stdio: "ignore" }); return true; } catch { return false; }
})();
// The helper uses SCRecordingOutput, which macOS 15 (Darwin 24) brought: it doesn't build before.
const before15 = Number(os.release().split(".")[0]) < 24;
test("the helper refuses arguments it can't use, with its usage, and a video it can't read",
  { skip: (!hasDeveloperTools && "no developer tools") || (before15 && "the helper needs macOS 15"), timeout: 300000 }, async () => {
  const { execFile } = require("node:child_process");
  const binary = await require("../tools.js").helperBinary(path.join(__dirname, "..", "video.swift"));
  const fails = (args) => new Promise((resolve) => execFile(binary, args, (error, stdout, stderr) => resolve({ error, stderr })));
  for (const args of [[], ["record"], ["record", "a.mov", "window", "x", "3"], ["record", "a.mov", "screen", "0"], ["record", "a.mov", "tab", "3"],
    ["frame", "a.mov", "x", "a.png"], ["frame", "a.mov", "1"]]) {
    const failure = await fails(args);
    assert.equal(failure.error?.code, 1, args.join(" "));
    assert.match(failure.stderr, /^usage: video record/, args.join(" "));
  }
  const missing = await fails(["frame", path.join(os.tmpdir(), "no-such-video.mov"), "1", path.join(os.tmpdir(), "no-such-frame.png")]);
  assert.equal(missing.error?.code, 1);
  assert.match(missing.stderr, /^Can't read .*no-such-video\.mov as a video/);
});

test("the helper's errors end it with status 1 once nothing reads its stderr, as when its run has gone",
  { skip: (!hasDeveloperTools && "no developer tools") || (before15 && "the helper needs macOS 15"), timeout: 300000 }, async () => {
  const binary = await require("../tools.js").helperBinary(path.join(__dirname, "..", "video.swift"));
  const child = spawn(binary, ["frame", path.join(os.tmpdir(), "no-such-video.mov"), "1", path.join(os.tmpdir(), "no-such-frame.png")],
    { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.destroy();
  const [code, signal] = await new Promise((resolve) => child.on("exit", (...ended) => resolve(ended)));
  assert.deepEqual({ code, signal }, { code: 1, signal: null });
});
