"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { logStamp, parseMaxMessages } = require("../log.js");

// Lines as Live 12.4.25b1 wrote them.
const LOG = `2026-10-31T08:00:00.000000: info: Started: Live 12.4.25b1 Build: 2026-10-28_e04f372900
2026-10-31T11:18:03.628000: error: Message from Max:  jsliveapi: get: no valid object set
2026-10-31T11:18:04.100000: info: Python: INFO:abletonosc:751 - Getting property for track: arm = False
2026-10-31T11:19:00.000001: error: Message from Max:  print: hello
`;

test("logStamp writes local time as the log does", () => {
  assert.equal(logStamp(new Date(2026, 9, 31, 11, 18, 3, 628)), "2026-10-31T11:18:03.628");
});

test("parseMaxMessages keeps Max lines from `since` on", () => {
  assert.deepEqual(parseMaxMessages(LOG), [
    { at: "2026-10-31T11:18:03.628000", level: "error", text: "jsliveapi: get: no valid object set" },
    { at: "2026-10-31T11:19:00.000001", level: "error", text: "print: hello" },
  ]);
  assert.deepEqual(parseMaxMessages(LOG, new Date(2026, 9, 31, 11, 18, 3, 628)).length, 2);
  assert.deepEqual(parseMaxMessages(LOG, new Date(2026, 9, 31, 11, 18, 3, 629)).map((m) => m.text),
    ["print: hello"]);
});

test("parseMaxMessages without `since` keeps only the last launch's lines", () => {
  const twoLaunches = `${LOG}2026-11-01T22:00:00.000000: info: Started: Live 12.4.25b1 Build: 2026-10-28_e04f372900
2026-11-01T22:01:00.000000: error: Message from Max:  v8: ReferenceError
`;
  assert.deepEqual(parseMaxMessages(twoLaunches).map((m) => m.text), ["v8: ReferenceError"]);
  assert.equal(parseMaxMessages(twoLaunches, 0).length, 3);
});
