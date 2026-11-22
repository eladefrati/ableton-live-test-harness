"use strict";

// Sending MIDI to Live as from a controller (ADR-0018): a MIDI source of the harness's own,
// made by a Swift helper (midi.swift), which Live lists as an input port named PORT while it
// is open. For Live to take its messages, that input needs Remote on (MIDI mapping) and, for
// notes into an armed or monitoring track, Track on, in Settings > Link, Tempo & MIDI; the
// port must be open while that is set, so `cli.js midi-port` holds it open.
//
//   const port = await openMidiPort();
//   await port.cc(1, 20, 127);        // channel 1-16, controller 0-127, value 0-127
//   await port.noteOn(1, 60, 100);
//   await port.noteOff(1, 60);
//   await port.close();
//
// Each send resolves once the helper has handed the message to CoreMIDI, not once Live has
// acted on it.

const path = require("node:path");
const { spawn } = require("node:child_process");
const tools = require("./tools.js");

class MidiError extends Error {}

const PORT = "Harness";
const HELPER_SOURCE = path.join(__dirname, "midi.swift");
const READY_MS = 5000;

const machine = {
  binary: () => tools.helperBinary(HELPER_SOURCE),
  spawn,
};

const byte = (value, what, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new MidiError(`${what} must be a whole number from 0 to ${max}, not ${value}`);
  return value;
};
const channelOf = (channel) => {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new MidiError(`A MIDI channel is 1 to 16, not ${channel}`);
  return channel - 1;
};

// Opens the port and resolves once it exists, with { name, cc, noteOn, noteOff, close }; a
// value out of range rejects and sends nothing.
// The port goes when close() is called or the run ends. One port of a name at a time, since a
// second opened beside it is a second input of the same name, which Live can't tell apart.
async function openMidiPort({ name = PORT, readyMs = READY_MS } = {}, system = machine) {
  const binary = await system.binary();
  const child = system.spawn(binary, [name], { stdio: ["pipe", "pipe", "pipe"] });
  let [heard, complained] = ["", ""];
  const waiting = [];
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const ended = new Promise((resolve) => {
    child.on("error", (error) => { complained += error.message; resolve(); });
    child.on("close", () => resolve());
  });
  const reason = () => complained.trim().split("\n").pop() || "the MIDI helper ended";
  child.stderr.on("data", (data) => { complained += data; });
  child.stdout.on("data", (data) => {
    heard += data;
    let at;
    while ((at = heard.indexOf("\n")) >= 0) {
      const line = heard.slice(0, at);
      heard = heard.slice(at + 1);
      if (line === "ready") readyResolve();
      else if (waiting.length) {
        const { resolve, reject } = waiting.shift();
        if (line === "ok") resolve();
        else reject(new MidiError(line.replace(/^error /, "")));
      }
    }
  });
  ended.then(() => {
    for (const { reject } of waiting.splice(0)) reject(new MidiError(reason()));
  });

  let timer;
  try {
    await Promise.race([
      ready,
      ended.then(() => { throw new MidiError(`The MIDI port ${name} didn't open: ${reason()}`); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new MidiError(`The MIDI port ${name} didn't open within ${readyMs} ms`)), readyMs);
      }),
    ]);
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  let closed = false;
  const send = (bytes) => {
    if (closed) return Promise.reject(new MidiError(`The MIDI port ${name} is closed`));
    return new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      child.stdin.write(`${bytes.join(" ")}\n`);
    });
  };
  return {
    name,
    cc: async (channel, controller, value) => send([0xB0 | channelOf(channel), byte(controller, "A controller", 127), byte(value, "A CC value", 127)]),
    noteOn: async (channel, pitch, velocity) => send([0x90 | channelOf(channel), byte(pitch, "A pitch", 127), byte(velocity, "A velocity", 127)]),
    noteOff: async (channel, pitch) => send([0x80 | channelOf(channel), byte(pitch, "A pitch", 127), 0]),
    // Resolves once the helper has ended and the port is gone.
    close: async () => {
      closed = true;
      child.stdin.end();
      await ended;
    },
  };
}

module.exports = { openMidiPort, MidiError, PORT };
