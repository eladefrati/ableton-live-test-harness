"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { openMidiPort, MidiError, PORT } = require("../midi.js");

// A stand-in for the MIDI helper: a Node script, run by Node, that saves its arguments and
// every line it reads beside itself, and then does what `body` says with each line.
function fakeHelper(t, body) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "midi-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, "helper.js");
  const lines = path.join(folder, "lines");
  fs.writeFileSync(file, `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(path.join(folder, "args.json"))}, JSON.stringify(process.argv.slice(2)));
${body}
`);
  fs.writeFileSync(lines, "");
  return {
    file,
    lines: () => fs.readFileSync(lines, "utf8").split("\n").filter(Boolean),
    linesFile: lines,
    args: () => JSON.parse(fs.readFileSync(path.join(folder, "args.json"), "utf8")),
  };
}

// Answers as the helper does: "ready", then "ok" for each line.
const ANSWERS = (helper) => `
const rl = require("node:readline").createInterface({ input: process.stdin });
console.log("ready");
rl.on("line", (line) => {
  fs.appendFileSync(${JSON.stringify(helper.linesFile)}, line + "\\n");
  console.log("ok");
});
`;

const systemFor = (helper) => ({
  binary: async () => helper.file,
  spawn: (file, args, options) => spawn(process.execPath, [file, ...args], options),
});

function answeringHelper(t) {
  const helper = fakeHelper(t, "");
  fs.appendFileSync(helper.file, ANSWERS(helper));
  return helper;
}

test("openMidiPort opens the port by its name and sends CCs and notes as MIDI bytes, in order", async (t) => {
  const helper = answeringHelper(t);
  const port = await openMidiPort({}, systemFor(helper));
  assert.equal(port.name, PORT);
  await Promise.all([port.cc(1, 20, 127), port.noteOn(16, 60, 100), port.noteOff(2, 60)]);
  await port.close();
  assert.deepEqual(helper.args(), ["Harness"]);
  assert.deepEqual(helper.lines(), ["176 20 127", "159 60 100", "129 60 0"]);
});

test("a send refuses a channel, controller, value or pitch out of range, and sends nothing", async (t) => {
  const helper = answeringHelper(t);
  const port = await openMidiPort({}, systemFor(helper));
  await assert.rejects(port.cc(0, 1, 1), (e) => e instanceof MidiError && /channel is 1 to 16, not 0/.test(e.message));
  await assert.rejects(port.cc(17, 1, 1), /channel is 1 to 16, not 17/);
  await assert.rejects(port.cc(1, 128, 1), /A controller must be a whole number from 0 to 127, not 128/);
  await assert.rejects(port.cc(1, 1, 1.5), /A CC value must be/);
  await assert.rejects(port.noteOn(1, -1, 1), /A pitch must be/);
  await port.close();
  assert.deepEqual(helper.lines(), []);
  await assert.rejects(port.cc(1, 1, 1), /The MIDI port Harness is closed/);
});

test("openMidiPort fails with the helper's reason when it ends before the port is open", async (t) => {
  const helper = fakeHelper(t, `console.error("Couldn't make the MIDI source Harness (OSStatus -10830)"); process.exit(1);`);
  await assert.rejects(openMidiPort({}, systemFor(helper)),
    /The MIDI port Harness didn't open: Couldn't make the MIDI source Harness \(OSStatus -10830\)/);
});

test("openMidiPort gives up on a helper that never says the port is open", async (t) => {
  const helper = fakeHelper(t, "setInterval(() => {}, 1000);");
  await assert.rejects(openMidiPort({ readyMs: 300 }, systemFor(helper)), /didn't open within 300 ms/);
});

test("a send the helper couldn't make rejects with its reason, and one pending when it ends rejects too", async (t) => {
  const refuses = fakeHelper(t, `console.log("ready");
require("node:readline").createInterface({ input: process.stdin }).on("line", () => console.log("error MIDIReceived failed (OSStatus -50)"));`);
  const port = await openMidiPort({}, systemFor(refuses));
  await assert.rejects(port.cc(1, 1, 1), (e) => e instanceof MidiError && e.message === "MIDIReceived failed (OSStatus -50)");
  await port.close();

  const quits = fakeHelper(t, `console.log("ready"); process.stdin.once("data", () => { console.error("gone"); process.exit(1); });`);
  const dying = await openMidiPort({}, systemFor(quits));
  await assert.rejects(dying.cc(1, 1, 1), /gone/);
});
