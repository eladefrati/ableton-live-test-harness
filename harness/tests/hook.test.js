"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHook } = require("../max/hook.js");

function FakeLiveAPI(path) {
  this.unquotedpath = path === "this_device" ? FakeLiveAPI.devicePath : "";
}

test("reports carry the device's track and device index from its Live path", () => {
  const sent = [];
  const hook = makeHook((list) => sent.push(list), FakeLiveAPI);
  FakeLiveAPI.devicePath = "live_set tracks 4 devices 1";
  hook.report("status", "ready: 5 items");
  FakeLiveAPI.devicePath = "live_set tracks 2 devices 0 chains 1 devices 3";
  hook.report("check", 1, "ok");
  assert.deepEqual(sent, [
    ["/hook/status", 4, 1, "ready: 5 items"],
    ["/hook/check", 2, 0, 1, "ok"],
  ]);
});

test("a device with no Live path reports -1 indices", () => {
  const sent = [];
  FakeLiveAPI.devicePath = "";
  makeHook((list) => sent.push(list), FakeLiveAPI).report("status", "x");
  assert.deepEqual(sent, [["/hook/status", -1, -1, "x"]]);
});

test("a device on a return track or the main track reports -1 indices", () => {
  const sent = [];
  const hook = makeHook((list) => sent.push(list), FakeLiveAPI);
  FakeLiveAPI.devicePath = "live_set return_tracks 0 devices 1";
  hook.report("status", "x");
  FakeLiveAPI.devicePath = "live_set master_track devices 0";
  hook.report("status", "y");
  assert.deepEqual(sent, [["/hook/status", -1, -1, "x"], ["/hook/status", -1, -1, "y"]]);
});
