"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { amxd, FILE } = require("../devices/make-example-transpose.js");

test("the committed example device is what its script writes", () => {
  assert.ok(amxd().equals(fs.readFileSync(FILE)), "run node harness/devices/make-example-transpose.js");
});
