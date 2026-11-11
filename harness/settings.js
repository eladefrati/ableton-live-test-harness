"use strict";

// Live's settings, read from Preferences.cfg in the running version's preferences folder
// (~/Library/Preferences/Ableton/Live <version>/), without touching Live's window. The LOM
// doesn't expose them. Live writes Preferences.cfg when its Settings window closes, not when
// a setting changes (seen 2026-11-05); the sample rate is read from Live's log instead,
// which has it within a second.
//
// Preferences.cfg is binary and undocumented; this reading of it was worked out from Live
// 12.4.25b1's files on 2026-11-01:
//   "ab1e5678", u8 format (5), u32 (unknown), u8 0, u8-length root name ("LivePreferences"),
//   i32 count, then count - 1 class definitions, the root's among them:
//     u8 0, u8-length ASCII class name, i32 field count (-1 for List<> and Slot<>), and per
//     field a u32 length and UTF-16LE name, then its type: u8 0 and a u8-length class name,
//     u8 0x30, a type and an i32 (an array), or a one-byte primitive code.
//   Then the values: the root's fields in definition order, class-typed fields inline. A
//   List<> or Slot<> is an i32 (unknown), then items, each u8 0, its u8-length class name,
//   an i32 (unknown) and its fields; an empty name (u8 0, u8 0) ends it. Most settings are
//   items of the root's PreferenceMembers list (SongPrefData among them), which readSetting
//   finds by their class name.
// The values' layout was worked out on 2026-11-05 by walking whole files from the root to
// their last byte (every file at hand from Live 12.2 to 12.4.25b1; 12.0
// and 12.1 files don't define the root). The walk took these sizes: 0x12 float32, 0x15 8
// bytes, 0x16 16 bytes, 0x17 float64, 0x50 and arrays a u32 byte count and the bytes.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { liveApp } = require("./macos.js");
const { run } = require("./tools.js");

// The version of the Live app at `app`, as its Info.plist gives it. A Beta's carries its
// build: "12.4.25b1 (2026-10-28_e04f372900)".
async function liveVersion(app) {
  return (await run("defaults", ["read", `${app}/Contents/Info`, "CFBundleShortVersionString"])).trim();
}

async function preferencesFolder(app) {
  app = app || (await liveApp());
  // The folder is named for the version alone, without a Beta's build.
  const version = (await liveVersion(app)).split(" ")[0];
  return path.join(os.homedir(), "Library", "Preferences", "Ableton", `Live ${version}`);
}

const ARRAY = 0x30;
// Primitive codes by their size in the values: bool, int32, string (u32 count and
// UTF-16LE), 8 bytes (FileRef's OriginalFileSize). Other codes aren't read.
const PRIMITIVES = {
  0x10: (r) => r.u8(),
  0x11: (r) => r.i32(),
  0x14: (r) => r.utf16(r.u32()),
  0x18: (r) => r.skip(8),
};

function reader(buffer) {
  let at = 0;
  const need = (n) => {
    if (at + n > buffer.length) throw new Error("Preferences.cfg ends early");
  };
  return {
    get at() { return at; },
    set at(value) { at = value; },
    u8: () => { need(1); return buffer[at++]; },
    u32: () => { need(4); const v = buffer.readUInt32LE(at); at += 4; return v; },
    i32: () => { need(4); const v = buffer.readInt32LE(at); at += 4; return v; },
    ascii: (n) => { need(n); const v = buffer.toString("latin1", at, at + n); at += n; return v; },
    utf16: (n) => { need(2 * n); const v = buffer.toString("utf16le", at, at + 2 * n); at += 2 * n; return v; },
    skip: (n) => { need(n); at += n; },
  };
}

// { root, classes: Map(name -> [{name, type}] or null for List<>/Slot<>), valuesAt }.
// A type is a class name (string), {array: type, size} or {primitive: code}.
function parseSchema(buffer) {
  const r = reader(buffer);
  if (buffer.length < 4 || buffer.readUInt32BE(0) !== 0xab1e5678) throw new Error("Not a Live Preferences.cfg");
  r.skip(4 + 1 + 4);
  const typeOf = () => {
    const code = r.u8();
    if (code === 0) return r.ascii(r.u8());
    if (code === ARRAY) {
      const type = typeOf();
      return { array: type, size: r.i32() };
    }
    return { primitive: code };
  };
  if (r.u8() !== 0) throw new Error("Preferences.cfg: unexpected header");
  const root = r.ascii(r.u8());
  const count = r.i32();
  const classes = new Map();
  for (let c = 1; c < count; c++) {
    if (r.u8() !== 0) throw new Error("Preferences.cfg: unexpected class definition");
    const name = r.ascii(r.u8());
    const size = r.i32();
    const fields = size < 0 ? null : [];
    for (let i = 0; i < size; i++) fields.push({ name: r.utf16(r.u32()), type: typeOf() });
    classes.set(name, fields);
  }
  return { root, classes, valuesAt: r.at };
}

// The value of field `field` of top-level object `object`: a number, a string, or for a
// class-typed field an object of its fields. Throws on a field it can't read past.
function readSetting(buffer, object, field) {
  const { classes, valuesAt } = parseSchema(buffer);
  const fields = classes.get(object);
  if (!fields) throw new Error(`Preferences.cfg defines no ${object}`);
  const marker = Buffer.concat([Buffer.from([0, object.length]), Buffer.from(object, "latin1")]);
  const start = buffer.indexOf(marker, valuesAt);
  if (start < 0) throw new Error(`Preferences.cfg has no ${object} values`);
  const r = reader(buffer);
  r.at = start + marker.length + 4;
  const read = (type, name) => {
    if (typeof type === "string") {
      const inner = classes.get(type);
      if (!inner) throw new Error(`Preferences.cfg: can't read past ${name} (${type})`);
      return Object.fromEntries(inner.map((f) => [f.name, read(f.type, `${name}.${f.name}`)]));
    }
    const readPrimitive = type.primitive !== undefined && PRIMITIVES[type.primitive];
    if (!readPrimitive) throw new Error(`Preferences.cfg: can't read past ${name} (${JSON.stringify(type)})`);
    return readPrimitive(r);
  };
  for (const f of fields) {
    const value = read(f.type, f.name);
    if (f.name === field) return value;
  }
  throw new Error(`Preferences.cfg: ${object} has no ${field}`);
}

// Settings > Record/Warp/Launch > Bit Depth, by the value Live stores. 1 and 2 were
// matched with the files Live recorded (2026-11-01); 0 for 16-bit is inferred from the
// menu's order, not seen.
const BIT_DEPTHS = { 0: { bits: 16, float: false }, 1: { bits: 24, float: false }, 2: { bits: 32, float: true } };

function parseRecordBitDepth(buffer) {
  const { Value: value } = readSetting(buffer, "SongPrefData", "RecordBitDepth");
  const depth = BIT_DEPTHS[value];
  if (!depth) throw new Error(`Preferences.cfg: unknown record bit depth ${value}`);
  return { ...depth, value };
}

const describeDepth = ({ bits, float }) => `${bits}-bit${float ? " float" : ""}`;

// The bit depth Live records at: { bits, float, value, file }. Live writes Preferences.cfg
// when its Settings window closes, so the file can lag the setting, and a check that needs a
// bit depth also checks the files it records.
async function recordBitDepth({ file } = {}) {
  file = file || path.join(await preferencesFolder(), "Preferences.cfg");
  return { ...parseRecordBitDepth(fs.readFileSync(file)), file };
}

// Resolves if Live records at `bits` (32 means 32-bit float); otherwise rejects, saying
// what to ask the user. Call it before setting up a recording.
async function requireRecordBitDepth(bits, options) {
  const depth = await recordBitDepth(options);
  if (depth.bits !== bits) {
    throw new Error(`This check needs Live to record at ${describeDepth({ bits, float: bits === 32 })}; `
      + `it records at ${describeDepth(depth)}. Ask the user to set Settings > Record/Warp/Launch > `
      + `Bit Depth to ${bits}; don't change it yourself.`);
  }
  return depth;
}

// Settings > Audio > In/Out Sample Rate, in Hz, from the text of Live's log: the last
// "Audio In Out: Sample Rate: <Hz>" line. Live logs one each time its audio engine starts,
// at launch and within a second of a change to the rate. Throws if there is none.
function parseSampleRate(text) {
  const lines = [...text.matchAll(/^[\d\-T:.]+: info: Audio In Out: Sample Rate: (\d+)\s*$/gm)];
  if (!lines.length) throw new Error("Live's log reports no sample rate");
  return Number(lines[lines.length - 1][1]);
}

async function sampleRate({ file } = {}) {
  // Required here, not at the top: log.js requires this file.
  file = file || (await require("./log.js").liveLogFile());
  return { rate: parseSampleRate(fs.readFileSync(file, "utf8")), file };
}

// Resolves if Live runs at `rate` Hz; otherwise rejects, saying what to ask the user. Call
// it before setting up a recording.
async function requireSampleRate(rate, options) {
  const current = await sampleRate(options);
  if (current.rate !== rate) {
    throw new Error(`This check needs Live to run at ${rate} Hz; it runs at ${current.rate} Hz. `
      + `Ask the user to set Settings > Audio > In/Out Sample Rate to ${rate}; don't change it yourself.`);
  }
  return current;
}

module.exports = {
  liveVersion, preferencesFolder, parseSchema, readSetting, parseRecordBitDepth, recordBitDepth,
  requireRecordBitDepth, describeDepth, parseSampleRate, sampleRate, requireSampleRate,
};
