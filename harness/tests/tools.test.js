"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { run, escapeXml } = require("../tools.js");

test("run resolves with stdout, taking arguments that aren't strings", async () => {
  assert.equal(await run("/bin/echo", ["a b", 3]), "a b 3\n");
});

test("run rejects with the command and its stderr", async () => {
  await assert.rejects(run("/bin/sh", ["-c", "echo why >&2; exit 3"]), (error) => {
    assert.equal(error.message, "/bin/sh -c echo why >&2; exit 3 failed: why");
    assert.equal(error.cause.code, 3);
    return true;
  });
});

test("run rejects with the reason a command couldn't start", async () => {
  await assert.rejects(run("/no/such/command"), /^Error: \/no\/such\/command failed: .*ENOENT/);
});

test("escapeXml escapes what an attribute or element can't hold as it is", () => {
  assert.equal(escapeXml(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});
