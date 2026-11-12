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
