"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { VideoError, parseVideoArgs, recordVideo, runVideoCommand, parseFrameArgs, videoFrame } = require("../video.js");

// A stand-in for the video helper: a Node script that saves its arguments to `args.json` beside
// itself and then does what `body` says.
function fakeHelper(t, body) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "video-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, "helper.js");
  fs.writeFileSync(file, `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(path.join(folder, "args.json"))}, JSON.stringify(process.argv.slice(2)));
require("node:fs").writeFileSync(${JSON.stringify(path.join(folder, "pid"))}, String(process.pid));
${body}
`);
  fs.chmodSync(file, 0o755);
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

function fakeSystem(helper, { release = "25.6.0", windows = [{ id: 7, title: "Set", layer: 0 }], startedMs = 5000 } = {}) {
  const calls = [];
  return {
    calls,
    startedMs,
    release: () => release,
    wake: async () => { calls.push("wake"); },
    mainWindow: async () => { calls.push("mainWindow"); return { id: 7 }; },
    windows: async () => { calls.push("windows"); return windows; },
    binary: async () => { calls.push("binary"); return helper.file; },
    spawn: (...args) => spawn(...args),
  };
}

const out = (helper, name = "video.mov") => path.join(helper.folder, "out", name);

test("the video command reads a file, a length, a window or the screen, and a command after --", () => {
  assert.deepEqual(parseVideoArgs(["a.mov"]), { file: "a.mov", seconds: undefined, window: undefined, screen: false, command: [] });
  assert.deepEqual(parseVideoArgs(["a.mov", "--seconds", "2.5", "--window", "12"]),
    { file: "a.mov", seconds: 2.5, window: 12, screen: false, command: [] });
  assert.deepEqual(parseVideoArgs(["--screen", "a.mov", "--", "node", "check.js", "--tempo", "97"]),
    { file: "a.mov", seconds: undefined, window: undefined, screen: true, command: ["node", "check.js", "--tempo", "97"] });
});

test("the video command refuses what it can't record, saying how to call it", () => {
  for (const argv of [
    [], ["a.png"], ["a.mov", "b.mov"], ["a.mov", "--window", "3", "--screen"], ["a.mov", "--seconds", "0"],
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

test("a window given by id must be one of Live's on screen", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper, { windows: [{ id: 3 }] });
  await assert.rejects(recordVideo(out(helper), { window: 4 }, system), /Live has no window 4 on screen/);
  const video = await recordVideo(out(helper), { window: 3, seconds: 2 }, system);
  assert.deepEqual(helper.args().slice(2), ["window", "3", "2"]);
  await video.stop();
});

test("the screen is recorded after waking the display", async (t) => {
  const helper = fakeHelper(t, RECORDS_UNTIL_SIGINT);
  const system = fakeSystem(helper);
  const video = await recordVideo(out(helper), { screen: true }, system);
  assert.deepEqual(helper.args().slice(2), ["screen", "600"]);
  assert.deepEqual(system.calls, ["wake", "binary"]);
  await video.stop();
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
  system.spawn = (...args) => (child = spawn(...args));
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

test("the video-frame command reads a video, a time in seconds and a PNG", () => {
  assert.deepEqual(parseFrameArgs(["a.mov", "1.5", "a.png"]), { file: "a.mov", at: 1.5, png: "a.png" });
  for (const argv of [[], ["a.mov", "1"], ["a.mov", "x", "a.png"], ["a.mov", "-1", "a.png"], ["a.mov", "1", "a.jpg"], ["a.mp4", "1", "a.png"], ["a.mov", "1", "a.png", "b"]]) {
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
  await assert.rejects(videoFrame(video, 3, path.join(helper.folder, "a.png"), fakeSystem(helper)), (e) => e instanceof VideoError && /no frame at 3 s/.test(e.message));
});

const hasDeveloperTools = (() => {
  try { require("node:child_process").execFileSync("xcode-select", ["-p"], { stdio: "ignore" }); return true; } catch { return false; }
})();
test("the helper refuses arguments it can't use, with its usage, and a video it can't read",
  { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async () => {
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
