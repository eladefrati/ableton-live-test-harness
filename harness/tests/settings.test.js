"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseSchema, readSetting, parseRecordBitDepth, requireRecordBitDepth, parseSampleRate, requireSampleRate,
} = require("../settings.js");

// Live's log around a change of sample rate, as Live 12.4.25b1 wrote it.
const LOG = [
  "2026-11-05T20:00:00.000001: info: Audio In Out: Sample Rate: 44100",
  "2026-11-05T20:00:00.000002: info: Audio In Out: Output Buffer Size: 128 Samples",
  "2026-11-05T20:00:01.000001: info: CoreAudio: OnDeviceChange. Device: Built-in Output (0 In, 2 Out)",
  "2026-11-05T20:00:01.000002: info: Audio In Out: Sample Rate: 48000",
  "2026-11-05T20:00:01.000003: info: Audio In Out: Output Buffer Size: 128 Samples",
  "",
].join("\n");

test("parseSampleRate reads the last sample rate Live logged", () => {
  assert.equal(parseSampleRate(LOG), 48000);
  assert.throws(() => parseSampleRate("2026-11-05T20:00:00.000002: info: Audio In Out: Output Channels: 2\n"),
    /reports no sample rate/);
});

test("requireSampleRate refuses another sample rate, saying what to ask for", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-settings-"));
  try {
    const file = path.join(dir, "Log.txt");
    fs.writeFileSync(file, LOG);
    await assert.rejects(requireSampleRate(44100, { file }),
      /needs Live to run at 44100 Hz; it runs at 48000 Hz\. Ask the user to set Settings > Audio > In\/Out Sample Rate to 44100/);
    assert.equal((await requireSampleRate(48000, { file })).rate, 48000);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// A Preferences.cfg laid out as Live 12.4.25b1 writes one (see settings.js), cut down to a
// few classes. A real file can't be a fixture: it holds the account's email and tokens.
const u8 = (v) => Buffer.from([v]);
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const ascii = (s) => Buffer.concat([u8(s.length), Buffer.from(s, "latin1")]);
const utf16 = (s) => Buffer.concat([i32(s.length), Buffer.from(s, "utf16le")]);
const classRef = (name) => Buffer.concat([u8(0), ascii(name)]);
const def = (name, fields) => Buffer.concat([u8(0), ascii(name), i32(fields ? fields.length : -1),
  ...(fields || []).flatMap(([field, type]) => [utf16(field), type])]);
const BOOL = u8(0x10);
const INT = u8(0x11);
const STRING = u8(0x14);
const EIGHT = u8(0x18);

function preferences(bitDepth) {
  return Buffer.concat([
    Buffer.from("ab1e5678", "hex"), u8(5), i32(0x2f57), classRef("LivePreferences"), i32(6),
    def("List<HardwareControllerPreferences>", null),
    def("SongPrefData", [
      ["NoLabels", classRef("RemoteableBool")],
      ["SampleEditorRef", classRef("FileRef")],
      ["RecordDirectory", STRING],
      ["RecordBitDepth", classRef("RemoteableEnum")],
      ["RecordFileType", classRef("RemoteableEnum")],
    ]),
    def("FileRef", [["RelativePathType", INT], ["Path", STRING], ["OriginalFileSize", EIGHT]]),
    def("RemoteableBool", [["Value", BOOL]]),
    def("RemoteableEnum", [["Value", INT]]),
    // values
    classRef("SongPrefData"), i32(10),
    u8(1), i32(0), utf16(""), Buffer.alloc(8), utf16("/Users/someone/Music/Ableton/Live Recordings"),
    i32(bitDepth), i32(0),
  ]);
}

test("parseSchema reads the class definitions and where the values start", () => {
  const buffer = preferences(1);
  const { root, classes, valuesAt } = parseSchema(buffer);
  assert.equal(root, "LivePreferences");
  assert.equal(classes.get("List<HardwareControllerPreferences>"), null);
  assert.deepEqual(classes.get("FileRef").map((f) => f.name), ["RelativePathType", "Path", "OriginalFileSize"]);
  assert.equal(buffer.toString("latin1", valuesAt + 2, valuesAt + 14), "SongPrefData");
});

test("readSetting reads past class-typed and string fields", () => {
  const buffer = preferences(2);
  assert.equal(readSetting(buffer, "SongPrefData", "RecordDirectory"), "/Users/someone/Music/Ableton/Live Recordings");
  assert.deepEqual(readSetting(buffer, "SongPrefData", "RecordFileType"), { Value: 0 });
  assert.throws(() => readSetting(buffer, "SongPrefData", "Missing"), /has no Missing/);
  assert.throws(() => readSetting(buffer, "VideoEncoderPrefs", "Encoder"), /defines no VideoEncoderPrefs/);
});

test("parseRecordBitDepth maps Live's values to bit depths", () => {
  assert.deepEqual(parseRecordBitDepth(preferences(0)), { bits: 16, float: false, value: 0 });
  assert.deepEqual(parseRecordBitDepth(preferences(1)), { bits: 24, float: false, value: 1 });
  assert.deepEqual(parseRecordBitDepth(preferences(2)), { bits: 32, float: true, value: 2 });
  assert.throws(() => parseRecordBitDepth(preferences(3)), /unknown record bit depth 3/);
  assert.throws(() => parseRecordBitDepth(Buffer.from("not a cfg")), /Not a Live Preferences.cfg/);
});

test("requireRecordBitDepth refuses another bit depth, saying what to ask for", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-settings-"));
  try {
    const file = path.join(dir, "Preferences.cfg");
    fs.writeFileSync(file, preferences(1));
    await assert.rejects(requireRecordBitDepth(32, { file }),
      /needs Live to record at 32-bit float; it records at 24-bit\. Ask the user to set Settings > Record\/Warp\/Launch > Bit Depth to 32/);
    fs.writeFileSync(file, preferences(2));
    assert.equal((await requireRecordBitDepth(32, { file })).float, true);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
