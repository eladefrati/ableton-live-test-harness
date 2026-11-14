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
test("helperBinary deletes, after it builds, what no process has used for 7 days, by access or modification, and fails for none of it",
  { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));
  const cache = path.join(folder, "cache");
  const locked = path.join(cache, "locked-0123456789abcdef");
  t.after(() => {
    if (fs.existsSync(locked)) fs.chmodSync(locked, 0o700);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const [one, two] = ["one", "two"].map((name) => {
    const source = path.join(folder, `${name}.swift`);
    fs.writeFileSync(source, `print("${name}")\n`);
    return source;
  });
  const daysAgo = (days) => Date.now() / 1000 - days * 24 * 60 * 60;
  const age = (file, accessed, modified) => fs.utimesSync(file, daysAgo(accessed), daysAgo(modified));
  const entry = (name, accessed, modified) => {
    const file = path.join(cache, name);
    fs.writeFileSync(file, "");
    age(file, accessed, modified);
    return name;
  };
  const cached = () => fs.readdirSync(cache).sort();

  const builtOne = await helperBinary(one, cache);
  age(builtOne, 30, 30);
  const stale = entry("stale-0123456789abcdef", 8, 8);
  // As an older checkout leaves its build: run a day ago, built a month ago.
  const recentlyRun = entry("run-0123456789abcdef", 1, 30);
  const changed = entry("changed-0123456789abcdef", 30, 6);
  // Stale, and can't be deleted.
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(locked, "inside"), "");
  age(locked, 8, 8);
  fs.chmodSync(locked, 0o500);
  const all = [path.basename(builtOne), stale, recentlyRun, changed, path.basename(locked)].sort();

  // A build found in the cache deletes nothing.
  assert.equal(await helperBinary(one, cache), builtOne);
  assert.deepEqual(cached(), all);

  // Another process finds one's build in the cache, which marks it used.
  const found = require("node:child_process").execFileSync(process.execPath,
    ["-e", "require(process.argv[1]).helperBinary(process.argv[2], process.argv[3]).then(console.log)", require.resolve("../tools.js"), one, cache],
    { encoding: "utf8" });
  assert.equal(found.trim(), builtOne);

  // A new build deletes the stale entry, and the one it can't delete doesn't fail it.
  const builtTwo = await helperBinary(two, cache);
  assert.deepEqual(cached(), [...all.filter((name) => name !== stale), path.basename(builtTwo)].sort());
  assert.equal(await run(builtOne), "one\n");
});

test("escapeXml escapes what an attribute or element can't hold as it is", () => {
  assert.equal(escapeXml(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});
