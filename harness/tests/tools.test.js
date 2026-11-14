"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run, helperBinary, escapeXml } = require("../tools.js");

test("run resolves with stdout, taking arguments that aren't strings", async () => {
  assert.equal(await run("/bin/echo", ["a b", 3]), "a b 3\n");
});

test("run gives the command the environment it is given, in place of this process's", async () => {
  process.env.HARNESS_TEST_INHERITED = "inherited";
  try {
    const said = (options) => run("/bin/sh", ["-c", "echo ${HARNESS_TEST_INHERITED:-none} ${HARNESS_TEST_GIVEN:-none}"], options);
    assert.equal(await said(), "inherited none\n");
    assert.equal(await said({ env: { HARNESS_TEST_GIVEN: "given" } }), "none given\n");
  } finally {
    delete process.env.HARNESS_TEST_INHERITED;
  }
});

test("run rejects with the command and its stderr", async () => {
  await assert.rejects(run("/bin/sh", ["-c", "echo why >&2; exit 3"]), (error) => {
    assert.equal(error.message, "/bin/sh -c echo why >&2; exit 3 failed: why");
    assert.equal(error.cause.code, 3);
    return true;
  });
});

test("run hands the command's process to `started`, and rejects with the signal that ended the command", async () => {
  await assert.rejects(run("/bin/sleep", ["5"], { started: (child) => child.kill("SIGUSR2") }), (error) => error.cause.signal === "SIGUSR2");
});

test("run rejects with the reason a command couldn't start", async () => {
  await assert.rejects(run("/no/such/command"), /^Error: \/no\/such\/command failed: .*ENOENT/);
});

// Builds real helpers with swiftc.
const hasDeveloperTools = (() => {
  try { require("node:child_process").execFileSync("xcode-select", ["-p"], { stdio: "ignore" }); return true; } catch { return false; }
})();
test("helperBinary deletes the builds not used for 7 days, counting from their last use, never the one it returns",
  { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const cache = path.join(folder, "cache");
  const [one, two] = ["one", "two"].map((name) => {
    const source = path.join(folder, `${name}.swift`);
    fs.writeFileSync(source, `print("${name}")\n`);
    return source;
  });
  const DAY = 24 * 60 * 60;
  const age = (file, days) => fs.utimesSync(file, Date.now() / 1000 - days * DAY, Date.now() / 1000 - days * DAY);
  const cached = () => fs.readdirSync(cache).sort();

  const [builtOne, builtTwo] = [await helperBinary(one, cache), await helperBinary(two, cache)];
  // Built a month ago and used since only by the call below: in use, so kept.
  age(builtOne, 30);
  age(builtTwo, 30);
  const recent = path.join(cache, "recent-0123456789abcdef");
  const stale = path.join(cache, "stale-0123456789abcdef");
  fs.writeFileSync(recent, "");
  fs.writeFileSync(stale, "");
  age(recent, 6);
  age(stale, 8);
  assert.equal(await helperBinary(one, cache), builtOne);
  assert.deepEqual(cached(), [path.basename(builtOne), path.basename(recent)].sort());

  // Two's build is gone, so it is built again; one's, a month old but used a moment ago, stays.
  assert.equal(await helperBinary(two, cache), builtTwo);
  assert.deepEqual(cached(), [path.basename(builtOne), path.basename(builtTwo), path.basename(recent)].sort());
  assert.equal(await run(builtOne), "one\n");
});

test("escapeXml escapes what an attribute or element can't hold as it is", () => {
  assert.equal(escapeXml(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});
