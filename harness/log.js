"use strict";

// Live's own log, Log.txt in the running version's preferences folder
// (~/Library/Preferences/Ableton/Live <version>/). Live appends to it at each launch, after a
// line "info: Started: Live <version> ..." (one file held 31 launches over two days). Every
// Max console message appears there as a line
//   2026-10-31T11:18:03.628353: error: Message from Max:  jsliveapi: get: no valid object set
// in local time. That is where a device that loads and answers OSC but fails inside (a
// gen~ codebox that didn't compile) shows why.

const fs = require("node:fs");
const path = require("node:path");
const { preferencesFolder } = require("./settings.js");

async function liveLogFile() {
  return path.join(await preferencesFolder(), "Log.txt");
}

// A time as Log.txt writes it: local, "YYYY-MM-DDTHH:MM:SS.mmm". Log lines carry
// microseconds, and compare as strings with this.
function logStamp(time) {
  const d = new Date(time);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:`
    + `${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// The Max console messages in a log's text from `since` (ms timestamp or Date) on, or
// without `since` from the last launch on: [{ at, level, text }], `at` as the log writes it.
function parseMaxMessages(text, since) {
  const from = since === undefined ? "" : logStamp(since);
  let out = [];
  for (const line of text.split("\n")) {
    if (since === undefined && /^[\d\-T:.]+: info: Started: Live /.test(line)) out = [];
    const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+): (\w+): Message from Max:\s*(.*)$/);
    if (m && m[1] >= from) out.push({ at: m[1], level: m[2], text: m[3] });
  }
  return out;
}

// The running Live's Max console messages from `since` on, or since it started. Take the
// time before the run:
//   const since = Date.now(); ...run...; const errors = await maxMessages({ since });
async function maxMessages({ since, file } = {}) {
  return parseMaxMessages(fs.readFileSync(file || (await liveLogFile()), "utf8"), since);
}

module.exports = { liveLogFile, logStamp, parseMaxMessages, maxMessages };
