"use strict";

// remote.sh with two local folders standing in for the two Macs: `ssh` and `rsync` on PATH
// are stand-ins that run the remote's side in a folder of its own, as its home.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

// The two Macs, with this Mac's harness clone at `clone` (path parts under the test's folder;
// "here" is this Mac's home), which remote.sh is run from: it takes the folder holding the
// clone as the repos' folder.
function macs(t, clone = ["here", "dev", "ableton-live-test-harness"]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "remote-test-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = (...parts) => path.join(root, ...parts);
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  // The harness as remote.sh copies it: remote.sh itself, and what the remote's side runs of it.
  const remoteSh = at(...clone, "harness", "remote.sh");
  write(remoteSh, fs.readFileSync(path.join(__dirname, "..", "remote.sh")));
  write(at(...clone, "harness", "captures.js"), fs.readFileSync(path.join(__dirname, "..", "captures.js")));
  // remote.sh syncs only a git repo: a folder with a .git in it, beside the clone.
  const repo = (...parts) => fs.mkdirSync(path.join(at(...clone), "..", ...parts, ".git"), { recursive: true });
  repo(clone[clone.length - 1]);
  fs.mkdirSync(at("there"));
  return {
    at, write, repo,
    hereCaptures: at("here-tmp", "ableton-harness-captures"),
    thereCaptures: at("there-tmp", "ableton-harness-captures"),
    // remote.sh run with `words`, and `env` added to its environment.
    runWith: (env, ...words) => spawnSync("zsh", [remoteSh, ...words], {
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
  mac.repo("project");
  mac.write(mac.at("here", "dev", "project", "file.txt"), "here");
  const ran = run(mac, "project", "sh", "-c", "cat file.txt > ran.txt; mkdir -p tests/live/logs; echo log > tests/live/logs/run.log; exit 3");
  assert.equal(ran.status, 3, ran.stderr);
  assert.equal(read(mac.at("there", "dev", "project", "ran.txt")), "here");
  assert.equal(read(mac.at("here", "dev", "project", "tests", "live", "logs", "run.log")), "log\n");
  assert.ok(!fs.existsSync(mac.at("there", "dev", "project", "tests", "live", "logs", "run.log")), "moved, not copied");
});

test("remote.sh takes a repo one level down in ~/dev, and leaves the other folders of its parent on the remote alone", (t) => {
  const mac = macs(t);
  mac.repo("product", "format");
  mac.write(mac.at("here", "dev", "product", "format", "file.txt"), "here");
  mac.write(mac.at("there", "dev", "product", "other", "keep.txt"), "kept");
  const ran = run(mac, "product/format", "sh", "-c", "cat file.txt > ran.txt; mkdir -p tests/live/logs; echo log > tests/live/logs/run.log; exit 3");
  assert.equal(ran.status, 3, ran.stderr);
  assert.equal(read(mac.at("there", "dev", "product", "format", "ran.txt")), "here");
  assert.equal(read(mac.at("there", "dev", "product", "other", "keep.txt")), "kept");
  assert.equal(read(mac.at("here", "dev", "product", "format", "tests", "live", "logs", "run.log")), "log\n");
  assert.ok(!fs.existsSync(mac.at("there", "dev", "product", "format", "tests", "live", "logs", "run.log")), "moved, not copied");
});

test("remote.sh takes a repo one level down whose parent the remote doesn't have yet", (t) => {
  const mac = macs(t);
  mac.repo("product", "format");
  const ran = run(mac, "product/format", "touch", "ran.txt");
  assert.equal(ran.status, 0, ran.stderr);
  assert.ok(fs.existsSync(mac.at("there", "dev", "product", "format", "ran.txt")));
});

test("remote.sh takes the repos from the folder holding a clone of any name, and the same folder on the remote, and gives the command LIVE_HARNESS", (t) => {
  const mac = macs(t, ["here", "code", "harness-clone"]);
  mac.repo("project");
  mac.write(mac.at("here", "code", "project", "file.txt"), "here");
  const ran = run(mac, "project", "sh", "-c", 'cat file.txt > ran.txt; echo "$LIVE_HARNESS" > harness.txt');
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(read(mac.at("there", "code", "project", "ran.txt")), "here");
  assert.equal(read(mac.at("there", "code", "project", "harness.txt")), `${mac.at("there", "code", "harness-clone", "harness")}\n`);
  assert.ok(fs.existsSync(mac.at("there", "code", "harness-clone", "harness", "captures.js")), "the clone synced");
  assert.ok(!fs.existsSync(mac.at("there", "dev")));
});

test("remote.sh run from a clone outside the home folder refuses, and touches nothing on the remote", (t) => {
  const mac = macs(t, ["elsewhere", "ableton-live-test-harness"]);
  mac.repo("project");
  const ran = run(mac, "project", "touch", "ran.txt");
  assert.equal(ran.status, 2, ran.stderr);
  assert.match(ran.stderr, /^remote\.sh: the harness clone must be in a folder under your home folder/);
  assert.deepEqual(fs.readdirSync(mac.at("there")), []);
});

test("remote.sh refuses anything but a git repo in ~/dev or one level down, or a worktree, and touches nothing on the remote", (t) => {
  const mac = macs(t);
  mac.repo("product", "format");
  mac.repo("a", "b", "c");
  mac.write(mac.at("here", "dev", "folder", "file.txt"), "not a repo");
  mac.write(mac.at("there", "dev", "keep.txt"), "kept");
  // A folder holding repos, a folder that isn't one, one that doesn't exist, one too deep, and
  // paths that name a parent of a repo.
  for (const repo of ["product", "folder", "missing", "a/b/c", "", ".", "..", "./product", "product/.", "product/..",
    "../dev", "/product", "product/", "product//format"]) {
    const ran = run(mac, repo, "touch", "ran.txt");
    assert.equal(ran.status, 2, `${JSON.stringify(repo)}: ${ran.stderr}`);
    assert.match(ran.stderr, /^remote\.sh: /, JSON.stringify(repo));
  }
  assert.deepEqual(fs.readdirSync(mac.at("there", "dev")), ["keep.txt"]);
  assert.ok(!fs.existsSync(mac.at("there", "ran.txt")));
});

// A real git repo beside the clone with one commit, and a worktree of it at `worktree` (path
// parts from the repos' folder), on a branch of its own. Resolves with the worktree's commit.
function gitRepoWithWorktree(mac, repo, worktree) {
  const git = (cwd, ...args) => {
    const done = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
    return done.stdout.trim();
  };
  const here = mac.at("here", "dev", repo);
  mac.write(path.join(here, "file.txt"), "main");
  git(here, "init", "-q", "-b", "main");
  git(here, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", ".");
  git(here, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "first");
  git(here, "worktree", "add", "-q", "-b", "branch", mac.at("here", "dev", ...worktree));
  return git(mac.at("here", "dev", ...worktree), "rev-parse", "--short", "HEAD");
}

test("remote.sh runs a worktree of a repo, with git working in the remote's copy, and brings the worktree's logs back", (t) => {
  const mac = macs(t);
  const commit = gitRepoWithWorktree(mac, "project", ["project", ".worktrees", "branch"]);
  mac.write(mac.at("here", "dev", "project", ".worktrees", "branch", "file.txt"), "worktree");
  const ran = run(mac, "project/.worktrees/branch", "sh", "-c",
    "cat file.txt > ran.txt; git rev-parse --short HEAD > commit.txt; git status --porcelain -- file.txt > status.txt; "
    + "mkdir -p tests/live/logs; echo log > tests/live/logs/run.log");
  assert.equal(ran.status, 0, ran.stderr);
  const there = mac.at("there", "dev", "project", ".worktrees", "branch");
  // The stand-in remote shares this disk, where this Mac's path would resolve too: the remote's
  // .git must name the remote's copy.
  assert.equal(read(path.join(there, ".git")), `gitdir: ${mac.at("there", "dev", "project", ".git", "worktrees", "branch")}\n`);
  assert.equal(read(path.join(there, "ran.txt")), "worktree");
  assert.equal(read(path.join(there, "commit.txt")), `${commit}\n`);
  assert.equal(read(path.join(there, "status.txt")), " M file.txt\n", "the uncommitted change is seen there");
  assert.equal(read(mac.at("here", "dev", "project", ".worktrees", "branch", "tests", "live", "logs", "run.log")), "log\n");
  assert.ok(!fs.existsSync(path.join(there, "tests", "live", "logs", "run.log")), "moved, not copied");
  // This Mac's worktree still names its git folder by this Mac's path.
  assert.match(read(mac.at("here", "dev", "project", ".worktrees", "branch", ".git")), new RegExp(`gitdir: ${mac.at("here")}`));
});

test("remote.sh runs a worktree beside the clone, its repo's .git copied with it", (t) => {
  const mac = macs(t);
  const commit = gitRepoWithWorktree(mac, "project", ["project-branch"]);
  const ran = run(mac, "project-branch", "sh", "-c", "git rev-parse --short HEAD > commit.txt");
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(read(mac.at("there", "dev", "project-branch", "commit.txt")), `${commit}\n`);
  assert.equal(read(mac.at("there", "dev", "project-branch", ".git")), `gitdir: ${mac.at("there", "dev", "project", ".git", "worktrees", "project-branch")}\n`);
});

test("remote.sh's sync of a repo leaves the logs of a worktree inside it on the remote", (t) => {
  const mac = macs(t);
  mac.repo("project");
  const log = mac.at("there", "dev", "project", ".worktrees", "branch", "tests", "live", "logs", "run.log");
  mac.write(log, "log there");
  const ran = run(mac, "project", "true");
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(read(log), "log there");
});

test("remote.sh refuses a worktree whose repo isn't beside the clone, and touches nothing on the remote", (t) => {
  const mac = macs(t);
  gitRepoWithWorktree(mac, "project", ["project", ".worktrees", "branch"]);
  fs.renameSync(mac.at("here", "dev", "project"), mac.at("here", "elsewhere"));
  fs.mkdirSync(mac.at("here", "dev", "lone"));
  fs.writeFileSync(mac.at("here", "dev", "lone", ".git"), `gitdir: ${mac.at("here", "elsewhere", ".git", "worktrees", "branch")}\n`);
  const ran = run(mac, "lone", "touch", "ran.txt");
  assert.equal(ran.status, 2, ran.stderr);
  assert.match(ran.stderr, /^remote\.sh: .*is a worktree whose repo isn't a git repo in/);
  assert.deepEqual(fs.readdirSync(mac.at("there")), []);
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
