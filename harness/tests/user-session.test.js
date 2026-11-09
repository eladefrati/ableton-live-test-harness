"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { jobPlist, runInUserSession } = require("../user-session.js");

test("jobPlist passes each argument as its own string, escaped", () => {
  const xml = jobPlist("local.x", "/tmp/a&b", "auval", ["-v", "aufx", "<x>"]);
  assert.match(xml, /<string>sh<\/string><string>auval<\/string><string>-v<\/string><string>aufx<\/string><string>&lt;x&gt;<\/string>/);
  assert.match(xml, /<key>WorkingDirectory<\/key><string>\/tmp\/a&amp;b<\/string>/);
});

// These start real launchd jobs in this user's GUI domain; they need a logged-in user.
test("a job in the GUI session returns the command's stdout", async () => {
  const out = await runInUserSession("/bin/sh", ["-c", "echo one; echo two >&2", "sh"], { viaJob: true });
  assert.equal(out, "one\n");
});

test("a job in the GUI session that fails rejects with its exit status and stderr", async () => {
  await assert.rejects(
    runInUserSession("/bin/sh", ["-c", "echo out; echo broken >&2; exit 3", "sh"], { viaJob: true }),
    /failed \(exit status 3\): broken/,
  );
});

test("a command that fails names the last line of its stdout when stderr is empty, in or out of a job", async () => {
  const script = ["-c", "echo testing; echo \"FATAL ERROR: didn't find the component\"; exit 2", "sh"];
  await assert.rejects(runInUserSession("/bin/sh", script), /failed.*: FATAL ERROR: didn't find the component$/);
  await assert.rejects(runInUserSession("/bin/sh", script, { viaJob: true }), /failed.*: FATAL ERROR: didn't find the component$/);
});
