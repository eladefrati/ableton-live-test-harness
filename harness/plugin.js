"use strict";

// Audio Unit plug-ins in Live: making all of a plug-in's parameters reachable over the
// LOM. Live lists a plug-in's parameters as DeviceParameters only when it has at most 64
// of them (Ableton documents an Options.txt entry, -_PluginAutoPopulateThreshold, with
// that default); above that, only those added in Configure mode, a UI gesture. Live keeps
// the configured list in the set, as a device's ParameterList: 128 pairs of slots, a float
// slot (Id 2i) then an enum slot (Id 2i+1), each naming a plug-in parameter by its AU
// parameter ID, or empty (ID -1). Live puts the parameter at index i of the AU's
// ParameterList in pair i, in whichever slot fits its kind, and leaves the other slot of
// the pair empty.
//
// The harness writes such a set itself rather than saving one through Live, whose Save
// panel takes keystrokes only with Live in front (ADR-0003). buildPluginSet fills a fixture,
// sets/au-plugin.als, whose one device is a stateless AUDelay with every slot free: it puts
// in the target plug-in's component codes and names from its Info.plist, and its
// parameters (ID, name, kind, default) from the AU itself (au-parameters.swift) into their
// pairs; `auval -v` only validates the plug-in. relaunch.js
// --plugin starts Live on that set; exposePluginParameters opens it in a running Live.
// VST3 plug-ins are not covered: their parameter IDs need a VST3 host to read.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { openSetAndWait, tempFolder, inHarnessTemp } = require("./macos.js");
const { runInUserSession } = require("./user-session.js");
const tools = require("./tools.js");

const { escapeXml } = tools;

class PluginError extends Error {}

const fourCCValue = (s) => Buffer.from(s, "latin1").readUInt32BE(0);

// Where macOS keeps Audio Units: installed for the user, for every user, and its own
// (Apple's AUDelay is in CoreAudio.component there).
const COMPONENT_FOLDERS = [
  path.join(os.homedir(), "Library", "Audio", "Plug-Ins", "Components"),
  "/Library/Audio/Plug-Ins/Components",
  "/System/Library/Components",
];
// empty.als with AUDelay's device block, cleared of its state (Preset), preset references
// and parameter slots, as sets/make-au-plugin.js writes it from a set Live 12.4.25b1 saved.
// Suite 12.4.3 opens a set built from it.
const AU_PLUGIN_SET = path.join(__dirname, "sets", "au-plugin.als");
// Component types the harness builds sets for: effects and music effects. Instruments
// (aumu) are untested (ADR-0003).
const EFFECT_TYPES = ["aufx", "aumf"];

// AudioUnitParameterUnit values that are enums (Live's enum slots); every other unit is a
// float.
const UNIT_INDEXED = 1;
const UNIT_BOOLEAN = 2;
// How far a raw enum value may sit from a whole number: a plug-in framework can compute an enum's
// default as a float32 product (default * max), which needn't be exact.
const ENUM_TOLERANCE = 1e-3;
// AudioUnitParameterOptions' display scale: the bits that say how a host shows a float's
// range. Live normalizes a Display Logarithmic float on a log scale: AUDelay's Lowpass
// Cutoff Frequency, 10 to 22050 Hz at 15000 Hz, read 0.94996 in Live, ln(1500)/ln(2205)
// (measured on the remote Mac, 2026-11-03).
const DISPLAY_MASK = (7 << 16) | (1 << 22);
const DISPLAY_LOGARITHMIC = 1 << 22;

// The helper's parameters (au-parameters.swift) as the builder takes them: [{ id, name,
// unit, flags, enum, items, min, max, default }], in the helper's order, which is the AU's
// ParameterList order and must be kept. A float keeps its raw min, max and default. An
// enum's are item indices: min 0, max its item count less one, default the item at its raw
// default, so an Indexed parameter whose raw values start at 1 starts at item 0. items are
// an Indexed parameter's value strings, if it has them. Refuses a parameter with no name,
// an empty or inverted range, a default outside it, or an enum whose values aren't whole.
function mapParameters(raw) {
  return raw.map(({ id, name, unit, flags, min, max, default: value, items = [] }) => {
    const where = `The AU's parameter ${id} (${name || "no name"})`;
    if (!Number.isInteger(id) || !name) throw new PluginError(`${where} has no ${name ? "integer ID" : "name"}`);
    if (![min, max, value].every(Number.isFinite) || !(max > min) || value < min || value > max) {
      throw new PluginError(`${where} has range ${min} to ${max} and default ${value}`);
    }
    if (unit !== UNIT_INDEXED && unit !== UNIT_BOOLEAN) {
      if ((flags & DISPLAY_MASK) === DISPLAY_LOGARITHMIC && !(min > 0)) {
        throw new PluginError(`${where} is shown on a log scale but its range starts at ${min}`);
      }
      return { id, name, unit, flags, enum: false, items: [], min, max, default: value };
    }
    const whole = (x) => Math.abs(x - Math.round(x)) <= ENUM_TOLERANCE;
    const count = Math.round(max - min) + 1;
    if (!whole(max - min) || !whole(value - min) || (items.length && items.length !== count)) {
      throw new PluginError(`${where} is an enum with range ${min} to ${max}, default ${value} and ${items.length} items`);
    }
    return { id, name, unit, flags, enum: true, items, min: 0, max: count - 1, default: Math.round(value - min) };
  });
}

// Runs a command in this process's own session (plutil); auval and the helper go through
// runInUserSession instead.
const run = (cmd, args) => tools.run(cmd, args).catch((e) => {
  throw new PluginError(e.message, { cause: e });
});

const HELPER_SOURCE = path.join(__dirname, "au-parameters.swift");
const HELPER_MARK = "AU-PARAMETERS ";

// The path of the compiled helper (helperBinary in tools.js).
const helperBinary = () => tools.helperBinary(HELPER_SOURCE).catch((e) => {
  throw new PluginError(e.message, { cause: e });
});

// The parameters of the AU with these component codes (four-character strings), from the
// helper (mapParameters), in the AU's ParameterList order. `auval -v` validates the
// plug-in at the same time and must report success. Both instantiate the plug-in outside
// Live, in the user's GUI session, the only one that sees the user's own AUs
// (user-session.js).
async function auParameters({ type, subtype, manufacturer }) {
  const codes = [type, subtype, manufacturer];
  const binary = await helperBinary();
  const inSession = (cmd, args) => runInUserSession(cmd, args).catch((e) => {
    throw new PluginError(e.message, { cause: e });
  });
  const [out, validation] = await Promise.all([
    inSession(binary, codes.map((c) => String(fourCCValue(c)))),
    inSession("auval", ["-v", ...codes]),
  ]);
  if (!validation.includes("AU VALIDATION SUCCEEDED")) {
    throw new PluginError(`auval -v ${codes.join(" ")} did not report AU VALIDATION SUCCEEDED: ${validation.trim().split("\n").pop()}`);
  }
  const line = out.split("\n").find((l) => l.startsWith(HELPER_MARK));
  if (!line) throw new PluginError(`${path.basename(HELPER_SOURCE)} printed no parameters for ${codes.join(" ")}`);
  const params = mapParameters(JSON.parse(line.slice(HELPER_MARK.length)).parameters);
  if (params.length === 0) throw new PluginError(`The AU ${codes.join(" ")} has no parameters`);
  return params;
}

// The effects named `name` among `infos`, [{ bundle, components }] with each bundle's
// AudioComponents entries: { found: [{ bundle, type, subtype, manufacturer, maker, name }],
// others: [{ bundle, type }] } (others: entries of the name that aren't effects, such as
// a plug-in's MIDI-effect twin). An entry's name reads "Maker: Name"; Live shows the part
// after the colon. Refuses a matching entry whose codes aren't four characters.
function componentsNamed(infos, name, types = EFFECT_TYPES) {
  const found = [];
  const others = [];
  for (const { bundle, components } of infos) {
    for (const entry of components || []) {
      const at = String(entry.name).indexOf(": ");
      if (at < 0 || entry.name.slice(at + 2) !== name) continue;
      if (!types.includes(entry.type)) {
        others.push({ bundle, type: entry.type });
        continue;
      }
      const codes = [entry.type, entry.subtype, entry.manufacturer];
      if (!codes.every((c) => typeof c === "string" && Buffer.byteLength(c, "latin1") === 4)) {
        throw new PluginError(`${bundle} names ${name} with codes ${codes.join(" ")}, not four characters each`);
      }
      found.push({ bundle, type: entry.type, subtype: entry.subtype, manufacturer: entry.manufacturer,
        maker: entry.name.slice(0, at), name });
    }
  }
  return { found, others };
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// The installed effect named `name`, from the AudioComponents of the components in
// `folders`. Refuses unless exactly one matches: a set naming a component that isn't
// installed opens without a word, as a device listing every parameter in the file.
async function findComponent(name, folders = COMPONENT_FOLDERS) {
  const bundles = folders.filter((f) => fs.existsSync(f)).flatMap((folder) =>
    fs.readdirSync(folder).filter((e) => e.endsWith(".component")).map((e) => path.join(folder, e)));
  // plutil converts only the AudioComponents array; one per bundle, sixteen at a time
  // (about 450 bundles took 6.7 s one after another).
  const infos = await mapLimited(bundles, 16, async (bundle) => {
    const file = path.join(bundle, "Contents", "Info.plist");
    try {
      return { bundle, components: JSON.parse(await run("plutil", ["-extract", "AudioComponents", "json", "-o", "-", file])) };
    } catch {
      return { bundle, components: [] }; // no Info.plist, or no AudioComponents in it
    }
  });
  const { found, others } = componentsNamed(infos, name);
  if (found.length === 1) return found[0];
  const where = found.map((c) => c.bundle).join(", ");
  const not = others.length ? `; not effects: ${others.map((o) => `${o.bundle} (${o.type})`).join(", ")}` : "";
  throw new PluginError(`${found.length} installed effects (${EFFECT_TYPES.join(", ")}) are named ${name}`
    + `${where ? ` (${where})` : ""}${not}; expected one`);
}

// When the component's code was last built: the newest modification time of the files in
// its Contents/MacOS, in ms, or null if it has none. Live plays the build it loaded until it
// relaunches, so this tells a fresh build from a stale one.
function builtAt(bundle) {
  const folder = path.join(bundle, "Contents", "MacOS");
  let files;
  try {
    files = fs.readdirSync(folder);
  } catch {
    return null;
  }
  const times = files.map((f) => fs.statSync(path.join(folder, f)).mtimeMs);
  return times.length ? Math.max(...times) : null;
}

function findAuDevice(xml, name) {
  const found = [];
  const open = /<AuPluginDevice Id="\d+">/g;
  for (let m; (m = open.exec(xml));) {
    const end = xml.indexOf("</AuPluginDevice>", m.index);
    const info = xml.slice(m.index, end).match(/<AuPluginInfo Id="\d+">[\s\S]*?<\/AuPluginInfo>/);
    if (info && info[0].includes(`<Name Value="${escapeXml(name)}" />`)) found.push({ start: m.index, end });
  }
  if (found.length !== 1) throw new PluginError(`The set has ${found.length} Audio Unit devices named ${name}; expected one`);
  return found[0];
}

const readSet = (file) => zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
const writeSet = (file, xml) => fs.writeFileSync(file, zlib.gzipSync(xml));

// A parameter's default as Live keeps it in a slot's Manual: an enum's item index, a
// float's place in its range from 0 to 1 (AUDelay's 50 % mix is 0.5 in a set Live wrote),
// on a log scale for a Display Logarithmic one.
function normalizedDefault(p) {
  if (p.enum) return p.default;
  if ((p.flags & DISPLAY_MASK) === DISPLAY_LOGARITHMIC) return Math.log(p.default / p.min) / Math.log(p.max / p.min);
  return (p.default - p.min) / (p.max - p.min);
}

// Live keeps 128 pairs of parameter slots per plug-in device.
const SLOT_PAIRS = 128;

// The fixture's xml (`template`, its one device AUDelay) turned into `component`'s, with
// `params` (from auParameters, in the AU's own order) in their slots as Live puts them:
// parameter i into pair i, the float slot (Id 2i) for a float and the enum slot (Id 2i+1)
// for an enum, the other slot of the pair left free, its default as the value and i as its
// place in Live's list. Filling floats and enums into the first free slots of their kind
// instead put a float and an enum in one pair; both read back in Live, but some floats
// never reached the plug-in (with one plug-in, one float did not while another did;
// measured 2026-10-31). The block keeps AUDelay's bus counts, which didn't matter: it ran
// a plug-in with a different bus count (2026-11-02). Values go in through replacer
// functions, so a "$" in a name is written as it is.
function fillPluginSet(template, component, params) {
  if (params.length > SLOT_PAIRS) {
    throw new PluginError(`${component.name} has ${params.length} parameters; Live keeps ${SLOT_PAIRS} slot pairs`);
  }
  const { start, end } = findAuDevice(template, "AUDelay");
  let device = template.slice(start, end);
  const setInfo = (key, value) => {
    const re = new RegExp(`(<AuPluginInfo Id="\\d+">[\\s\\S]*?)<${key} Value="[^"]*" />`);
    if (!re.test(device)) throw new PluginError(`The fixture's AuPluginInfo has no ${key}`);
    device = device.replace(re, (_, before) => `${before}<${key} Value="${value}" />`);
  };
  setInfo("ComponentType", fourCCValue(component.type));
  setInfo("ComponentSubType", fourCCValue(component.subtype));
  setInfo("ComponentManufacturer", fourCCValue(component.manufacturer));
  setInfo("Name", escapeXml(component.name));
  setInfo("Manufacturer", escapeXml(component.maker));
  device = device.replace(/<Plugin(Float|Enum)Parameter Id="(\d+)">[\s\S]*?<\/Plugin\1Parameter>/g, (slot, kind, id) => {
    const i = Math.floor(Number(id) / 2);
    const p = params[i];
    if (!p || kind !== (p.enum ? "Enum" : "Float")) return slot;
    if (!slot.includes('<ParameterId Value="-1" />')) throw new PluginError(`The fixture's slot ${id} isn't free`);
    const manual = normalizedDefault(p);
    return slot
      .replace(/<ParameterName Value="[^"]*" \/>/, () => `<ParameterName Value="${escapeXml(p.name)}" />`)
      .replace(/<ParameterId Value="-1" \/>/, () => `<ParameterId Value="${p.id}" />`)
      .replace(/<VisualIndex Value="\d+" \/>/, () => `<VisualIndex Value="${i}" />`)
      .replace(/<Manual Value="[^"]*" \/>/, () => `<Manual Value="${manual}" />`)
      // An enum slot's item count, which Live keeps from the set: left at 1, every
      // value read back as 0 (measured 2026-10-31).
      .replace(/<LastItemCount Value="\d+" \/>/, () => `<LastItemCount Value="${p.max + 1}" />`);
  });
  return template.slice(0, start) + device + template.slice(end);
}

// The xml of a set whose one track holds the installed Audio Unit named `name`, every
// parameter listed (see the top of this file), the plug-in with no saved state. Resolves
// with { xml, component, parameters }.
async function buildPluginSet(name) {
  const component = await findComponent(name);
  const parameters = await auParameters(component);
  return { xml: fillPluginSet(readSet(AU_PLUGIN_SET), component, parameters), component, parameters };
}

// Resolves with { track, device } once Live lists the Audio Unit named `name` on a track's
// top-level chain with every one of `parameters` (auParameters), running the plug-in
// itself. A set naming a plug-in Live doesn't load (not installed when Live scanned, Audio
// Units off, deactivated after a failed scan) opens without a word as a stand-in listing
// the file's parameters; its enum values read as bare numbers ("0") where the plug-in names
// them ("Off"; measured 2026-11-02). So the first enum parameter's value string must be
// one of its items, or not a number for a Boolean. A plug-in with no enum parameter can't
// be told from its stand-in this way and passes on the count alone.
async function checkPluginLoaded(live, name, parameters) {
  const { track, device } = await live.findDevice(name);
  const listed = (await live.get("device", "num_parameters", track, device)) - 1;
  if (listed < parameters.length) throw new PluginError(`Live lists ${listed} of ${name}'s ${parameters.length} parameters`);
  const i = parameters.findIndex((p) => p.enum);
  if (i < 0) return { track, device };
  const p = parameters[i];
  // Live lists the parameters after Device On in VisualIndex order: parameter i at i + 1.
  const [, , , label] = await live.query("/live/device/get/parameter/name", track, device, i + 1);
  const [, , , text] = await live.query("/live/device/get/parameter/value_string", track, device, i + 1);
  if (label !== p.name) throw new PluginError(`${name}'s parameter ${i + 1} is ${label}, not ${p.name}`);
  const named = p.items.length ? p.items.includes(text) : !/^-?\d+(\.\d+)?$/.test(String(text));
  if (!named) {
    throw new PluginError(`${name} on track ${track} lists its parameters but isn't running: ${p.name} reads "${text}", `
      + "not one of the plug-in's own values. Check that Live has scanned it (relaunch.js) and that Audio Units are on");
  }
  return { track, device };
}

// Makes every parameter of the Audio Unit effect named `name` a DeviceParameter, so checks
// can set it by name, and resolves with { track, device, parameters, file } (file: the set
// now open; recordings go to the Temp Project Live makes for it). If the open set already
// holds the plug-in that way, that is all. Otherwise it opens a set holding only the
// plug-in (buildPluginSet), behind other windows: the song is the fixture's, at 120 BPM,
// whatever the open set had. It refuses to replace a set the harness didn't make, since
// opening answers "Save changes?" with Don't Save; after a relaunch, `relaunch.js --plugin
// <name>` starts Live on the set instead. `reopen` opens a freshly built set even if the
// open one holds the plug-in, for a check that needs every parameter at its default.
async function exposePluginParameters(live, name, { reopen = false } = {}) {
  const { xml, parameters } = await buildPluginSet(name);
  if (!reopen) {
    try {
      const found = await checkPluginLoaded(live, name, parameters);
      return { ...found, parameters, file: await live.get("song", "file_path") };
    } catch {
      // Not there, or not every parameter, or a stand-in: replace the set.
    }
  }
  // Checked last, just before the open: building takes seconds, in which the user could
  // open a set of their own.
  const open = await live.get("song", "file_path");
  if (!inHarnessTemp(open)) {
    throw new PluginError(`The open set (${open || "never saved"}) isn't one the harness made, and opening ${name}'s `
      + `would discard it: start Live with relaunch.js --plugin "${name}"`);
  }
  const file = path.join(tempFolder("plugin-"), "harness-plugin.als");
  writeSet(file, xml);
  await openSetAndWait(live, file);
  return { ...(await checkPluginLoaded(live, name, parameters)), parameters, file };
}

module.exports = {
  PluginError, mapParameters, auParameters, componentsNamed, findComponent, builtAt, findAuDevice,
  fillPluginSet, buildPluginSet, checkPluginLoaded, exposePluginParameters, readSet, writeSet, AU_PLUGIN_SET,
};
