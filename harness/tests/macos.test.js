"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inHarnessTemp } = require("../macos.js");

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
