"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareNotes } = require("../compare.js");

const note = (pitch, start, duration = 0.5, velocity = 100) => ({ pitch, start, duration, velocity });

test("identical notes pass with zero error", () => {
  const notes = [note(60, 0), note(64, 1)];
  const result = compareNotes(notes, notes, { tempo: 120 });
  assert.equal(result.pass, true);
  assert.equal(result.matched, 2);
  assert.equal(result.maxStartErrorMs, 0);
});

test("timing errors are reported in ms at the tempo", () => {
  const result = compareNotes([note(60, 0)], [note(60, 0.004)], { tempo: 120 });
  assert.equal(result.maxStartErrorMs.toFixed(3), "2.000");
  assert.equal(result.pass, false);
  assert.equal(compareNotes([note(60, 0)], [note(60, 0.004)], { tempo: 120, toleranceMs: 2.5 }).pass, true);
});

test("missing and extra notes fail", () => {
  const result = compareNotes([note(60, 0), note(62, 1)], [note(60, 0), note(67, 2)], { tempo: 120 });
  assert.equal(result.pass, false);
  assert.deepEqual(result.missing, [note(62, 1)]);
  assert.deepEqual(result.extra, [note(67, 2)]);
});

test("a recorded note matches at most one expected note, the nearest", () => {
  const result = compareNotes([note(60, 0), note(60, 0.1)], [note(60, 0.09)], { tempo: 120 });
  assert.equal(result.matched, 1);
  assert.deepEqual(result.missing, [note(60, 0)]);
});

test("velocity mismatches fail", () => {
  const result = compareNotes([note(60, 0, 0.5, 100)], [note(60, 0, 0.5, 90)], { tempo: 120 });
  assert.equal(result.pass, false);
  assert.equal(result.velocityMismatches.length, 1);
});

test("durations are checked only with durationToleranceMs", () => {
  const result = compareNotes([note(60, 0, 0.5)], [note(60, 0, 0.25)], { tempo: 120 });
  assert.equal(result.pass, true);
  assert.equal(result.maxDurationErrorMs, 125);
  assert.equal(compareNotes([note(60, 0, 0.5)], [note(60, 0, 0.25)], { tempo: 120, durationToleranceMs: 1 }).pass, false);
});

test("from, to and edgeBeats limit what is compared", () => {
  const expected = [note(60, 0), note(62, 4), note(64, 7.9)];
  const actual = [note(62, 4)];
  assert.equal(compareNotes(expected, actual, { tempo: 120, from: 0, to: 8, edgeBeats: 0.25 }).pass, true);
  assert.equal(compareNotes(expected, actual, { tempo: 120, from: 0, to: 8 }).pass, false);
});

test("a pair on a range edge counts by its expected note, whichever side the recorded one falls", () => {
  const options = { tempo: 120, from: 0, to: 16, edgeBeats: 0.25 };
  // float noise at the edge: expected at 15.75 (out), recorded at 15.7499997 (in)
  const early = compareNotes([note(60, 4), note(60, 15.75)], [note(60, 4), note(60, 15.7499997)], options);
  assert.deepEqual([early.pass, early.matched, early.extra.length], [true, 1, 0]);
  // and the other way: expected at 0.25 (in), recorded at 0.2499997 (out)
  const late = compareNotes([note(60, 0.25)], [note(60, 0.2499997)], options);
  assert.deepEqual([late.pass, late.matched, late.missing.length], [true, 1, 0]);
  // an unpaired note still counts only inside the range
  const lone = compareNotes([], [note(60, 15.8), note(60, 8)], options);
  assert.deepEqual(lone.extra.map((n) => n.start), [8]);
});

test("an expected note just outside the range absorbs a stray recorded note within windowBeats inside it", () => {
  // deliberate: the price of counting a pair by its expected note (see the test above)
  const result = compareNotes([note(60, 15.75)], [note(60, 15.65)], { tempo: 120, from: 0, to: 16, edgeBeats: 0.25 });
  assert.deepEqual([result.pass, result.matched, result.extra.length], [true, 0, 0]);
});
