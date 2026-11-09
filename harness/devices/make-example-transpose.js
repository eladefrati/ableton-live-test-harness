#!/usr/bin/env node
"use strict";

// Writes Example Transpose.amxd beside this file: a Max for Live MIDI effect with one
// parameter, Transpose, that adds it to the pitch of each note. The file is committed, so
// run this only after changing the patch. It's the device checks/example-transpose-check.js
// runs on.

const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "Example Transpose.amxd");
const TYPE = "mmmm"; // a MIDI effect

function object(id, text, x, y, numinlets, numoutlets) {
  return { box: { id, maxclass: "newobj", text, numinlets, numoutlets,
    outlettype: Array(numoutlets).fill(""), patching_rect: [x, y, 100, 22] } };
}

function line(from, outlet, to, inlet) {
  return { patchline: { source: [from, outlet], destination: [to, inlet] } };
}

function patcher() {
  const transpose = { box: { id: "transpose", maxclass: "live.numbox", varname: "Transpose",
    numinlets: 1, numoutlets: 2, outlettype: ["", "float"], parameter_enable: 1,
    patching_rect: [160, 100, 44, 15], presentation: 1, presentation_rect: [8, 8, 44, 15],
    saved_attribute_attributes: { valueof: {
      parameter_longname: "Transpose", parameter_shortname: "Transpose", parameter_type: 1,
      parameter_mmin: -24, parameter_mmax: 24, parameter_initial_enable: 1, parameter_initial: [0],
      parameter_unitstyle: 0, parameter_linknames: 1, parameter_invisible: 0, parameter_modmode: 0,
    } } } };
  return {
    fileversion: 1,
    appversion: { major: 8, minor: 1, revision: 2, architecture: "x64", modernui: 1 },
    classnamespace: "box",
    rect: [100, 100, 400, 320],
    openrect: [0, 0, 0, 40],
    openinpresentation: 1,
    devicewidth: 60,
    title: "Example Transpose",
    // All of these keys, as Live's own devices have them: without searchpath, Live crashes
    // loading the device.
    project: { version: 1, creationdate: 0, modificationdate: 0, viewrect: [0, 0, 300, 500],
      autoorganize: 1, hideprojectwindow: 1, showdependencies: 1, autolocalize: 0,
      contents: { patchers: {} }, layout: {}, searchpath: {}, detailsvisible: 0,
      amxdtype: Buffer.from(TYPE).readUInt32BE(0), readonly: 0, devpathtype: 0, devpath: ".",
      sortmode: 0, viewmode: 0 },
    boxes: [
      object("in", "midiin", 20, 20, 1, 1),
      object("parse", "midiparse", 20, 60, 1, 8),
      object("split", "unpack 0 0", 20, 100, 1, 2),
      object("add", "+ 0", 20, 140, 2, 1),
      object("join", "pack 0 0", 20, 180, 2, 1),
      object("format", "midiformat", 20, 220, 7, 2),
      object("out", "midiout", 20, 260, 1, 0),
      transpose,
    ],
    lines: [
      line("in", 0, "parse", 0),
      line("parse", 0, "split", 0),
      line("split", 0, "add", 0),
      line("split", 1, "join", 1),
      line("add", 0, "join", 0),
      line("transpose", 0, "add", 1),
      line("join", 0, "format", 0),
      line("format", 0, "out", 0),
    ],
    parameters: { transpose: ["Transpose", "Transpose", 0], inherited_shortname: 1 },
  };
}

// An .amxd is three chunks, each a 4-byte tag and a little-endian length: "ampf" (the device
// type), "meta" and "ptch" (the patcher, NUL-terminated).
function amxd() {
  const chunk = (tag, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(payload.length);
    return Buffer.concat([Buffer.from(tag, "latin1"), length, payload]);
  };
  const json = Buffer.from(`${JSON.stringify({ patcher: patcher() }, null, 1)}\0`);
  return Buffer.concat([chunk("ampf", Buffer.from(TYPE)), chunk("meta", Buffer.alloc(4)), chunk("ptch", json)]);
}

if (require.main === module) {
  fs.writeFileSync(FILE, amxd());
  console.log(`Wrote ${FILE}`);
}

module.exports = { amxd, FILE };
