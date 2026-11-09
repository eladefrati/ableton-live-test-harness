"use strict";

// OSC 1.0 message encoding and decoding, for the types AbletonOSC sends and accepts.
// JavaScript numbers are ambiguous, so integers encode as int32 and other numbers as
// float32; wrap a value in float() or double() to force its type (Live reads 4 and 4.0
// the same, but some handlers check).

class Typed {
  constructor(tag, value) {
    this.tag = tag;
    this.value = value;
  }
}

const float = (value) => new Typed("f", value);
const double = (value) => new Typed("d", value);

function padded(buffer) {
  const length = Math.ceil((buffer.length + 1) / 4) * 4;
  const out = Buffer.alloc(length);
  buffer.copy(out);
  return out;
}

const encodeString = (s) => padded(Buffer.from(s, "utf8"));

function encodeArg(arg) {
  if (arg instanceof Typed) {
    const b = Buffer.alloc(arg.tag === "d" ? 8 : 4);
    if (arg.tag === "d") b.writeDoubleBE(arg.value);
    else b.writeFloatBE(arg.value);
    return [arg.tag, b];
  }
  if (arg === true) return ["T", Buffer.alloc(0)];
  if (arg === false) return ["F", Buffer.alloc(0)];
  if (arg === null || arg === undefined) return ["N", Buffer.alloc(0)];
  if (typeof arg === "string") return ["s", encodeString(arg)];
  if (typeof arg === "number") {
    const b = Buffer.alloc(4);
    if (Number.isInteger(arg) && arg >= -0x80000000 && arg <= 0x7fffffff) {
      b.writeInt32BE(arg);
      return ["i", b];
    }
    b.writeFloatBE(arg);
    return ["f", b];
  }
  throw new TypeError(`Cannot encode OSC argument ${String(arg)}`);
}

function encode(address, args = []) {
  const encoded = args.map(encodeArg);
  const tags = "," + encoded.map(([tag]) => tag).join("");
  return Buffer.concat([encodeString(address), encodeString(tags), ...encoded.map(([, b]) => b)]);
}

function readString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error("Unterminated OSC string");
  return [buffer.toString("utf8", offset, end), Math.ceil((end + 1) / 4) * 4];
}

function decode(buffer) {
  let [address, offset] = readString(buffer, 0);
  let tags;
  [tags, offset] = readString(buffer, offset);
  const args = [];
  for (const tag of tags.slice(1)) {
    switch (tag) {
      case "i": args.push(buffer.readInt32BE(offset)); offset += 4; break;
      case "h": args.push(Number(buffer.readBigInt64BE(offset))); offset += 8; break;
      case "f": args.push(buffer.readFloatBE(offset)); offset += 4; break;
      case "d": args.push(buffer.readDoubleBE(offset)); offset += 8; break;
      case "s": { let s; [s, offset] = readString(buffer, offset); args.push(s); break; }
      case "b": {
        const size = buffer.readInt32BE(offset);
        args.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + Math.ceil(size / 4) * 4;
        break;
      }
      case "T": args.push(true); break;
      case "F": args.push(false); break;
      case "N": args.push(null); break;
      default: throw new Error(`Unsupported OSC type tag ${tag}`);
    }
  }
  return { address, args };
}

module.exports = { encode, decode, float, double };
