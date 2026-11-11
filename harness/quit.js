#!/usr/bin/env node
"use strict";

// Quits Live and leaves it quit, for when the user asks for that. Live is stopped as
// relaunch.js stops it before starting it again (stop there): the transport is stopped,
// "Save changes?" gets Don't Save and "delete the temporary files?" gets Delete, any other
// dialog stops the run with Live left as it is, and a Live still running 10 s after the
// quit or the last answer is killed. Then its recovery data is moved aside, its Temp
// Projects are deleted and the harness's temp folder is emptied, as relaunch.js empties it.
// Refuses an option it doesn't know.
//
//   node harness/quit.js          quit Live if it runs
//   node harness/quit.js --kill   kill Live without asking it to quit (it hangs)

const { connect } = require("./live.js");
const { stop } = require("./relaunch.js");
const { livePids, emptyHarnessTemp } = require("./macos.js");

// The options: { kill }. Refuses anything else, since quitting discards the open set.
function parseArgs(argv) {
  const options = { kill: false };
  for (const arg of argv) {
    if (arg === "--kill") options.kill = true;
    else throw new Error(`Unknown option ${arg}: quit.js takes --kill`);
  }
  return options;
}

// `system` is what main uses of the machine and of Live, so a test can stand in for it.
async function main(argv, system = {}) {
  const {
    say = (text) => console.log(text), pidsOf = livePids, open = () => connect({ timeout: 1000 }),
    stopLive = stop, empty = emptyHarnessTemp,
  } = system;
  const { kill } = parseArgs(argv);
  const pids = await pidsOf();
  if (pids.length > 1) throw new Error("More than one Live is running: the harness can't tell them apart");
  // UDP 11001 is held throughout, as relaunch.js holds it: every check holds it while it
  // runs, so none is saving a set into the temp folder while it is emptied.
  const live = await open();
  try {
    if (pids.length === 1) await stopLive(live, pids[0], kill, say);
    empty(say);
  } finally {
    live.close();
  }
  say(pids.length === 1 ? "ok   Live is quit" : "ok   Live is not running");
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
