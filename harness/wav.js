"use strict";

// Reads WAV files into float arrays, with no dependencies: PCM at 8, 16, 24 or 32 bits and
// IEEE float at 32 or 64 bits, in plain or WAVE_FORMAT_EXTENSIBLE headers. Samples come
// back as one Float32Array per channel, PCM scaled to -1..1.

const fs = require("node:fs");

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF WAVE file");
  }
  let format = null;
  let data = null;
  for (let at = 12; at + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      let code = buffer.readUInt16LE(body);
      const bits = buffer.readUInt16LE(body + 14);
      // EXTENSIBLE carries the real format in the first two bytes of its sub-format GUID.
      if (code === EXTENSIBLE) code = buffer.readUInt16LE(body + 24);
      format = {
        code,
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        blockAlign: buffer.readUInt16LE(body + 12),
        bits,
      };
    } else if (id === "data") {
      // A writer that never patched the size (a recording still open) leaves 0 or more
      // than is there; read what the file holds.
      data = { start: body, end: Math.min(buffer.length, size ? body + size : buffer.length) };
    }
    at = body + size + (size % 2); // chunks are padded to an even length
  }
  if (!format) throw new Error("WAVE file has no fmt chunk");
  if (!data) throw new Error("WAVE file has no data chunk");

  const { code, channels, bits, blockAlign } = format;
  const bytes = bits / 8;
  let read;
  if (code === PCM && bits === 8) read = (at) => (buffer.readUInt8(at) - 128) / 128;
  else if (code === PCM && bits === 16) read = (at) => buffer.readInt16LE(at) / 32768;
  else if (code === PCM && bits === 24) read = (at) => buffer.readIntLE(at, 3) / 8388608;
  else if (code === PCM && bits === 32) read = (at) => buffer.readInt32LE(at) / 2147483648;
  else if (code === FLOAT && bits === 32) read = (at) => buffer.readFloatLE(at);
  else if (code === FLOAT && bits === 64) read = (at) => buffer.readDoubleLE(at);
  else throw new Error(`Unsupported WAVE format ${code} at ${bits} bits`);

  const frames = Math.floor((data.end - data.start) / blockAlign);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    const at = data.start + frame * blockAlign;
    for (let channel = 0; channel < channels; channel++) out[channel][frame] = read(at + channel * bytes);
  }
  return { sampleRate: format.sampleRate, bits, float: code === FLOAT, channels: out };
}

function readWav(file) {
  return parseWav(fs.readFileSync(file));
}

module.exports = { parseWav, readWav };
