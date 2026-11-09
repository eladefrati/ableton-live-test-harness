"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { encode, decode, float, double } = require("../osc.js");

test("round-trips every type the client sends", () => {
  const args = [7, -3, 0.5, "abc", true, false, null];
  const { address, args: back } = decode(encode("/live/test", args));
  assert.equal(address, "/live/test");
  assert.deepEqual(back, args);
});

test("pads strings and the type tag to four bytes", () => {
  const buffer = encode("/abc", ["abcd"]);
  // "/abc" + 4 NULs, ",s" + 2 NULs, "abcd" + 4 NULs
  assert.equal(buffer.length, 8 + 4 + 8);
});

test("integers encode as int32 unless wrapped", () => {
  assert.equal(encode("/a", [4]).toString("latin1", 4, 6), ",i");
  assert.equal(encode("/a", [float(4)]).toString("latin1", 4, 6), ",f");
  assert.equal(encode("/a", [double(4)]).toString("latin1", 4, 6), ",d");
  assert.equal(decode(encode("/a", [double(0.1)])).args[0], 0.1);
});

test("non-integers encode as float32", () => {
  assert.equal(decode(encode("/a", [0.1])).args[0], Math.fround(0.1));
});

test("rejects values it cannot encode", () => {
  assert.throws(() => encode("/a", [{}]), TypeError);
});
