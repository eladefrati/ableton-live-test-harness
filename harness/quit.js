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

async function main(argv) {
  const say = (text) => console.log(text);
  const { kill } = parseArgs(argv);
  const pids = await livePids();
  if (pids.length > 1) throw new Error("More than one Live is running: the harness can't tell them apart");
  if (pids.length === 0) {
    emptyHarnessTemp(say);
    say("ok   Live is not running");
    return;
  }
  const live = await connect({ timeout: 1000 });
  try {
    await stop(live, pids[0], kill, say);
  } finally {
    live.close();
  }
  emptyHarnessTemp(say);
  say("ok   Live is quit");
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
