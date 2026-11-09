#!/usr/bin/env node
"use strict";

// Checks the set the harness builds for an Audio Unit effect against the plug-in as Live
// lists it itself (ADR-0003). It opens a freshly built set (exposePluginParameters with
// reopen, since a set an earlier check used holds the values it set), then loads the plug-in again from Live's Plug-Ins browser onto a new audio track,
// where Live populates its parameters itself. It checks that:
//   - the built device lists every parameter the AU publishes, in the AU's order;
//   - Live's own list is the built list with at most some parameters left out (Live leaves
//     out Not Real Time ones, as AUDelay's Delay Time), in the same order;
//   - each parameter Live lists has the same value on both devices: the built one's comes
//     from the file (its Manual), the fresh one's from the plug-in.
// Live populates a plug-in itself only up to 64 parameters, so a larger one is refused.
// The new track is deleted afterwards (--keep leaves it). Exits 1 on failure.
//
//   node harness/checks/plugin-set.js <plug-in name> [--keep]

const { connect } = require("../live.js");
const { exposePluginParameters, findComponent } = require("../plugin.js");

// Live's own population threshold (plugin.js).
const AUTO_POPULATE = 64;
// Over the LOM a float's value is normalized 0..1 and an enum's is its item index; Live
// keeps them as float32.
const TOLERANCE = 1e-4;

const listed = async (live, track, device) => {
  const names = (await live.query("/live/device/get/parameters/name", track, device)).slice(3); // after Device On
  const values = (await live.query("/live/device/get/parameters/value", track, device)).slice(3);
  return names.map((name, i) => ({ name, value: values[i] }));
};

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) throw new Error("usage: plugin-set.js <plug-in name> [--keep]");
  const live = await connect({ timeout: 5000 });
  let track = null;
  const report = (pass, text) => {
    console.log(`${pass ? "PASS" : "FAIL"}: ${text}`);
    if (!pass) process.exitCode = 1;
  };
  try {
    const component = await findComponent(name);
    const plugin = await exposePluginParameters(live, name, { reopen: true });
    if (plugin.parameters.length > AUTO_POPULATE) {
      throw new Error(`${name} has ${plugin.parameters.length} parameters; Live populates only up to ${AUTO_POPULATE} itself`);
    }
    const built = await listed(live, plugin.track, plugin.device);
    const want = plugin.parameters.map((p) => p.name);
    report(built.length === want.length && built.every((b, i) => b.name === want[i]),
      `the built ${name} lists the AU's ${want.length} parameters in the AU's order`
      + (built.length === want.length ? "" : ` (Live lists ${built.length})`));

    track = await live.createAudioTrack(`plugin-set ${name}`);
    const vendor = component.maker;
    const item = `AUv2/${vendor}/${name}`;
    const device = await live.loadDevice(track, "Plug-Ins", item);
    const own = await listed(live, track, device);

    const pairs = [];
    const leftOut = [];
    let j = 0;
    for (const b of built) {
      if (j < own.length && own[j].name === b.name) pairs.push({ name: b.name, built: b.value, own: own[j++].value });
      else leftOut.push(b.name);
    }
    report(j === own.length, `Live's own ${name} (${item}) lists ${own.length} parameters in the built order`
      + (leftOut.length ? `, leaving out ${leftOut.join(", ")}` : "")
      + (j === own.length ? "" : `; its parameter ${j + 1}, ${own[j].name}, is out of order or not in the built set`));
    const off = pairs.filter((p) => !(Math.abs(p.built - p.own) <= TOLERANCE));
    report(off.length === 0, `${pairs.length - off.length} of ${pairs.length} parameters have the same value on both`
      + (off.length ? `; differ: ${off.map((p) => `${p.name} ${p.built} built, ${p.own} Live's own`).join("; ")}` : ""));
  } finally {
    if (track !== null && !keep) {
      live.send("/live/song/delete_track", track);
      await live.sync().catch(() => {});
    }
    live.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
