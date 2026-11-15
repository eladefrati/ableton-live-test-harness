"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inHarnessTemp, emptyHarnessTemp, livePids, keepDisplayOn, MacError } = require("../macos.js");

test("inHarnessTemp takes files inside the root only, through /var's link, and refuses what is missing", () => {
  // Under os.tmpdir(), which is /var/folders/..., a link to /private/var/folders/...
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    const root = path.join(base, "ableton-harness");
    const sibling = path.join(base, "ableton-harness-x");
    fs.mkdirSync(path.join(root, "plugin-a"), { recursive: true });
    fs.mkdirSync(sibling);
    const inside = path.join(root, "plugin-a", "set.als");
    fs.writeFileSync(inside, "");
    fs.writeFileSync(path.join(sibling, "set.als"), "");
    assert.equal(inHarnessTemp(inside, root), true);
    assert.equal(inHarnessTemp(fs.realpathSync(inside), root), true);
    assert.equal(inHarnessTemp(path.join(sibling, "set.als"), root), false);
    assert.equal(inHarnessTemp(root, root), false);
    assert.equal(inHarnessTemp(path.join(root, "plugin-a", "gone.als"), root), false);
    assert.equal(inHarnessTemp("", root), false);
    assert.equal(inHarnessTemp(inside, path.join(base, "no-such-root")), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("emptyHarnessTemp deletes every folder in the temp folder and says how many", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  try {
    fs.mkdirSync(path.join(root, "relaunch-a"));
    fs.mkdirSync(path.join(root, "save-b", "Set Project"), { recursive: true });
    fs.writeFileSync(path.join(root, "save-b", "Set Project", "Set.als"), "");
    const said = [];
    emptyHarnessTemp((text) => said.push(text), root);
    assert.deepEqual(fs.readdirSync(root), []);
    assert.deepEqual(said, [`info deleted 2 items in ${root}`]);
    emptyHarnessTemp((text) => said.push(text), path.join(root, "missing"));
    assert.equal(said.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("livePids reads pgrep's exit 1 as no Live, and refuses to guess on any other failure", async () => {
  const failing = (code) => () => Promise.reject(new Error("pgrep -x Live failed", { cause: { code } }));
  assert.deepEqual(await livePids(() => Promise.resolve("101\n202\n")), [101, 202]);
  assert.deepEqual(await livePids(failing(1)), []);
  await assert.rejects(livePids(failing(3)), (error) => error instanceof MacError && /Can't tell whether Live is running/.test(error.message));
  await assert.rejects(livePids(failing("ENOENT")), MacError);
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function gone(pid) {
  for (const deadline = Date.now() + 2000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 50))) {
    if (!alive(pid)) return true;
  }
  return false;
}

test("keepDisplayOn holds the display on after waking it, until stop", async () => {
  let woke = false;
  const display = await keepDisplayOn({ wake: async () => { woke = true; } });
  assert.ok(woke);
  assert.ok(alive(display.pid));
  display.stop();
  assert.ok(await gone(display.pid));
  display.stop();
});

test("keepDisplayOn lets go of the display when waking it fails", async () => {
  const { spawn } = require("node:child_process");
  let held;
  await assert.rejects(keepDisplayOn({
    hold: () => (held = spawn("sleep", ["30"], { stdio: "ignore" })),
    wake: async () => { throw new MacError("no app is frontmost"); },
  }), /no app is frontmost/);
  assert.ok(await gone(held.pid));
});

// macos.js as it loads over a stand-in for osascript: `answer` is given every AppleScript it
// would run and returns what the script prints; waking the display, a JavaScript, succeeds.
function macOver(answer, jxa = () => "") {
  const childProcess = require("node:child_process");
  const file = require.resolve("../macos.js");
  const [execFile, loaded] = [childProcess.execFile, require.cache[file]];
  childProcess.execFile = (command, args, done) => {
    assert.equal(command, "osascript");
    setImmediate(() => done(null, args[0] === "-l" ? `${jxa(args.slice(4))}\n` : `${answer(args.at(-1))}\n`, ""));
  };
  delete require.cache[file];
  try {
    return require(file);
  } finally {
    childProcess.execFile = execFile;
    require.cache[file] = loaded;
  }
}

// System Events as the scripts of macos.js find it, with Live in front or behind another app.
// `did` lists the scripts that act, in order: every one but those that only look.
function fakeSystemEvents({ front = false } = {}) {
  const did = [];
  const answer = (script) => {
    if (/ get frontmost of process "Live"$/.test(script)) return String(front);
    if (/ get bundle identifier of process "Live"$/.test(script)) return "com.example.live";
    if (/ get bundle identifier of first process whose frontmost is true$/.test(script)) return front ? "com.example.live" : "com.example.terminal";
    did.push(script);
    if (script === 'tell application id "com.example.live" to activate') front = true;
    return "";
  };
  return { did, answer };
}

const ACTIVATE = 'tell application id "com.example.live" to activate';

test("activate calls the function it is given just before it tells Live to activate, and tells Live nothing if the function throws", async () => {
  const events = fakeSystemEvents();
  await macOver(events.answer).activate({ refuse: () => events.did.push("asked") });
  assert.deepEqual(events.did, ["asked", ACTIVATE]);

  const refused = fakeSystemEvents();
  await assert.rejects(macOver(refused.answer).activate({ refuse: () => { throw new Error("stopped"); } }), /^Error: stopped$/);
  assert.deepEqual(refused.did, []);
});

test("typeInLive calls the function it is given before Live is activated and again just before the keys, and types nothing if it throws then", async () => {
  const events = fakeSystemEvents();
  await macOver(events.answer).typeInLive("key code 53", { refuse: () => events.did.push("asked") });
  assert.equal(events.did.length, 4);
  assert.deepEqual(events.did.slice(0, 3), ["asked", ACTIVATE, "asked"]);
  assert.match(events.did[3], /key code 53/);

  // Refused once Live has come forward, as when Stop comes meanwhile.
  const refused = fakeSystemEvents();
  let asked = 0;
  const refuse = () => { if (++asked === 2) throw new Error("stopped"); };
  await assert.rejects(macOver(refused.answer).typeInLive("key code 53", { refuse }), /^Error: stopped$/);
  assert.deepEqual(refused.did, [ACTIVATE]);

  // And with Live in front already, where nothing is activated.
  const inFront = fakeSystemEvents({ front: true });
  await assert.rejects(macOver(inFront.answer).typeInLive("key code 53", { refuse: () => { throw new Error("stopped"); } }), /^Error: stopped$/);
  assert.deepEqual(inFront.did, []);
});

test("typeIfLiveInFront looks for Live in front and types in one script, and activates nothing", async () => {
  for (const front of [true, false]) {
    const events = fakeSystemEvents({ front });
    await macOver(events.answer).typeIfLiveInFront("key code 53");
    assert.deepEqual(events.did, ['tell application "System Events" to if frontmost of process "Live" then key code 53']);
  }
});

test("waitForNoModifiers gives its script the time to wait, and resolves with whether no modifier key was held by then", async () => {
  for (const [said, free] of [["free", true], ["held", false]]) {
    const given = [];
    const mac = macOver(() => "", (args) => { given.push(args); return said; });
    assert.equal(await mac.waitForNoModifiers(2000), free);
    assert.deepEqual(given, [["2000"]]);
  }
});
