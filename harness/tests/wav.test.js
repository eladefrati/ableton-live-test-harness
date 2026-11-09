"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWav } = require("../wav.js");

function wav({ code, bits, channels, rate = 48000, frames, write, extensible = false, extraChunk = false }) {
  const bytes = bits / 8;
  const data = Buffer.alloc(frames.length * channels * bytes);
  frames.forEach((frame, i) => frame.forEach((value, c) => write(data, value, (i * channels + c) * bytes)));
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : code, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * channels * bytes, 8);
  fmt.writeUInt16LE(channels * bytes, 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(code, 24); // the sub-format GUID's first two bytes
  }
  const chunk = (id, body) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "ascii");
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([
    Buffer.from("WAVE"), chunk("fmt ", fmt), extraChunk ? chunk("LIST", Buffer.from("odd")) : Buffer.alloc(0), chunk("data", data),
  ]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

test("16-bit PCM, stereo, scaled to -1..1", () => {
  const file = wav({ code: 1, bits: 16, channels: 2, frames: [[0, 16384], [-32768, 32767]],
    write: (b, v, at) => b.writeInt16LE(v, at) });
  const { sampleRate, channels, bits, float } = parseWav(file);
  assert.equal(sampleRate, 48000);
  assert.equal(bits, 16);
  assert.equal(float, false);
  assert.deepEqual([...channels[0]], [0, -1]);
  assert.deepEqual([...channels[1]], [0.5, 32767 / 32768]);
});

test("24-bit PCM, as Live records, past an odd-sized chunk", () => {
  const file = wav({ code: 1, bits: 24, channels: 1, frames: [[-8388608], [4194304], [1]], extraChunk: true,
    write: (b, v, at) => b.writeIntLE(v, at, 3) });
  assert.deepEqual([...parseWav(file).channels[0]], [-1, 0.5, 1 / 8388608].map(Math.fround));
});

test("32-bit float in an EXTENSIBLE header", () => {
  const file = wav({ code: 3, bits: 32, channels: 1, frames: [[0.25], [-0.75]], extensible: true,
    write: (b, v, at) => b.writeFloatLE(v, at) });
  const { channels, float } = parseWav(file);
  assert.equal(float, true);
  assert.deepEqual([...channels[0]], [0.25, -0.75]);
});

test("refuses what it can't read", () => {
  assert.throws(() => parseWav(Buffer.from("FORM....AIFF")), /Not a RIFF WAVE/);
  const alaw = wav({ code: 6, bits: 8, channels: 1, frames: [[0]], write: (b, v, at) => b.writeUInt8(v, at) });
  assert.throws(() => parseWav(alaw), /Unsupported WAVE format 6/);
});
