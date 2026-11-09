"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgs, addPlace, addPlaceToFile } = require("../add-place.js");

const LIBRARY = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton>
\t<ContentLibrary>
\t\t<SliceInfoList>
\t\t\t<LibrarySliceInfo Id="900" Path="/packs/one" DisplayName="one" UniqueId="77777" />
\t\t</SliceInfoList>
\t\t<UserFolderInfoList>
\t\t\t<UserFolderInfo Id="10" Path="/dev/first/builds" DisplayName="builds" IconName="" />
\t\t</UserFolderInfoList>
\t</ContentLibrary>
</Ableton>
`;

test("addPlace adds the entry last in the list, with an Id above every Id in the file", () => {
  const entry = '\t\t\t<UserFolderInfo Id="901" Path="/dev/other/devices" DisplayName="devices" IconName="" />\n';
  const end = "\t\t</UserFolderInfoList>";
  assert.equal(addPlace(LIBRARY, "/dev/other/devices"), LIBRARY.replace(end, entry + end));
});

test("addPlace takes a second folder of the same name: Places differ by path", () => {
  const text = addPlace(LIBRARY, "/dev/second/builds");
  assert.match(text, /Path="\/dev\/first\/builds" DisplayName="builds"/);
  assert.match(text, /Path="\/dev\/second\/builds" DisplayName="builds"/);
});

test("addPlace leaves a folder that is already a Place", () => {
  assert.equal(addPlace(LIBRARY, "/dev/first/builds"), null);
  const added = addPlace(LIBRARY, "/dev/a & b");
  assert.match(added, /Path="\/dev\/a &amp; b" DisplayName="a &amp; b"/);
  assert.equal(addPlace(added, "/dev/a & b"), null);
});

test("addPlace refuses a file without one list of Places", () => {
  assert.throws(() => addPlace("<Ableton />", "/dev/x"), /one list of Places/);
});

test("addPlaceToFile writes the file once, keeps its mode and leaves nothing beside it", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "add-place-"));
  try {
    const file = path.join(folder, "Library.cfg");
    fs.writeFileSync(file, LIBRARY, { mode: 0o640 });
    assert.equal(addPlaceToFile(file, "/dev/other/builds"), true);
    assert.equal(addPlaceToFile(file, "/dev/other/builds"), false);
    assert.equal(fs.readFileSync(file, "utf8").match(/\/dev\/other\/builds/g).length, 1);
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
    assert.deepEqual(fs.readdirSync(folder), ["Library.cfg"]);
  } finally {
    fs.rmSync(folder, { recursive: true });
  }
});

test("parseArgs takes one folder and which Live, and refuses anything else", () => {
  assert.deepEqual(parseArgs(["builds"]), { folder: "builds", suite: false, app: null });
  assert.deepEqual(parseArgs(["builds", "--suite"]), { folder: "builds", suite: true, app: null });
  assert.deepEqual(parseArgs(["--app", "/A.app", "builds"]), { folder: "builds", suite: false, app: "/A.app" });
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(["a", "b"]), /One folder at a time/);
  assert.throws(() => parseArgs(["a", "--app"]), /--app needs/);
  assert.throws(() => parseArgs(["a", "--beta"]), /Unknown option --beta/);
});
