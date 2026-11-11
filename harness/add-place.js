#!/usr/bin/env node
"use strict";

// Adds a folder to Live's Places, as Add Folder in Live's browser does: one entry in
// Library.cfg, in the preferences folder of the Live named, with Live quit. Places are told
// apart by path, so any number can share a folder name. Does nothing if the folder is
// already there. Live shows the new Place when it next starts. Refuses an option it doesn't
// know.
//
//   node harness/add-place.js <folder>               for Ableton Live 12 Beta
//   node harness/add-place.js <folder> --suite       for Ableton Live 12 Suite
//   node harness/add-place.js <folder> --app <path>  for the Live at <path>

const fs = require("node:fs");
const path = require("node:path");
const { livePids, BETA, SUITE } = require("./relaunch.js");
const { preferencesFolder } = require("./settings.js");

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeXml = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

function parseArgs(argv) {
  const options = { folder: null, suite: false, app: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite") options.suite = true;
    else if (argv[i] === "--app" && argv[i + 1] && !argv[i + 1].startsWith("--")) options.app = argv[++i];
    else if (argv[i] === "--app") throw new Error("--app needs the path of a Live app");
    else if (argv[i].startsWith("--")) throw new Error(`Unknown option ${argv[i]}: add-place.js takes <folder>, --suite and --app <path>`);
    else if (options.folder === null) options.folder = argv[i];
    else throw new Error(`One folder at a time: got ${options.folder} and ${argv[i]}`);
  }
  if (options.folder === null) throw new Error("usage: add-place.js <folder> [--suite | --app <path>]");
  if (options.suite && options.app) throw new Error("--suite and --app both name a Live: pass one");
  return options;
}

// `text` with an entry for the absolute path `folder` added to its Places, or null if the
// folder is already one. Live rejects the whole file as corrupt if two entries share an Id,
// so the new one is higher than every Id in the file, not only those of Places.
function addPlace(text, folder) {
  const ends = [...text.matchAll(/^([ \t]*)<\/UserFolderInfoList>/gm)];
  const start = text.indexOf("<UserFolderInfoList>");
  if (ends.length !== 1 || start < 0 || start > ends[0].index) throw new Error("Library.cfg doesn't have the one list of Places expected");
  const places = text.slice(start, ends[0].index);
  for (const [, place] of places.matchAll(/<UserFolderInfo\b[^>]*?\bPath="([^"]*)"/g)) {
    if (path.resolve(unescapeXml(place)) === folder) return null;
  }
  const id = Math.max(0, ...[...text.matchAll(/\bId="(\d+)"/g)].map((match) => Number(match[1]))) + 1;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const entry = `${ends[0][1]}\t<UserFolderInfo Id="${id}" Path="${escapeXml(folder)}" `
    + `DisplayName="${escapeXml(path.basename(folder))}" IconName="" />${newline}`;
  return text.slice(0, ends[0].index) + entry + text.slice(ends[0].index);
}

// Whether it changed `file`. Written in one step, so a failure can't leave half a file.
function addPlaceToFile(file, folder) {
  const text = addPlace(fs.readFileSync(file, "utf8"), folder);
  if (text === null) return false;
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { mode: fs.statSync(file).mode });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return true;
}

async function main(argv) {
  const { folder: given, suite, app: chosen } = parseArgs(argv);
  const app = chosen || (suite ? SUITE : BETA);
  if (!fs.existsSync(app)) throw new Error(`${app} isn't installed: name the Live with --app <path>`);
  const folder = path.resolve(given);
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${folder} isn't a folder`);
  if ((await livePids()).length) throw new Error("Live is running, and Library.cfg can be edited only while it is quit: run harness/quit.js first");
  const file = path.join(await preferencesFolder(app), "Library.cfg");
  if (!fs.existsSync(file)) throw new Error(`No ${file}: start this Live once first`);
  console.log(addPlaceToFile(file, folder) ? `ok   added ${folder} to Places in ${file}` : `ok   ${folder} is already in Places`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, addPlace, addPlaceToFile };
