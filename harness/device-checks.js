"use strict";

// A runner for a project's in-Live checks of a MIDI device: it loads the newest build of
// the device from the one Places folder that has it onto a new track, places a known clip in the Arrangement
// there, and for each case sets the device's parameters, records its output (Post FX) into
// a second new track, and compares it with the case's expected notes. Both tracks are
// deleted afterwards. A project's tests/live/ supplies the device, its builds folder and
// its cases.

const fs = require("node:fs");
const path = require("node:path");
const { connect, playedNotes } = require("./live.js");
const { float } = require("./osc.js");
const { compareNotes, summary } = require("./compare.js");

function latestBuild(folder, device) {
  const escaped = device.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped} (\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)\\.amxd$`);
  const key = (name) => name.match(pattern).slice(1).map(Number);
  const builds = fs.readdirSync(folder).filter((name) => pattern.test(name)).sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka.map((v, i) => v - kb[i]).find((d) => d !== 0) || 0;
  });
  if (!builds.length) throw new Error(`No ${device} build in ${folder}`);
  return builds[builds.length - 1];
}

// Which file in `builds` to load: the `build` option (a file name, or a function of the
// folder that returns one), or else the highest version of `<device> Y.M.D.N.amxd`.
function chooseBuild(option, builds, device) {
  const name = typeof option === "function" ? option(builds) : option || latestBuild(builds, device);
  if (typeof name !== "string" || !name) throw new Error(`device-checks: the "build" option gave no file name for ${builds}`);
  if (!fs.existsSync(path.join(builds, name))) throw new Error(`No ${name} in ${builds}`);
  return name;
}

// The script of the one box in a built .amxd whose text matches `boxText` (default: the
// [v8] object; [v8ui] views are not "v8 ..." objects). The file holds chunks "ampf", "meta"
// and "ptch" (4-byte tag, little-endian length, payload), the last the patcher JSON. Box
// ids may be renumbered when a build tool writes the file, so the box is found by its text.
function buildScript(file, boxText = /^v8 /) {
  const data = fs.readFileSync(file);
  for (let at = 0; at + 8 <= data.length;) {
    const tag = data.toString("latin1", at, at + 4);
    const length = data.readUInt32LE(at + 4);
    if (tag === "ptch") {
      const patcher = JSON.parse(data.toString("utf8", at + 8, at + 8 + length).replace(/\0+$/, "")).patcher;
      const scripts = patcher.boxes.map((b) => b.box).filter((b) => boxText.test(b.text || "") && b.textfile);
      if (scripts.length !== 1) throw new Error(`Expected one ${boxText} script in ${file}, found ${scripts.length}`);
      return scripts[0].textfile.text;
    }
    at += 8 + length;
  }
  throw new Error(`No patcher in ${file}`);
}

// The default test clip: 16 notes over 12 beats, no two of the same pitch overlapping (Live
// shortens an overlapped note).
function clipNotes() {
  const notes = [];
  for (let i = 0; i < 16; i++) {
    notes.push({ pitch: 60 + [0, 2, 4, 5, 7, 9, 11, 12][i % 8], start: i * 0.75, duration: 0.5, velocity: 80 + i, mute: false });
  }
  return notes;
}

// Runs `cases` against one loaded device, each recorded from beat 0 for `beats` beats. A
// case is {name, settings?, beforeRecording?, during?, expect, whileArmed?}:
//   settings:            {parameterName: value}, set before the recording, put back after
//   beforeRecording(ctx): anything else to do first, e.g. press a momentary button
//   during:              [{beat, action(ctx)} or {beat, set: {parameterName: value}}], taken
//                        while it records, once the song has passed `beat`; ctx.during[i] is
//                        then {beat, before, after}, the song time just before and after
//                        action i (live.js recordArrangement). A `set` is sent without
//                        waiting, so the window brackets just that; an action that syncs or
//                        sleeps pushes `after` late. Parameters a `set` changes are put back
//                        after the case, as settings are. With `grid` (in beats, e.g. the
//                        device's step), the case fails if the window, plus `reachMs`,
//                        crosses a grid line: which step the change hit is then unknown.
//                        The window is about one AbletonOSC tick (100-120 ms), so a grid
//                        step must be well over that plus reachMs (about 250 ms or more, with
//                        `beat` just after a line), or every run fails: use a coarser grid
//                        or a slower --tempo.
//   expect(ctx):         the notes the device should play: [{pitch, start, duration, velocity}]
//   whileArmed(ctx):     runs after the recording, with the record track still armed, and
//                        resolves with its problems (strings), if any
//
// Options:
//   device:         the build's name before its version, e.g. "Device"
//   builds:         the builds folder; Live finds the build in whichever Places folder has
//                   it
//   build:          which file in `builds` to load, for a naming other than
//                   `<device> Y.M.D.N.amxd`: a file name, or (folder) -> a file name
//   longNames:      (buildFile) -> the long name of every parameter Live can see, so settings
//                   use long names (needed when short names repeat);
//                   without it, settings use Live's short names
//   notes, beats:   the clip on the device's track (default clipNotes(), 16 beats)
//   compare:        options for compareNotes (tempo, from and to are set here), e.g.
//                   {edgeBeats: 0.25} to skip notes near the start and the stop
//   openHooks:      open the test hook's port (ADR-0002) before the device loads
//   onFail(testCase): e.g. save the device's debug output
//   tempo:          set the song's tempo (BPM) first and leave it so; expected notes
//                   should follow ctx.song.tempo, which is read after it
//   reachMs:        how long after a `during` window a change may still reach the device
//                   (default 50: measured 13-27 ms, median 19, from Live handling a set to a
//                   development build's hook report, stopped and playing; about 2x margin)
//   flags:          --keep leaves the tracks
//
// `ctx` holds build (the file), notes, clip, beats, song (tempo, clip_trigger_quantization),
// played (the notes Live plays from the clip, in song time), and live, deviceTrack,
// recordTrack, device and parameters (name -> index), and set(name, value), which sets a
// parameter by name without waiting (a parameter it sets from beforeRecording or an action
// is not put back after the case; use settings or a `set` entry for that). Resolves with
// the number of failed cases.
async function run(cases, {
  device: deviceName, builds, build: buildOption = null, longNames = null, notes = clipNotes(), beats = 16,
  compare = {}, openHooks = false, onFail = () => {}, tempo = null, reachMs = 50, flags = new Set(),
} = {}) {
  for (const [option, value] of Object.entries({ device: deviceName, builds })) {
    if (!value) throw new Error(`device-checks: the "${option}" option is required`);
  }
  // here rather than mid-recording, where a bad entry would fail late and unclearly
  for (const { name, during = [] } of cases) {
    for (const step of during) {
      if ((typeof step.action === "function") === Boolean(step.set)) {
        throw new Error(`${name}: a during entry needs an action or a set, not both or neither`);
      }
      if (step.grid !== undefined && !(step.grid > 0)) throw new Error(`${name}: a during grid must be a positive number of beats`);
    }
  }
  // Live's tempo range
  if (tempo !== null && !(tempo >= 20 && tempo <= 999)) throw new Error(`Tempo ${tempo} is outside 20-999 BPM`);
  const slug = deviceName.toLowerCase().replace(/\W+/g, "-");
  const deviceTrackName = `${slug}-under-test`;
  const recordTrackName = `${slug}-record`;
  const live = await connect({ timeout: 5000 });
  let first;
  let recordTrack;
  let failed = 0;
  try {
    // Before anything in Live changes: Live must see this very build, in one Places folder.
    const build = chooseBuild(buildOption, builds, deviceName);
    const buildFile = path.join(builds, build);
    const places = await live.query("/live/browser/get/places_with", build).catch((error) => {
      throw /^No reply/.test(error.message)
        ? new Error(`${error.message}: AbletonOSC may predate it; run node harness/cli.js reload`)
        : error;
    });
    const problem = placesProblem(build, builds, places);
    if (problem) throw new Error(problem);
    first = await live.get("song", "num_tracks");
    if (tempo !== null) {
      live.set("song", "tempo", float(tempo));
      await live.sync();
    }
    if (openHooks) await live.openHooks();
    const deviceTrack = await live.createMidiTrack(deviceTrackName);
    recordTrack = await live.createMidiTrack(recordTrackName);
    const device = await live.loadDevice(deviceTrack, "*", build);
    const parameters = await live.parameterIndices(deviceTrack, device, longNames && longNames(buildFile));
    console.log(`Loaded ${build}`);

    live.send("/live/clip_slot/create_clip", deviceTrack, 0, float(beats));
    live.send("/live/clip/add/notes", deviceTrack, 0,
      ...notes.flatMap((n) => [n.pitch, float(n.start), float(n.duration), n.velocity, Boolean(n.mute)]));
    const [, clipIndex] = await live.query("/live/track/duplicate_clip_to_arrangement", deviceTrack, 0, float(0));
    const clip = (await live.arrangementClips(deviceTrack)).find((c) => c.index === clipIndex);
    await live.setInputRouting(recordTrack, deviceTrackName, "Post FX");
    const song = {
      tempo: await live.get("song", "tempo"),
      clip_trigger_quantization: await live.get("song", "clip_trigger_quantization"),
    };
    const parameterIndex = (name) => {
      const index = parameters.get(name);
      if (index === undefined) throw new Error(`${deviceName} has no visible parameter ${name}`);
      return index;
    };
    const ctx = { build: buildFile, notes, clip, beats, song, played: playedNotes(clip, notes),
      live, deviceTrack, recordTrack, device, parameters,
      set: (name, value) => live.setParameter(deviceTrack, device, parameterIndex(name), value) };

    for (const testCase of cases) {
      const restore = new Map();
      const remember = async (name) => {
        const index = parameterIndex(name);
        if (!restore.has(index)) {
          const [, , , current] = await live.query("/live/device/get/parameter/value", deviceTrack, device, index);
          restore.set(index, current);
        }
        return index;
      };
      for (const [name, value] of Object.entries(testCase.settings || {})) {
        live.setParameter(deviceTrack, device, await remember(name), value);
      }
      for (const step of testCase.during || []) for (const name of Object.keys(step.set || {})) await remember(name);
      if (testCase.beforeRecording) await testCase.beforeRecording(ctx);
      live.set("track", "arm", recordTrack, 1);
      await live.sync();
      ctx.during = await live.recordArrangement({ start: 0, length: beats, tracks: [recordTrack],
        during: (testCase.during || []).map(({ beat, action, set }) => ({ beat, action: set
          ? async () => { for (const [name, value] of Object.entries(set)) ctx.set(name, value); }
          : () => action(ctx) })) });
      const problems = (testCase.during || []).flatMap(({ grid }, i) =>
        (grid ? [straddleProblem(ctx.during[i], grid, (reachMs * song.tempo) / 60000)].filter(Boolean) : []));
      if (testCase.whileArmed) problems.push(...(await testCase.whileArmed(ctx)));
      live.set("track", "arm", recordTrack, 0);
      const result = compareNotes(testCase.expect(ctx), await live.songNotes(recordTrack),
        Object.assign({}, compare, { tempo: song.tempo, from: 0, to: beats }));
      console.log(`${testCase.name}: ${summary(result)}`);
      for (const problem of problems) console.log(`${testCase.name}: FAIL ${problem}`);
      if (!result.pass || problems.length) {
        failed++;
        if (!result.pass) console.log(JSON.stringify({ missing: result.missing, extra: result.extra }));
        onFail(testCase);
      }
      for (const [index, value] of restore) live.setParameter(deviceTrack, device, index, value);
      await live.deleteArrangementClips(recordTrack);
    }
  } finally {
    // An error in cleanup must not keep the sockets open: Node would never exit.
    try {
      if (first !== undefined && flags.has("--keep")) {
        // a kept record track left armed would stop the next run's recording
        if (recordTrack !== undefined) live.set("track", "arm", recordTrack, 0);
        await live.sync();
      } else if (first !== undefined) {
        // deleteTracks goes from the last track, so the recording goes before its source:
        // a track whose MIDI source is gone can't be disarmed
        await live.deleteTracks([deviceTrackName, recordTrackName], first);
      }
    } finally {
      live.close();
    }
  }
  return failed;
}

// Why Live can't load `build` from `builds`, given the Places folders that have it (by
// name: the LOM gives no folder's path), or null if it can.
function placesProblem(build, builds, places) {
  if (places.length === 0) {
    return `${build} isn't in Live's Places: add ${builds} to Places, with Live quit: `
      + `node ${path.join(__dirname, "add-place.js")} "${builds}" (or Add Folder in Live's browser). `
      + "If it is there, Live hasn't indexed the new build yet: wait a moment and run again.";
  }
  if (places.length > 1) {
    return `${build} is in ${places.length} Places folders (${places.join(", ")}): `
      + `remove all but ${builds} from Places, so the check can't load the wrong copy`;
  }
  return null;
}

// Why a `during` window (recordArrangement) can't tell which `grid` step its change landed
// in, or null: the window, extended by `reachBeats`, crosses a grid line.
function straddleProblem({ beat, before, after }, grid, reachBeats) {
  // the epsilon keeps float noise (0.3 / 0.1 = 2.9999999999999996) off a grid line
  const step = (time) => Math.floor(time / grid + 1e-9);
  const first = step(before);
  if (step(after + reachBeats) === first) return null;
  const where = `the change at beat ${beat} landed between ${before.toFixed(3)} and `
    + `${(after + reachBeats).toFixed(3)}, across the grid line at ${+((first + 1) * grid).toFixed(6)}`;
  return after + reachBeats - before >= grid
    ? `${where}: the window is wider than the grid (${grid} beats), so it always will; use a coarser grid or a slower --tempo`
    : `${where}: move it further from the line`;
}

function commandLine(argv) {
  const flags = new Set();
  let tempo = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--keep") {
      flags.add(argv[i]);
      continue;
    }
    if (argv[i] !== "--tempo") throw new Error(`Unknown option ${argv[i]}: a check takes --keep and --tempo <bpm>`);
    tempo = Number(argv[++i]);
    if (argv[i] === undefined || !Number.isFinite(tempo)) throw new Error(`--tempo needs a tempo in BPM, not ${argv[i]}`);
  }
  return tempo === null ? { flags } : { flags, tempo };
}

// Runs the cases as a script, with the command line's flags and tempo: exits 1 if any case
// fails or the run errors.
function main(cases, options) {
  Promise.resolve().then(() => run(cases, Object.assign(commandLine(process.argv.slice(2)), options))).then(
    (failed) => { if (failed) process.exitCode = 1; },
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}

module.exports = { run, main, commandLine, latestBuild, chooseBuild, placesProblem, straddleProblem, buildScript, clipNotes };
