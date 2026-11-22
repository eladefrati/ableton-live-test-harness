"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { settingsLines } = require("../doctor.js");

const two = ["/Applications/Ableton Live 12 Standard.app", "/Applications/Ableton Live 12 Suite.app"];

test("settingsLines says what each setting does when set, and what is off without it", () => {
  const lines = settingsLines(JSON.stringify({ app: "/", remote: "user@second-mac", clickHost: "second-mac" }), two);
  assert.deepEqual(lines, [
    "info app: relaunch.js starts /",
    "info remote: remote.sh runs on user@second-mac",
    "info clickHost: device-ui.js clicks without asking on second-mac only",
  ]);
  const none = settingsLines(null, [two[0]]);
  assert.match(none[0], /no harness\/local.json/);
  assert.match(none[1], /app is not set: relaunch.js starts the running Live, else the only one installed/);
  assert.match(none[2], /remote is not set/);
  assert.match(none[3], /clickHost is not set/);
});

test("settingsLines warns when Live can't be chosen, an app is missing, a key is unknown or the file is broken", () => {
  assert.match(settingsLines("{}", two)[0], /^warn app is not set and 2 Lives are installed/);
  assert.match(settingsLines(JSON.stringify({ app: "/no/such/Live.app" }), two)[0], /^warn app: \/no\/such\/Live.app isn't installed/);
  assert.match(settingsLines(JSON.stringify({ clickhost: "x" }), [two[0]]).at(-1), /keys the harness doesn't read: clickhost/);
  assert.deepEqual(settingsLines("{", two).length, 1);
  assert.match(settingsLines("{", two)[0], /isn't valid JSON/);
  assert.match(settingsLines("[]", two)[0], /isn't a JSON object/);
});
