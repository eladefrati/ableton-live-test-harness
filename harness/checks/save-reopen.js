#!/usr/bin/env node
"use strict";

// Checks the harness's save and reopen path, which goes through Live's menus (macos.js):
// saves the open set as a new set in a temporary folder, changes it, reopens the file
// discarding the change, and checks the saved state came back. This REPLACES the open set
// with the temporary one; the file it was opened from is untouched. The folder stays behind
// in the harness's temp folder (the set is still open in Live); relaunch.js clears it. Exits
// 1 on failure.

const { connect } = require("../live.js");
const { saveSetAs, saveSet, openSetAndWait, windowTitle, sameFile, tempFolder } = require("../macos.js");

async function main() {
  const live = await connect({ timeout: 3000 });
  const folder = tempFolder("save-reopen-");
  try {
    const name = "harness-save-reopen";
    const file = await saveSetAs(folder, name);
    if ((await windowTitle()) !== name) throw new Error(`Live's window shows ${await windowTitle()}, not ${name}`);
    if (!sameFile(await live.get("song", "file_path"), file)) throw new Error("Live reports another file path");

    const saved = await live.get("song", "tempo");
    const changed = saved === 120 ? 121 : 120;
    live.set("song", "tempo", changed);
    await live.sync();
    await saveSet(file);
    live.set("song", "tempo", saved);
    await live.sync();
    await openSetAndWait(live, file); // discards the unsaved change back to `saved`
    const tempo = await live.get("song", "tempo");
    const pass = tempo === changed;
    console.log(`${pass ? "PASS" : "FAIL"}: saved tempo ${changed}, changed to ${saved} unsaved, reopened with ${tempo}`);
    if (!pass) process.exitCode = 1;
  } finally {
    live.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
