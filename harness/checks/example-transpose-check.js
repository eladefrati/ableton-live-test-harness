#!/usr/bin/env node
"use strict";

// A check on device-checks.js, for a Max for Live device: the shape of a project's check,
// runnable as it stands on the Example Transpose device in harness/devices. Add that folder
// to Live's Places first. Exits 1 if any case fails.
//
// To use it, copy it to a project's tests/live/, name your device and builds folder, and
// replace the cases. `build` names the file to load; leave it out if your builds are named
// `<device> YYYY.MM.DD.N.amxd`, and the highest version is loaded.

const path = require("node:path");

// In a project's tests/live/, fall back to the clone's harness folder instead of this one.
const HARNESS = process.env.LIVE_HARNESS || path.resolve(__dirname, "..");
const { main } = require(path.join(HARNESS, "device-checks.js"));

const octaveUp = (notes) => notes.map((n) => ({ ...n, pitch: n.pitch + 12 }));

main([
  { name: "plays the clip as written", settings: { Transpose: 0 }, expect: (ctx) => ctx.played },
  { name: "transposes up an octave", settings: { Transpose: 12 }, expect: (ctx) => octaveUp(ctx.played) },
], {
  device: "Example Transpose",
  builds: path.join(HARNESS, "devices"),
  build: "Example Transpose.amxd",
});
