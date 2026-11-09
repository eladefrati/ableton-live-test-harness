"use strict";

// Compares expected notes (e.g. an engine render) with notes recorded in Live. Notes are
// { pitch, start, duration, velocity } in beats. Expected and recorded notes of the same
// pitch within `windowBeats` of each other are paired closest first, each note at most
// once; timing errors are reported in milliseconds at `tempo`. Start times must be within
// `toleranceMs`; durations only when `durationToleranceMs` is given. With `from`/`to`,
// only notes starting in [from + edgeBeats, to - edgeBeats) are compared, so a recording's
// first and last moments don't count. Notes are paired before that range applies, and a
// pair counts by its expected note's start: a recorded note a hair off a range edge
// (15.7499997 for 15.75) must not count when its expected note doesn't, or vice versa. So
// an expected note just outside the range can also absorb a stray recorded note up to
// `windowBeats` inside it: in effect, the edge skipped for recorded notes is that much wider.

function compareNotes(expected, actual, {
  tempo, windowBeats = 0.125, toleranceMs = 1, durationToleranceMs = null,
  from = -Infinity, to = Infinity, edgeBeats = 0,
}) {
  const msPerBeat = 60000 / tempo;
  const inRange = (note) => note.start >= from + edgeBeats && note.start < to - edgeBeats;
  const pairs = [];
  expected.forEach((want, i) => actual.forEach((got, j) => {
    const distance = Math.abs(got.start - want.start);
    if (got.pitch === want.pitch && distance <= windowBeats) pairs.push({ i, j, distance });
  }));
  pairs.sort((a, b) => a.distance - b.distance || a.i - b.i || a.j - b.j);
  const expectedUsed = new Set();
  const actualUsed = new Set();
  const matched = [];
  for (const { i, j } of pairs) {
    if (expectedUsed.has(i) || actualUsed.has(j)) continue;
    expectedUsed.add(i);
    actualUsed.add(j);
    const want = expected[i];
    const got = actual[j];
    if (!inRange(want)) continue;
    matched.push({
      expected: want,
      actual: got,
      startErrorMs: (got.start - want.start) * msPerBeat,
      durationErrorMs: (got.duration - want.duration) * msPerBeat,
    });
  }
  const missing = expected.filter((note, i) => !expectedUsed.has(i) && inRange(note));
  const extra = actual.filter((note, j) => !actualUsed.has(j) && inRange(note));
  const maxAbs = (key) => matched.reduce((max, m) => Math.max(max, Math.abs(m[key])), 0);
  const maxStartErrorMs = maxAbs("startErrorMs");
  const maxDurationErrorMs = maxAbs("durationErrorMs");
  const velocityMismatches = matched.filter((m) => m.expected.velocity !== undefined
    && Math.round(m.expected.velocity) !== Math.round(m.actual.velocity));
  return {
    pass: missing.length === 0 && extra.length === 0 && velocityMismatches.length === 0
      && maxStartErrorMs <= toleranceMs
      && (durationToleranceMs === null || maxDurationErrorMs <= durationToleranceMs),
    matched: matched.length,
    matchedNotes: matched,
    missing,
    extra,
    velocityMismatches,
    maxStartErrorMs,
    maxDurationErrorMs,
  };
}

function summary(result) {
  return `${result.pass ? "PASS" : "FAIL"}: ${result.matched} matched, ${result.missing.length} missing, `
    + `${result.extra.length} extra, ${result.velocityMismatches.length} velocity mismatches, `
    + `start error max ${result.maxStartErrorMs.toFixed(3)} ms, duration error max ${result.maxDurationErrorMs.toFixed(3)} ms`;
}

module.exports = { compareNotes, summary };
