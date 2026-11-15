"use strict";

// remote.sh with two local folders standing in for the two Macs: `ssh` and `rsync` on PATH
// are stand-ins that run the remote's side in a folder of its own, as its home.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REMOTE_SH = path.join(__dirname, "..", "remote.sh");
const HOST = "stand-in";

// ssh <host> <words...>: runs the words in the remote's home, as ssh runs them in a shell
// there. rsync: a "<host>:<path>" argument becomes that path in the remote's home. Each fails
// as a dropped connection does when its words hold SSH_FAILS or RSYNC_FAILS.
const SSH = `#!/bin/zsh
shift
if [[ -n $SSH_FAILS && "$*" == *$SSH_FAILS* ]]; then print -u2 "Connection closed by stand-in"; exit 255; fi
cd "$THERE" && HOME="$THERE" TMPDIR="$THERE_TMP" exec zsh -c "$*"
`;
const RSYNC = `#!/bin/zsh
if [[ -n $RSYNC_FAILS && "$*" == *$RSYNC_FAILS* ]]; then print -u2 "rsync: connection unexpectedly closed"; exit 12; fi
args=()
for a in "$@"; do
  if [[ $a == ${HOST}:* ]]; then
    p=\${a#${HOST}:}
    [[ $p == /* ]] || p=$THERE/$p
    args+=("$p")
  else
    args+=("$a")
  fi
done
exec /usr/bin/rsync "\${args[@]}"
`;

// The stand-ins, made once for the file: macOS scans each new program the first time it runs,
// and a queue of scans held up other test files' programs past their tests' times.
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), "remote-test-bin-"));
process.on("exit", () => fs.rmSync(BIN, { recursive: true, force: true }));
for (const [name, body] of [["ssh", SSH], ["rsync", RSYNC]]) {
  fs.writeFileSync(path.join(BIN, name), body, { mode: 0o755 });
}

function macs(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "remote-test-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = (...parts) => path.join(root, ...parts);
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  // The harness as remote.sh copies it: what the remote's side runs of it.
  write(at("here", "dev", "ableton-live-test-harness", "harness", "captures.js"), fs.readFileSync(path.join(__dirname, "..", "captures.js")));
  fs.mkdirSync(at("there"));
  return {
    at, write,
    hereCaptures: at("here-tmp", "ableton-harness-captures"),
    thereCaptures: at("there-tmp", "ableton-harness-captures"),
    // remote.sh run with `words`, and `env` added to its environment.
    runWith: (env, ...words) => spawnSync("zsh", [REMOTE_SH, ...words], {
      encoding: "utf8",
      timeout: RUN_MS,
      env: {
        ...process.env, HOME: at("here"), TMPDIR: `${at("here-tmp")}/`, LIVE_REMOTE: HOST,
        PATH: `${BIN}:${process.env.PATH}`, THERE: at("there"), THERE_TMP: `${at("there-tmp")}/`, ...env,
      },
    }),
  };
}

// A run takes about a second; one that hangs is ended, and its test fails, after this.
const RUN_MS = 60000;
const run = (mac, ...words) => mac.runWith({}, ...words);

const read = (file) => fs.readFileSync(file, "utf8");

test("remote.sh copies the repo over, runs the command there, brings its logs back, and exits with its status", (t) => {
  const mac = macs(t);
  mac.write(mac.at("here", "dev", "project", "file.txt"), "here");
  const ran = run(mac, "project", "sh", "-c", "cat file.txt > ran.txt; mkdir -p tests/live/logs; echo log > tests/live/logs/run.log; exit 3");
  assert.equal(ran.status, 3, ran.stderr);
  assert.equal(read(mac.at("there", "dev", "project", "ran.txt")), "here");
  assert.equal(read(mac.at("here", "dev", "project", "tests", "live", "logs", "run.log")), "log\n");
  assert.ok(!fs.existsSync(mac.at("there", "dev", "project", "tests", "live", "logs", "run.log")), "moved, not copied");
});

test("remote.sh brings the remote's finished captures back to this Mac's captures folder, leaving unfinished ones and names already here", (t) => {
  const mac = macs(t);
  mac.write(path.join(mac.thereCaptures, "still.png"), "still there");
  mac.write(path.join(mac.thereCaptures, "video.mov"), "video there");
  mac.write(path.join(mac.thereCaptures, ".unfinished", "recording.mov"), "recording there");
  mac.write(path.join(mac.thereCaptures, "same.png"), "same there");
  mac.write(path.join(mac.hereCaptures, "same.png"), "same here");
  const ran = run(mac, "ableton-live-test-harness", "true");
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(read(path.join(mac.hereCaptures, "still.png")), "still there");
  assert.equal(read(path.join(mac.hereCaptures, "video.mov")), "video there");
  assert.match(ran.stderr, new RegExp(`brought back ${path.join(mac.hereCaptures, "still.png")}`));
  assert.ok(!fs.existsSync(path.join(mac.thereCaptures, "still.png")), "moved, not copied");
  // Unfinished: left there, and nothing of it here.
  assert.equal(read(path.join(mac.thereCaptures, ".unfinished", "recording.mov")), "recording there");
  assert.ok(!fs.existsSync(path.join(mac.hereCaptures, "recording.mov")));
  assert.ok(!fs.existsSync(path.join(mac.hereCaptures, ".unfinished")));
  // A name this Mac has: neither copy changes, and remote.sh says so.
  assert.equal(read(path.join(mac.hereCaptures, "same.png")), "same here");
  assert.equal(read(path.join(mac.thereCaptures, "same.png")), "same there");
  assert.match(ran.stderr, /same\.png on stand-in is also here; left there/);
});

test("remote.sh with no captures on the remote brings nothing back and keeps the command's status", (t) => {
  const mac = macs(t);
  const ran = run(mac, "ableton-live-test-harness", "sh", "-c", "exit 4");
  assert.equal(ran.status, 4, ran.stderr);
  assert.doesNotMatch(ran.stderr, /brought back|could not/);
});

test("remote.sh that can't list the remote's captures says so, leaves them there, and keeps the command's status and logs", (t) => {
  const mac = macs(t);
  mac.write(path.join(mac.thereCaptures, "still.png"), "still there");
  const ran = mac.runWith({ SSH_FAILS: "captures.js finished" }, "ableton-live-test-harness",
    "sh", "-c", "mkdir -p tests/live/logs; echo log > tests/live/logs/run.log; exit 5");
  assert.equal(ran.status, 5, ran.stderr);
  assert.match(ran.stderr, /could not list the remote's captures/);
  assert.equal(read(path.join(mac.thereCaptures, "still.png")), "still there");
  assert.ok(!fs.existsSync(path.join(mac.hereCaptures, "still.png")));
  assert.equal(read(mac.at("here", "dev", "ableton-live-test-harness", "tests", "live", "logs", "run.log")), "log\n");
});

test("remote.sh whose rsync of the captures fails says so, deletes nothing on the remote, and keeps the command's status", (t) => {
  const mac = macs(t);
  mac.write(path.join(mac.thereCaptures, "still.png"), "still there");
  const ran = mac.runWith({ RSYNC_FAILS: "--files-from" }, "ableton-live-test-harness", "sh", "-c", "exit 6");
  assert.equal(ran.status, 6, ran.stderr);
  assert.match(ran.stderr, /could not bring the remote's captures back/);
  assert.doesNotMatch(ran.stderr, /brought back/);
  assert.equal(read(path.join(mac.thereCaptures, "still.png")), "still there");
});

test("remote.sh names each capture it brought back when it couldn't bring back all of them, and leaves the rest there", (t) => {
  const mac = macs(t);
  mac.write(path.join(mac.thereCaptures, "moved.png"), "moved");
  const locked = path.join(mac.thereCaptures, "locked.png");
  mac.write(locked, "locked");
  // A file rsync can't read fails it, after it has copied the others here (openrsync then
  // leaves them on the remote too).
  fs.chmodSync(locked, 0o000);
  const ran = run(mac, "ableton-live-test-harness", "true");
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(read(path.join(mac.hereCaptures, "moved.png")), "moved");
  assert.match(ran.stderr, new RegExp(`brought back ${path.join(mac.hereCaptures, "moved.png")}`));
  assert.match(ran.stderr, /could not bring the remote's captures back from stand-in, or not all of them/);
  assert.ok(fs.existsSync(locked), "left there");
  assert.ok(!fs.existsSync(path.join(mac.hereCaptures, "locked.png")));
});
