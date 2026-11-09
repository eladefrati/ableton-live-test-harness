"use strict";

const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapParameters, auParameters, findAuDevice, componentsNamed, fillPluginSet, checkPluginLoaded, readSet,
  AU_PLUGIN_SET } = require("../plugin.js");

// A plug-in's parameters as au-parameters.swift prints them: a float, a Boolean and an
// Indexed one.
const RAW = [
  { id: 101, name: "Float", unit: 0, flags: 0, min: 0, max: 1, default: 0.5, items: [] },
  { id: 202, name: "Boolean", unit: 2, flags: 0, min: 0, max: 1, default: 0, items: [] },
  { id: 303, name: "Menu", unit: 1, flags: 0, min: 0, max: 2, default: 1,
    items: ["A", "Off", "B"] },
];
const PARAMS = mapParameters(RAW);

test("mapParameters keeps raw float ranges and turns enums into item indices", () => {
  assert.deepEqual(PARAMS, [
    { id: 101, name: "Float", unit: 0, flags: 0, enum: false, items: [], min: 0, max: 1, default: 0.5 },
    { id: 202, name: "Boolean", unit: 2, flags: 0, enum: true, items: [], min: 0, max: 1, default: 0 },
    { id: 303, name: "Menu", unit: 1, flags: 0, enum: true, items: ["A", "Off", "B"],
      min: 0, max: 2, default: 1 },
  ]);
});

test("mapParameters keeps the AU's order, not the IDs'", () => {
  // A plug-in's own parameter order need not be ID order: a later parameter with a lower ID
  // can come last.
  const order = mapParameters([{ ...RAW[0], id: 500 }, { ...RAW[0], id: 20, name: "B" }, { ...RAW[0], id: 300, name: "C" }]);
  assert.deepEqual(order.map((p) => p.id), [500, 20, 300]);
});

test("mapParameters counts an enum's items from its minimum and rounds a float32 default", () => {
  const [ratio] = mapParameters([{ id: 1, name: "Steps", unit: 1, flags: 0, min: 1, max: 8, default: 3.0000002, items: [] }]);
  assert.deepEqual([ratio.min, ratio.max, ratio.default], [0, 7, 2]);
  const [on] = mapParameters([{ ...RAW[1], default: 0.99999994 }]);
  assert.equal(on.default, 1);
});

test("mapParameters refuses what it can't write into a slot", () => {
  const bad = (change) => () => mapParameters([{ ...RAW[0], ...change }]);
  assert.throws(bad({ name: "" }), /parameter 101 \(no name\) has no name/);
  assert.throws(bad({ min: 1, max: 1 }), /range 1 to 1/);
  assert.throws(bad({ default: 2 }), /default 2/);
  assert.throws(() => mapParameters([{ ...RAW[2], default: 1.5 }]), /enum with range 0 to 2, default 1.5/);
  assert.throws(() => mapParameters([{ ...RAW[2], items: ["One", "Two"] }]), /and 2 items/);
});

// Runs the real helper and auval on Apple's AUDelay, in the GUI session; builds the helper
// with swiftc if it isn't cached.
const hasDeveloperTools = (() => {
  try { execFileSync("xcode-select", ["-p"], { stdio: "ignore" }); return true; } catch { return false; }
})();
test("auParameters reads AUDelay from the AU itself", { skip: !hasDeveloperTools && "no developer tools", timeout: 300000 },
  async () => {
    const params = await auParameters({ type: "aufx", subtype: "dely", manufacturer: "appl" });
    assert.deepEqual(params.map((p) => [p.id, p.name, p.enum]),
      [[0, "Dry/Wet Mix", false], [1, "Delay Time", false], [2, "Feedback", false], [3, "Lowpass Cutoff Frequency", false]]);
    // The ranges plugin-record.js depends on.
    assert.ok(Math.abs(params[1].min - 0.0001) < 1e-9 && params[1].max === 2);
    assert.ok(Math.abs(params[2].min + 99.9) < 1e-4 && Math.abs(params[2].max - 99.9) < 1e-4);
  });

const slotsOf = (xml) => xml.match(/<Plugin(Float|Enum)Parameter Id="\d+">[\s\S]*?<\/Plugin\1Parameter>/g);
const PLUGIN = { type: "aumf", subtype: "Plg1", manufacturer: "Plgn", maker: "Plugin", name: "Plugin" };
const fixture = () => readSet(AU_PLUGIN_SET);

test("findAuDevice finds the device by plug-in name", () => {
  const xml = fixture();
  const found = findAuDevice(xml, "AUDelay");
  assert.ok(xml.slice(found.start, found.end).startsWith("<AuPluginDevice"));
  assert.throws(() => findAuDevice(xml, "Plugin"), /0 Audio Unit devices named Plugin/);
  assert.throws(() => findAuDevice(xml + xml, "AUDelay"), /2 Audio Unit devices named AUDelay/);
});

test("fillPluginSet puts parameter i in pair i, by kind, with order, normalized default and item count", () => {
  const xml = fillPluginSet(fixture(), PLUGIN, PARAMS);
  const slots = slotsOf(xml.slice(findAuDevice(xml, "Plugin").start));
  // Float, parameter 0, a float: slot 0; its pair's enum slot stays free.
  assert.match(slots[0], /ParameterName Value="Float"[\s\S]*ParameterId Value="101"[\s\S]*VisualIndex Value="0"[\s\S]*Manual Value="0.5"/);
  assert.match(slots[1], /ParameterId Value="-1"/);
  // Boolean, parameter 1, and Menu, parameter 2, are enums: slots 3 and 5.
  assert.match(slots[2], /ParameterId Value="-1"/);
  assert.match(slots[3], /ParameterName Value="Boolean"[\s\S]*VisualIndex Value="1"[\s\S]*Manual Value="0"[\s\S]*LastItemCount Value="2"/);
  assert.match(slots[5], /ParameterName Value="Menu"[\s\S]*ParameterId Value="303"[\s\S]*VisualIndex Value="2"[\s\S]*Manual Value="1"[\s\S]*LastItemCount Value="3"/);
  assert.equal(slots.filter((s) => !s.includes('<ParameterId Value="-1" />')).length, 3);
});

test("fillPluginSet normalizes a float's default to its range", () => {
  const params = mapParameters([{ id: 1, name: "Amount", unit: 3, flags: 0, min: -100, max: 100, default: 50 }]);
  assert.match(slotsOf(fillPluginSet(fixture(), PLUGIN, params).split("<AuPluginDevice")[1])[0], /Manual Value="0.75"/);
});

test("fillPluginSet normalizes a Display Logarithmic float on a log scale, as Live does", () => {
  // AUDelay's Lowpass Cutoff Frequency (flags 0xC8400000): Live read 0.94996.
  const params = mapParameters([{ id: 3, name: "Lowpass Cutoff Frequency", unit: 8, flags: 0xC8400000, min: 10,
    max: 22050, default: 15000 }]);
  const manual = Number(slotsOf(fillPluginSet(fixture(), PLUGIN, params).split("<AuPluginDevice")[1])[0]
    .match(/Manual Value="([^"]*)"/)[1]);
  assert.ok(Math.abs(manual - 0.94996) < 1e-4, `Manual ${manual}`);
  assert.throws(() => mapParameters([{ ...params[0], items: [], min: 0 }]), /log scale but its range starts at 0/);
});

test("fillPluginSet writes names with $ in them as they are", () => {
  const params = mapParameters(RAW);
  params[0].name = "Wet $& Dry $$ $'";
  const xml = fillPluginSet(fixture(), { ...PLUGIN, maker: "Pro$`Audio", name: "Ca$$h" }, params);
  const { start, end } = findAuDevice(xml, "Ca$$h");
  const block = xml.slice(start, end);
  assert.match(block, /<Manufacturer Value="Pro\$`Audio" \/>/);
  assert.ok(block.includes(`<ParameterName Value="Wet $&amp; Dry $$ $'" />`));
  assert.ok(xml.length - fixture().length < 2000); // nothing spliced in by $`
});

test("fillPluginSet refuses more parameters than Live keeps slot pairs", () => {
  const params = Array.from({ length: 129 }, (_, i) => ({ ...PARAMS[0], id: i }));
  assert.throws(() => fillPluginSet(fixture(), PLUGIN, params), /129 parameters; Live keeps 128 slot pairs/);
});

test("componentsNamed matches effects by the name after the maker, in every bundle", () => {
  const plugin = { name: "Plugin: Plugin", type: "aumf", subtype: "Plg1", manufacturer: "Plgn" };
  const infos = [
    { bundle: "/a/Plugin.component", components: [plugin] },
    { bundle: "/a/Other.component", components: [{ name: "Plugin: Plugin Two", type: "aufx" }, { name: "Plugin", type: "aufx" }] },
    { bundle: "/a/Empty.component", components: [] },
  ];
  assert.deepEqual(componentsNamed(infos, "Plugin").found,
    [{ bundle: "/a/Plugin.component", type: "aumf", subtype: "Plg1", manufacturer: "Plgn", maker: "Plugin", name: "Plugin" }]);
  assert.equal(componentsNamed([...infos, { bundle: "/b/Plugin.component", components: [plugin] }], "Plugin").found.length, 2);
});

test("componentsNamed keeps other types of the same name apart, and refuses bad codes", () => {
  const twin = (type) => ({ name: "Maker: Twin", type, subtype: "Twin", manufacturer: "Makr" });
  const { found, others } = componentsNamed([{ bundle: "/a/Twin.component", components: [twin("aumi")] },
    { bundle: "/a/Twin_MFX.component", components: [twin("aumf")] }], "Twin");
  assert.deepEqual(found.map((c) => c.bundle), ["/a/Twin_MFX.component"]);
  assert.deepEqual(others, [{ bundle: "/a/Twin.component", type: "aumi" }]);
  assert.throws(() => componentsNamed([{ bundle: "/a/X.component", components: [{ ...twin("aufx"), subtype: 123 }] }],
    "Twin"), /not four characters each/);
});

test("the fixture holds one stateless AUDelay with every slot free", () => {
  const xml = readSet(AU_PLUGIN_SET);
  const { start, end } = findAuDevice(xml, "AUDelay");
  const block = xml.slice(start, end);
  assert.equal((xml.match(/<AuPluginDevice Id=/g) || []).length, 1);
  assert.match(block, /<Preset \/>/);
  assert.doesNotMatch(block, /Users|aupreset|<Buffer>/);
  assert.equal(slotsOf(block).length, 256);
  assert.ok(slotsOf(block).every((s) => s.includes('<ParameterId Value="-1" />')));
  const ids = [...xml.matchAll(/<(AutomationTarget|ModulationTarget|Pointee) Id="(\d+)"/g)].map((m) => Number(m[2]));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Number(xml.match(/<NextPointeeId Value="(\d+)" \/>/)[1]) > Math.max(...ids));
});


const liveWith = (names, strings) => ({
  findDevice: async () => ({ track: 0, device: 0 }),
  get: async () => names.length + 1,
  query: async (address, track, device, i) => [track, device, i,
    address.endsWith("/name") ? names[i - 1] : strings[i - 1]],
});

test("checkPluginLoaded takes the plug-in's own value strings and refuses a stand-in's numbers", async () => {
  const params = PARAMS;
  const names = params.map((p) => p.name);
  assert.deepEqual(await checkPluginLoaded(liveWith(names, ["0.50", "Off", "Off"]), "Plugin", params), { track: 0, device: 0 });
  await assert.rejects(checkPluginLoaded(liveWith(names, ["0.50", "0", "1"]), "Plugin", params),
    /lists its parameters but isn't running: Boolean reads "0"/);
  const menuFirst = [params[2], params[0]];
  await assert.rejects(checkPluginLoaded(liveWith(["Menu", "Float"], ["Bogus", "0.50"]), "Plugin", menuFirst),
    /Menu reads "Bogus"/);
  await assert.rejects(checkPluginLoaded(liveWith(names.slice(0, 2), ["0.50", "Off"]), "Plugin", params),
    /Live lists 2 of Plugin's 3 parameters/);
  await assert.rejects(checkPluginLoaded(liveWith(["Float", "Menu", "Boolean"], ["0.50", "Off", "Off"]), "Plugin", params),
    /parameter 2 is Menu, not Boolean/);
});
