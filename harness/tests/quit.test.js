"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../quit.js");

test("parseArgs reads --kill and refuses anything else", () => {
  assert.deepEqual(parseArgs([]), { kill: false });
  assert.deepEqual(parseArgs(["--kill"]), { kill: true });
  assert.throws(() => parseArgs(["--suite"]), /Unknown option --suite/);
  assert.throws(() => parseArgs(["--force"]), /Unknown option --force/);
});
