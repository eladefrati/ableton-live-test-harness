"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, main } = require("../quit.js");

test("parseArgs reads --kill and refuses anything else", () => {
  assert.deepEqual(parseArgs([]), { kill: false });
  assert.deepEqual(parseArgs(["--kill"]), { kill: true });
  assert.throws(() => parseArgs(["--suite"]), /Unknown option --suite/);
  assert.throws(() => parseArgs(["--force"]), /Unknown option --force/);
});

// main with stand-ins that record what it does, in order.
function quitting({ pids, stopFails = false }) {
  const done = [];
  const system = {
    say: (text) => done.push(`say ${text}`),
    pidsOf: async () => pids,
    open: async () => { done.push("open"); return { close: () => done.push("close") }; },
    stopLive: async (live, pid, kill) => {
      done.push(`stop ${pid}${kill ? " kill" : ""}`);
      if (stopFails) throw new Error("Live is asking something");
    },
    empty: () => done.push("empty"),
  };
  return { done, system };
}

test("main stops Live and empties the temp folder while it holds the client's port", async () => {
  const { done, system } = quitting({ pids: [41] });
  await main(["--kill"], system);
  assert.deepEqual(done, ["open", "stop 41 kill", "empty", "close", "say ok   Live is quit"]);
});

test("main holds the port to empty the temp folder when Live isn't running too", async () => {
  const { done, system } = quitting({ pids: [] });
  await main([], system);
  assert.deepEqual(done, ["open", "empty", "close", "say ok   Live is not running"]);
});

test("main leaves the temp folder alone when Live couldn't be stopped, and with two Lives touches nothing", async () => {
  const stuck = quitting({ pids: [41], stopFails: true });
  await assert.rejects(main([], stuck.system), /Live is asking something/);
  assert.deepEqual(stuck.done, ["open", "stop 41", "close"]);
  const two = quitting({ pids: [41, 42] });
  await assert.rejects(main([], two.system), /More than one Live/);
  assert.deepEqual(two.done, []);
});
