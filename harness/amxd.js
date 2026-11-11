"use strict";

// Reading a Max for Live device file. An .amxd is chunks "ampf", "meta" and "ptch", each a
// 4-byte tag, a little-endian length and a payload; "ptch" holds the patcher, as JSON
// unless the device is frozen.

// The bytes of the "ptch" chunk in an .amxd's bytes, or null if it has none.
function patcherChunk(data) {
  for (let at = 0; at + 8 <= data.length;) {
    const length = data.readUInt32LE(at + 4);
    if (data.toString("latin1", at, at + 4) === "ptch") return data.subarray(at + 8, at + 8 + length);
    at += 8 + length;
  }
  return null;
}

module.exports = { patcherChunk };
