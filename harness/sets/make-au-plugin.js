#!/usr/bin/env node
"use strict";

// Remakes au-plugin.als, the fixture plugin.js builds plug-in sets from (ADR-0003), for
// when Live's set format changes: in the running Live, on a set the harness made, it loads
// Apple's AUDelay on track 0, saves the set (saveSetAs, which brings Live to the front),
// and writes empty.als with AUDelay's device block on its MIDI track, cleared of the
// plug-in's state (Preset), its preset references (which name the user's home folder) and
// every parameter slot, with NextPointeeId above every pointee id. Replaces the open set
// with the saved one.
//
//   node harness/relaunch.js && node harness/sets/make-au-plugin.js

const path = require("node:path");
const { connect } = require("../live.js");
const { saveSetAs, tempFolder, inHarnessTemp } = require("../macos.js");
const { readSet, writeSet, findAuDevice, AU_PLUGIN_SET } = require("../plugin.js");

const EMPTY_SET = path.join(__dirname, "empty.als");

// A parameter slot as Live writes a free one: no name, ID -1, unlisted, an unset value
// (0.1234567687 for a float, 0 for an enum) and one item.
const free = (slot, kind) => slot
  .replace(/<ParameterName Value="[^"]*" \/>/, '<ParameterName Value="" />')
  .replace(/<ParameterId Value="-?\d+" \/>/, '<ParameterId Value="-1" />')
  .replace(/<VisualIndex Value="\d+" \/>/, '<VisualIndex Value="1073741823" />')
  .replace(/<Manual Value="[^"]*" \/>/, `<Manual Value="${kind === "Float" ? "0.1234567687" : "0"}" />`)
  .replace(/<LastItemCount Value="\d+" \/>/, '<LastItemCount Value="1" />');

function fixtureFrom(saved) {
  const { start, end } = findAuDevice(saved, "AUDelay");
  const block = (saved.slice(start, end) + "</AuPluginDevice>")
    .replace(/^<AuPluginDevice Id="\d+">/, '<AuPluginDevice Id="0">')
    .replace(/<Preset>[\s\S]*?<\/Preset>/, "<Preset />")
    .replace(/<LastPresetRef>[\s\S]*?<\/LastPresetRef>/, "<LastPresetRef>\n<Value />\n</LastPresetRef>")
    .replace(/<SourceContext>[\s\S]*?<\/SourceContext>/, "<SourceContext>\n<Value />\n</SourceContext>")
    .replace(/<Plugin(Float|Enum)Parameter Id="\d+">[\s\S]*?<\/Plugin\1Parameter>/g, (slot, kind) => free(slot, kind));
  if (/Users|aupreset|<Buffer>/.test(block)) throw new Error("AUDelay's block still holds a path or state");
  let xml = readSet(EMPTY_SET);
  // empty.als has three empty device lists: the MIDI track's (first), Main's and Prehear's.
  if (xml.split("<Devices />").length !== 4) throw new Error("empty.als doesn't have the three empty device lists expected");
  const at = xml.indexOf("<Devices />");
  xml = xml.slice(0, at) + "<Devices>\n" + block + "\n</Devices>" + xml.slice(at + "<Devices />".length);
  const ids = [...xml.matchAll(/<(AutomationTarget|ModulationTarget|Pointee) Id="(\d+)"/g)].map((m) => Number(m[2]));
  if (new Set(ids).size !== ids.length) throw new Error("AUDelay's pointee ids collide with empty.als's");
  return xml.replace(/<NextPointeeId Value="\d+" \/>/, () => `<NextPointeeId Value="${Math.max(...ids) + 1}" />`);
}

async function main() {
  const live = await connect({ timeout: 5000 });
  try {
    const open = await live.get("song", "file_path");
    if (!inHarnessTemp(open)) throw new Error(`The open set (${open || "never saved"}) isn't one the harness made: relaunch first`);
    await live.loadDevice(0, "Plug-Ins", "AUv2/Apple/AUDelay");
    const saved = await saveSetAs(tempFolder("au-plugin-"), "au-plugin-source");
    writeSet(AU_PLUGIN_SET, fixtureFrom(readSet(saved)));
    console.log(`ok   wrote ${AU_PLUGIN_SET} from ${saved}`);
  } finally {
    live.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { fixtureFrom };
