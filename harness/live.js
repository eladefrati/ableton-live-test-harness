"use strict";

// A client for this AbletonOSC fork: requests go to Live on UDP 11000, replies come back
// on 11001. Live handles messages once per 100 ms tick, in the order sent, and replies on
// the request's own address, so requests are sent one at a time and each waits for its
// reply. Setters and methods send no reply; sync() waits until Live has handled
// everything sent before it. A message on /live/error fails the request in flight.

const dgram = require("node:dgram");
const { encode, decode, float } = require("./osc.js");
const { startRunLog } = require("./run-log.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class LiveError extends Error {}

// A flat reply of `width` values per item, as rows. Refuses a reply that isn't whole rows:
// read by position, a short one would put values under the wrong names.
function rows(values, width) {
  if (values.length % width) throw new LiveError(`A reply of ${values.length} values isn't rows of ${width}`);
  const out = [];
  for (let at = 0; at < values.length; at += width) out.push(values.slice(at, at + width));
  return out;
}

// The notes an Arrangement clip plays, in song beats. The clip plays from its start
// marker; a looping clip plays on to its loop end, then repeats loop start..loop end
// until the clip ends. Notes that start outside a played span are not played.
function playedNotes(clip, notes) {
  const spans = []; // [from, to) in clip time, and the song beat `from` plays at
  if (!clip.looping) {
    spans.push({ from: clip.start_marker, to: Infinity, at: clip.start_time });
  } else {
    spans.push({ from: clip.start_marker, to: clip.loop_end, at: clip.start_time });
    const loopLength = clip.loop_end - clip.loop_start;
    for (let at = clip.start_time + clip.loop_end - clip.start_marker; loopLength > 0 && at < clip.end_time; at += loopLength) {
      spans.push({ from: clip.loop_start, to: clip.loop_end, at });
    }
  }
  const out = [];
  for (const span of spans) {
    for (const note of notes) {
      if (note.start < span.from || note.start >= span.to) continue;
      const beat = span.at + note.start - span.from;
      if (beat >= clip.end_time) continue;
      // Live cuts a note at the loop end and at the clip's end.
      const end = Math.min(span.at + Math.min(note.start + note.duration, span.to) - span.from, clip.end_time);
      out.push({ ...note, start: beat, duration: end - beat });
    }
  }
  return out;
}

class Live {
  constructor({ host = "127.0.0.1", port = 11000, replyPort = 11001, timeout = 2000 } = {}) {
    this.host = host;
    this.port = port;
    this.replyPort = replyPort;
    this.timeout = timeout;
    this.pending = null;
    this.unclaimedError = null; // a /live/error that arrived with no request in flight
    this.queue = Promise.resolve();
    this.listeners = new Map();
  }

  open() {
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", (data) => {
      let message;
      try {
        message = decode(data);
      } catch {
        return; // not OSC: drop it rather than fail the check
      }
      this.receive(message);
    });
    return new Promise((resolve, reject) => {
      this.socket.once("error", (error) => reject(error.code === "EADDRINUSE"
        ? new LiveError(`UDP ${this.replyPort} is in use: another AbletonOSC client is running`)
        : error));
      this.socket.bind(this.replyPort, this.host, () => resolve(this));
    });
  }

  close() {
    if (this.socket) this.socket.close();
    if (this.hookSocket) this.hookSocket.close();
    this.socket = null;
    this.hookSocket = null;
  }

  // Starts receiving test-hook reports from dev builds of devices (ADR-0002): OSC messages
  // /hook/<topic> track_index device_index ...payload, sent to UDP `port`. They collect in
  // this.hooks as { topic, track, device, args, at } until read with waitForHook.
  openHooks({ port = 11002 } = {}) {
    this.hooks = [];
    this.hookWaiters = [];
    this.hookSocket = dgram.createSocket("udp4");
    this.hookSocket.on("message", (data) => {
      let message;
      try {
        message = decode(data);
      } catch {
        return; // not OSC: drop it rather than fail the check
      }
      const { address, args } = message;
      if (!address.startsWith("/hook/")) return;
      const hook = { topic: address.slice(6), track: args[0], device: args[1], args: args.slice(2), at: Date.now() };
      this.hooks.push(hook);
      for (const waiter of this.hookWaiters.slice()) waiter(hook);
    });
    return new Promise((resolve, reject) => {
      this.hookSocket.once("error", (error) => reject(error.code === "EADDRINUSE"
        ? new LiveError(`UDP ${port} is in use: another client is receiving test hooks`)
        : error));
      this.hookSocket.bind(port, this.host, () => resolve(this));
    });
  }

  // Resolves with the first hook report on `topic` from the device at (track, device) that
  // arrives after `since` (ms timestamp, default now) and passes `match(hook)`. Take `since`
  // before the action, or a report that comes back quickly is missed:
  //   const since = Date.now(); live.setParameter(...); await live.waitForHook("check", { since });
  waitForHook(topic, { track, device, since = Date.now(), match = () => true, timeoutMs = this.timeout } = {}) {
    const wanted = (hook) => hook.topic === topic && hook.at >= since
      && (track === undefined || hook.track === track) && (device === undefined || hook.device === device) && match(hook);
    if (!this.hooks) throw new Error("Call openHooks() before waitForHook()");
    const earlier = this.hooks.find(wanted);
    if (earlier) return Promise.resolve(earlier);
    return new Promise((resolve, reject) => {
      const waiter = (hook) => {
        if (!wanted(hook)) return;
        clearTimeout(timer);
        this.hookWaiters.splice(this.hookWaiters.indexOf(waiter), 1);
        resolve(hook);
      };
      const timer = setTimeout(() => {
        this.hookWaiters.splice(this.hookWaiters.indexOf(waiter), 1);
        reject(new LiveError(`No /hook/${topic} report within ${timeoutMs} ms`));
      }, timeoutMs);
      this.hookWaiters.push(waiter);
    });
  }

  receive(message) {
    const listener = this.listeners.get(message.address);
    if (listener) listener(message.args);
    const pending = this.pending;
    if (!pending) {
      if (message.address === "/live/error") this.unclaimedError = String(message.args[0]);
      return;
    }
    if (message.address === "/live/error") pending.fail(new LiveError(String(message.args[0])));
    else if (message.address === pending.address) pending.take(message.args);
  }

  on(address, fn) {
    this.listeners.set(address, fn);
  }

  off(address) {
    this.listeners.delete(address);
  }

  send(address, ...args) {
    this.socket.send(encode(address, args), this.port, this.host);
  }

  // Sends a request and resolves with the arguments of its reply. take(args) returns true
  // when the reply is complete, for replies that arrive as several messages.
  request(address, args, take, { timeout = this.timeout } = {}) {
    const run = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new LiveError(`No reply to ${address} within ${timeout} ms`)), timeout);
      const done = (error, value) => {
        clearTimeout(timer);
        this.pending = null;
        if (error) reject(error);
        else resolve(value);
      };
      this.pending = {
        address,
        fail: done,
        take: (replyArgs) => {
          try {
            const result = take(replyArgs);
            if (result !== undefined) done(null, result);
          } catch (error) {
            done(error);
          }
        },
      };
      this.send(address, ...args);
    });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  query(address, ...args) {
    return this.request(address, args, (replyArgs) => replyArgs);
  }

  // A reply sent in chunks: headerLength arguments, then chunk_index, chunk_count and the
  // chunk's items. Resolves with the header and all items joined, in order.
  queryChunks(address, args, headerLength, options) {
    const chunks = new Map();
    return this.request(address, args, (replyArgs) => {
      const index = replyArgs[headerLength];
      const count = replyArgs[headerLength + 1];
      chunks.set(index, replyArgs.slice(headerLength + 2));
      if (chunks.size < count) return undefined;
      const items = [];
      for (let i = 0; i < count; i++) items.push(...chunks.get(i));
      return { header: replyArgs.slice(0, headerLength), items };
    }, options);
  }

  // Waits until Live has handled every message sent before this call, and fails if any of
  // them raised an error. An error from a message sent without waiting reaches the request
  // in flight when it arrives, so it can be blamed on that request instead.
  async sync() {
    await this.query("/live/test");
    const error = this.unclaimedError;
    this.unclaimedError = null;
    if (error) throw new LiveError(error);
  }

  async get(object, property, ...indices) {
    const reply = await this.query(`/live/${object}/get/${property}`, ...indices);
    return reply.length === indices.length + 1 ? reply[indices.length] : reply.slice(indices.length);
  }

  set(object, property, ...indicesAndValue) {
    this.send(`/live/${object}/set/${property}`, ...indicesAndValue);
  }

  // Properties of every track from one reply (a query per track takes a tick each):
  // trackData("name", "arm") resolves with [[name, arm], ...], one entry per track.
  async trackData(...properties) {
    return rows(await this.query("/live/song/get/track_data", 0, -1, ...properties.map((p) => `track.${p}`)), properties.length);
  }

  // Adds a track at the end of the set, named `name`, with the devices Live's default track
  // template for its kind adds removed, so they can't alter what a test records. Resolves
  // with its index.
  async createTrack(kind, name) {
    // any other kind (a return track) isn't the last of the song's tracks, so the steps
    // below would rename and strip another track
    if (kind !== "midi" && kind !== "audio") throw new LiveError(`createTrack makes a midi or an audio track, not ${kind}`);
    this.send(`/live/song/create_${kind}_track`, -1);
    const track = (await this.get("song", "num_tracks")) - 1;
    this.set("track", "name", track, name);
    const devices = await this.get("track", "num_devices", track);
    for (let device = devices - 1; device >= 0; device--) this.send("/live/track/delete_device", track, device);
    await this.sync();
    return track;
  }

  createMidiTrack(name) {
    return this.createTrack("midi", name);
  }

  createAudioTrack(name) {
    return this.createTrack("audio", name);
  }

  // Places `notes` ([{pitch, start, duration, velocity, mute?}], in beats) on a MIDI track
  // in the Arrangement, from beat 0, as a clip `beats` long: a clip made in the track's
  // first Session slot, which stays there, and duplicated to the Arrangement. Resolves with
  // the Arrangement clip's index.
  async placeClip(track, notes, beats) {
    this.send("/live/clip_slot/create_clip", track, 0, float(beats));
    this.send("/live/clip/add/notes", track, 0,
      ...notes.flatMap((n) => [n.pitch, float(n.start), float(n.duration), n.velocity, Boolean(n.mute)]));
    const [, index] = await this.query("/live/track/duplicate_clip_to_arrangement", track, 0, float(0));
    return index;
  }

  // Finds the device named `name` (its name in the chain, e.g. a plug-in's name) on any
  // track's top-level chain; devices inside racks are not searched. Refuses unless exactly
  // one device has the name. Resolves with { track, device }.
  async findDevice(name) {
    const tracks = await this.get("song", "num_tracks");
    const found = [];
    for (let track = 0; track < tracks; track++) {
      const names = (await this.query("/live/track/get/devices/name", track)).slice(1);
      names.forEach((deviceName, device) => { if (deviceName === name) found.push({ track, device }); });
    }
    if (found.length !== 1) {
      throw new LiveError(`Found ${found.length} devices named ${name}`
        + (found.length ? ` (${found.map((f) => `track ${f.track} device ${f.device}`).join(", ")})` : "") + "; expected one");
    }
    return found[0];
  }

  // Moves a device to position `position` in another track's chain, keeping the instance:
  // its state and parameters go with it. Resolves with its new index.
  async moveDevice(track, device, target, position) {
    const [index] = await this.query("/live/song/move_device", track, device, target, position);
    return index;
  }

  // Sets a device's parameters by name: { name: value }. A number is the parameter's value;
  // a string picks a menu item by its name in value_items. Names are Live's (short) names;
  // a name that appears twice refuses, as the first match may be the wrong one.
  async setParameters(track, device, values) {
    const names = (await this.query("/live/device/get/parameters/name", track, device)).slice(2);
    for (const [name, value] of Object.entries(values)) {
      const index = names.indexOf(name);
      if (index < 0) throw new LiveError(`Device ${device} on track ${track} has no parameter ${name}`);
      if (names.indexOf(name, index + 1) >= 0) throw new LiveError(`Device ${device} on track ${track} has two parameters named ${name}`);
      let number = value;
      if (typeof value === "string") {
        const items = (await this.query("/live/device/get/parameter/value_items", track, device, index)).slice(3);
        number = items.indexOf(value);
        if (number < 0) throw new LiveError(`${name} has no item ${value} (items: ${items.join(", ")})`);
      }
      this.setParameter(track, device, index, float(number));
    }
    await this.sync();
  }

  // The audio files of a track's Arrangement clips, in Live's order: { index, file,
  // start_time, end_time } per audio clip. A recording's file is in the set's project
  // folder, under Samples/Recorded, or for a set never saved in Live's temporary folder.
  async arrangementAudioFiles(track) {
    const out = [];
    for (const clip of await this.arrangementClips(track)) {
      if (clip.is_midi_clip) continue;
      const file = await this.get("arrangement_clip", "file_path", track, clip.index);
      out.push({ index: clip.index, file, start_time: clip.start_time, end_time: clip.end_time });
    }
    return out;
  }

  async deleteTracks(names, from = 0) {
    const all = await this.query("/live/song/get/track_names");
    for (let track = all.length - 1; track >= from; track--) {
      if (names.includes(all[track])) this.send("/live/song/delete_track", track);
    }
    await this.sync();
  }

  // Loads a browser item onto a track and resolves with the new device's index once its
  // parameter count has settled, plus `readyMs` for its scripts to finish starting up.
  // A Max for Live device lists only Device On until its parameters arrive seconds after it
  // appears, so its count must also exceed 1. A plug-in with more parameters than Live
  // populates lists only Device On until they are configured, so its count may stay at 1;
  // it settles once the count has held for `pluginHoldMs`.
  async loadDevice(track, root, itemPath, { settleMs = 10000, readyMs = 500, pluginHoldMs = 1000 } = {}) {
    const [, device] = await this.query("/live/browser/load", track, root, itemPath);
    if (device < 0) throw new LiveError(`Loading ${itemPath} added no device to track ${track}`);
    // AuPluginDevice for an Audio Unit, PluginDevice for a VST.
    const plugin = /PluginDevice$/.test(await this.get("device", "class_name", track, device));
    let last = -1, since = Date.now();
    for (const deadline = Date.now() + settleMs; Date.now() < deadline; await sleep(200)) {
      const count = await this.get("device", "num_parameters", track, device);
      if (count !== last) {
        last = count;
        since = Date.now();
        continue;
      }
      if (plugin ? count >= 1 && Date.now() - since >= pluginHoldMs : count > 1) {
        await sleep(readyMs);
        return device;
      }
    }
    throw new LiveError(`The parameters of ${itemPath} did not settle within ${settleMs} ms`);
  }

  // Waits until the parameter count of every device in the set has stopped changing, e.g.
  // after opening a set, whose Max for Live devices load after it.
  async settleDevices({ timeoutMs = 20000, readyMs = 500 } = {}) {
    const counts = async () => (await this.query("/live/song/get/device_parameter_counts")).join(",");
    let last = null;
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(300)) {
      const now = await counts();
      if (now === last) {
        await sleep(readyMs);
        return;
      }
      last = now;
    }
    throw new LiveError(`Device parameters did not settle within ${timeoutMs} ms`);
  }

  // Maps a device's parameter names to their indices. Max for Live devices report short
  // names, often shared by several parameters, so for those pass `longNames`: every
  // visible (automated) parameter's long name. Live lists them after "Device On" in code
  // unit order of the long name; each short name is checked to end the long one.
  async parameterIndices(track, device, longNames = null) {
    const names = (await this.query("/live/device/get/parameters/name", track, device)).slice(2);
    const indices = new Map();
    if (!longNames) {
      names.forEach((name, index) => { if (!indices.has(name)) indices.set(name, index); });
      return indices;
    }
    const sorted = [...longNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (sorted.length !== names.length - 1) {
      throw new LiveError(`Device has ${names.length - 1} parameters after Device On, expected ${sorted.length}`);
    }
    sorted.forEach((longName, i) => {
      if (!longName.endsWith(names[i + 1])) throw new LiveError(`Parameter ${i + 1} is ${names[i + 1]}, expected ${longName}`);
      indices.set(longName, i + 1);
    });
    return indices;
  }

  // For a menu, pass the item's index in its value_items.
  setParameter(track, device, parameter, value) {
    this.send("/live/device/set/parameter/value", track, device, parameter, value);
  }

  // Sets a track's MIDI/audio From, and optionally its channel ("Pre FX", "Post FX").
  // Live's routing lists follow a track rename or a type change a tick later, and the
  // setters only log a warning for an unknown name, so this waits, sets, and checks.
  async setInputRouting(track, typeName, channelName = null) {
    await this.sync();
    this.send("/live/track/set/input_routing_type", track, typeName);
    const [, type] = await this.query("/live/track/get/input_routing_type", track);
    if (type !== typeName) throw new LiveError(`Track ${track} input is "${type}", not ${typeName}${await this.dialogNote()}`);
    if (channelName === null) return;
    this.send("/live/track/set/input_routing_channel", track, channelName);
    const [, channel] = await this.query("/live/track/get/input_routing_channel", track);
    if (channel !== channelName) throw new LiveError(`Track ${track} input channel is "${channel}", not ${channelName}${await this.dialogNote()}`);
  }

  // Live's open dialog, or null: { message, buttons } (button count; Live's dialog buttons
  // have no names over the LOM or Accessibility).
  async dialog() {
    if ((await this.get("application", "open_dialog_count")) === 0) return null;
    return {
      message: await this.get("application", "current_dialog_message"),
      buttons: await this.get("application", "current_dialog_button_count"),
    };
  }

  // For error messages: says so when a Live dialog is open, which makes requests fail.
  async dialogNote() {
    const dialog = await this.dialog().catch(() => null);
    if (!dialog) return "";
    return ` (a Live dialog is open: ${dialog.message ? `"${dialog.message}"` : "no message, e.g. the Save panel"})`;
  }

  async pressDialogButton(index) {
    this.send("/live/application/press_current_dialog_button", index);
    await this.sync();
  }

  async reload() {
    const [status, message] = await this.query("/live/api/reload");
    if (status !== "ok") throw new LiveError(`Reload failed: ${message}`);
  }

  // Notes of a Session clip, or of an Arrangement clip with { arrangement: true }, in the
  // clip's own time. window: [pitchStart, pitchSpan, timeStart, timeSpan].
  async notes(track, clip, { arrangement = false, window = [] } = {}) {
    const address = arrangement ? "/live/arrangement_clip/get/notes" : "/live/clip/get/notes";
    const { items } = await this.queryChunks(address, [track, clip, ...window], 2);
    const notes = [];
    for (let i = 0; i < items.length; i += 5) {
      const [pitch, start, duration, velocity, mute] = items.slice(i, i + 5);
      notes.push({ pitch, start, duration, velocity, mute });
    }
    return notes;
  }

  // The track's Arrangement clips, in Live's order: { index, start_time, end_time,
  // start_marker, looping, loop_start, loop_end, is_midi_clip } each, from one reply.
  async arrangementClips(track) {
    const properties = ["start_time", "end_time", "start_marker", "looping", "loop_start", "loop_end", "is_midi_clip"];
    const values = (await this.query("/live/track/get/arrangement_clips/properties", track, ...properties)).slice(1);
    return rows(values, properties.length).map((row, index) =>
      Object.assign({ index }, Object.fromEntries(properties.map((property, i) => [property, row[i]]))));
  }

  // Notes of every MIDI clip in the track's Arrangement as Live plays them, in song
  // beats, sorted by time then pitch.
  async songNotes(track) {
    const out = [];
    for (const clip of await this.arrangementClips(track)) {
      if (!clip.is_midi_clip) continue;
      out.push(...playedNotes(clip, await this.notes(track, clip.index, { arrangement: true })));
    }
    return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }

  async deleteArrangementClips(track) {
    const clips = await this.arrangementClips(track);
    for (const clip of clips.reverse()) this.send("/live/arrangement_clip/delete", track, clip.index);
    await this.sync();
  }

  // With the transport stopped, sets the start marker (Song.start_time, where Play starts)
  // to `beat` and waits to read it back. Sent after a Stop, it lands after the Stop's reset
  // of the marker to 0.
  async startTimeTo(beat, { timeoutMs = 2000 } = {}) {
    await this.sync();
    this.set("song", "start_time", float(beat));
    const deadline = Date.now() + timeoutMs;
    while (Math.abs((await this.get("song", "start_time")) - beat) > 1e-6) {
      if (Date.now() > deadline) throw new LiveError(`The start marker did not move to beat ${beat}`);
      await sleep(20);
    }
  }

  // Records into the Arrangement from beat `start` for `length` beats, with the loop off
  // and Record Quantization None. `tracks` are the tracks the caller armed; if any other
  // track is armed, this refuses rather than record over it (the set may be someone's
  // work). Count-In must be off in the set (the LOM does not expose it). Resolves once the
  // transport has stopped.
  //
  // Play starts from the start marker, Song.start_time, which this sets to `start`; setting
  // current_song_time while stopped doesn't move it, and Stop while stopped puts it back at
  // 0 (measured). Turning record_mode on while stopped starts Play from the marker at once
  // (measured), so the marker is set before it. While a track's Session clip is active
  // (playing_slot_index 0 or more, even with the transport stopped), Live starts Play from
  // the bar at or before the marker: bars of 4 x numerator / denominator beats from beat 0,
  // measured in 4/4, 3/4, 6/8 and 7/8 (one set after a crash started at the marker instead).
  // So a start off a bar line refuses then; time signature changes in the Arrangement are
  // not seen. Cue points are left alone. Any start that reads earlier than `start` stops
  // and fails rather than record from the wrong place.
  //
  // `during`: [{beat, action}], actions to take while it records, e.g. pressing a button
  // mid-play. Each action runs once the song time has passed its beat, and resolves with
  // [{beat, before, after}] in `during`'s order: the song time read just before the action
  // and just after it returned. Live can't schedule a change from outside, so a check
  // reads which step the change landed on from that window. AbletonOSC handles OSC once per
  // 100 ms tick (manager.py), so the window is about one tick wide, and the action lands up
  // to a tick after its beat (measured in Live: windows of 100-120 ms, 4-65 ms late). Within
  // 2 x pollMs of an action's beat, polling every `finePollMs` reads every tick, so the
  // action goes out at the first tick past its beat rather than up to a poll later.
  async recordArrangement({ start = 0, length, tracks, pollMs = 50, finePollMs = 2, during = [] }) {
    if (!Array.isArray(tracks)) throw new LiveError("recordArrangement needs the tracks the caller armed");
    const states = await this.trackData("arm", "playing_slot_index");
    const armed = states.findIndex(([arm], track) => arm && !tracks.includes(track));
    if (armed >= 0) throw new LiveError(`Track ${armed} is armed and not part of this test; disarm it first`);
    // a track with no Session slots reads no number
    const sessionTrack = states.findIndex(([, slot]) => typeof slot === "number" && slot >= 0);
    if (sessionTrack >= 0) {
      const bar = (4 * (await this.get("song", "signature_numerator"))) / (await this.get("song", "signature_denominator"));
      const barStart = Math.floor(start / bar + 1e-9) * bar;
      if (start - barStart > 1e-6) {
        throw new LiveError(`Track ${sessionTrack} has an active Session clip, so Live would start Play from the bar `
          + `at beat ${barStart}, not ${start}: start on a bar line, stop the clips (stop_all_clips or Back to `
          + "Arrangement), or record from 0");
      }
    }
    this.send("/live/song/stop_playing");
    this.set("song", "loop", 0);
    this.set("song", "midi_recording_quantization", 0);
    const msPerBeat = 60000 / (await this.get("song", "tempo"));
    const pending = during.map((step, index) => ({ ...step, index })).sort((a, b) => a.beat - b.beat);
    const windows = [];
    // With Automation Arm on, a parameter changed while it records (a `during` action) is
    // written as automation on the device's track, and replays later (measured in Live).
    const automationArm = await this.get("song", "session_automation_record");
    try {
      if (automationArm) this.set("song", "session_automation_record", 0);
      // the marker first: turning record_mode on while stopped starts Play by itself
      await this.startTimeTo(start);
      this.set("song", "record_mode", 1);
      this.send("/live/song/start_playing");
      await this.sync();
      const started = await this.get("song", "current_song_time");
      if (started < start - 1e-6) {
        throw new LiveError(`Live started at beat ${started.toFixed(3)}, not ${start}; recording stopped`);
      }
      for (let now = started; now < start + length;
        now = await this.get("song", "current_song_time")) {
        while (pending.length && now >= pending[0].beat) {
          const { beat, action, index } = pending.shift();
          await action();
          windows[index] = { beat, before: now, after: await this.get("song", "current_song_time") };
        }
        const untilMs = pending.length ? (pending[0].beat - now) * msPerBeat : Infinity;
        await sleep(untilMs < 2 * pollMs ? finePollMs : pollMs);
      }
      if (pending.length) throw new LiveError(`Recording ended before beat ${pending[0].beat}`);
      return windows;
    } finally {
      this.send("/live/song/stop_playing");
      this.set("song", "record_mode", 0);
      if (automationArm) this.set("song", "session_automation_record", 1);
      await this.sync();
    }
  }
}

async function connect(options) {
  const live = await new Live(options).open();
  startRunLog();
  return live;
}

module.exports = { Live, LiveError, connect, playedNotes };
