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
    assert.equal(error.stderr, "why\n");
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
test("a new build of a helper deletes that helper's other builds no process has used for 7 days, by access or modification, and fails for none of it",
  { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));
  const cache = path.join(folder, "cache");
  const locked = path.join(cache, `one-${"f".repeat(16)}`);
  t.after(() => {
    if (fs.existsSync(locked)) fs.chmodSync(locked, 0o700);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const source = path.join(folder, "one.swift");
  const write = (text) => fs.writeFileSync(source, `print("${text}")\n`);
  const daysAgo = (days) => Date.now() / 1000 - days * 24 * 60 * 60;
  const age = (file, accessed, modified) => fs.utimesSync(file, daysAgo(accessed), daysAgo(modified));
  const entry = (name, accessed, modified) => {
    const file = path.join(cache, name);
    fs.writeFileSync(file, "");
    age(file, accessed, modified);
    return name;
  };
  const cached = () => fs.readdirSync(cache).sort();

  write("first");
  const first = await helperBinary(source, cache);
  age(first, 30, 30);
  const stale = entry(`one-${"a".repeat(16)}`, 8, 8);
  const stalePartial = entry(`one-${"a".repeat(16)}.123.456`, 8, 8);
  // As an older checkout leaves its build: run a day ago, built a month ago.
  const recentlyRun = entry(`one-${"b".repeat(16)}`, 1, 30);
  const changed = entry(`one-${"c".repeat(16)}`, 30, 6);
  // Another helper's builds, and a file that is no build, all stale.
  const otherHelper = entry(`two-${"d".repeat(16)}`, 8, 8);
  const longerName = entry(`one-two-${"e".repeat(16)}`, 8, 8);
  const notBuild = entry("one-notes", 8, 8);
  // One of this helper's stale builds that can't be deleted.
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(locked, "inside"), "");
  age(locked, 8, 8);
  fs.chmodSync(locked, 0o500);
  const all = [path.basename(first), stale, stalePartial, recentlyRun, changed, otherHelper, longerName, notBuild, path.basename(locked)].sort();

  // A build found in the cache deletes nothing.
  assert.equal(await helperBinary(source, cache), first);
  assert.deepEqual(cached(), all);

  // Another process finds the first build in the cache, which marks it used.
  const found = require("node:child_process").execFileSync(process.execPath,
    ["-e", "require(process.argv[1]).helperBinary(process.argv[2], process.argv[3]).then(console.log)", require.resolve("../tools.js"), source, cache],
    { encoding: "utf8" });
  assert.equal(found.trim(), first);

  // A new version of the helper: its build deletes the helper's stale builds and nothing else,
  // and the one it can't delete doesn't fail it.
  write("second");
  const second = await helperBinary(source, cache);
  assert.deepEqual(cached(), [...all.filter((name) => name !== stale && name !== stalePartial), path.basename(second)].sort());
  assert.equal(await run(first), "first\n");
  assert.equal(await run(second), "second\n");
});

test("a build that another process deletes as this process first finds it is built again",
  { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const cache = path.join(folder, "cache");
  const source = path.join(folder, "one.swift");
  fs.writeFileSync(source, 'print("one")\n');
  const built = await helperBinary(source, cache);
  // In a process of its own, which hasn't found the build yet: the build is deleted just as
  // the process marks it, as a prune in another process would.
  const found = require("node:child_process").execFileSync(process.execPath, ["-e", `
    const fs = require("node:fs");
    const utimes = fs.utimesSync;
    fs.utimesSync = (file, ...times) => { fs.rmSync(file, { force: true }); return utimes(file, ...times); };
    require(process.argv[1]).helperBinary(process.argv[2], process.argv[3]).then((binary) => console.log(binary));
  `, require.resolve("../tools.js"), source, cache], { encoding: "utf8" });
  assert.equal(found.trim(), built);
  assert.equal(await run(built), "one\n");
});

test("escapeXml escapes what an attribute or element can't hold as it is", () => {
  assert.equal(escapeXml(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});
