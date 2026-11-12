"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const { checkLocation, machineLabel } = require("../run-log.js");

const RUN_LOG = path.join(__dirname, "..", "run-log.js");
const LIVE = path.join(__dirname, "..", "live.js");

function repoWith(t, relative, source) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-log-")));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const script = path.join(repo, relative);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, source);
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init");
  git("add", ".");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-m", "start");
  return { repo, script };
}

const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

function logs(repo) {
  const folder = path.join(repo, "tests", "live", "logs");
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).sort().map((name) => ({
    name,
    text: fs.readFileSync(path.join(folder, name), "utf8"),
  }));
}

const started = `require(${JSON.stringify(RUN_LOG)}).startRunLog();\n`;

test("checkLocation finds the repo and the name inside tests/live", () => {
  assert.deepEqual(checkLocation("/a/repo/tests/live/sub/x.js"), { repo: "/a/repo", name: "sub/x.js" });
  assert.equal(checkLocation("/a/repo/harness/doctor.js"), null);
  assert.equal(checkLocation("/a/repo/harness/tests/live.test.js"), null);
});

test("machineLabel names the remote Mac remote and any other machine local", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "run-log-local-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, "local.json");
  fs.writeFileSync(file, JSON.stringify({ remote: "user@second-mac" }));
  assert.equal(machineLabel("second-mac", file), "remote");
  assert.equal(machineLabel("Second-Mac.local", file), "remote");
  assert.equal(machineLabel("first-mac.local", file), "local");
  fs.writeFileSync(file, JSON.stringify({ remote: "second-mac.example.net" }));
  assert.equal(machineLabel("second-mac", file), "remote");
  fs.writeFileSync(file, "{}");
  assert.equal(machineLabel("second-mac", file), "local");
  assert.equal(machineLabel("second-mac", path.join(folder, "missing.json")), "local");
});

test("a run saves its header, its output and its exit code, and still prints", (t) => {
  const { repo, script } = repoWith(t, "tests/live/sub/check.js",
    `${started}console.log("PASS one");\nconsole.error("FAIL two");\nprocess.exitCode = 1;\n`);
  const result = run(script, "--tempo", "97");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "PASS one\n");
  assert.equal(result.stderr, "FAIL two\n");
  const saved = logs(repo);
  assert.equal(saved.length, 1);
  assert.match(saved[0].name, /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}-sub-check\.txt$/);
  const commit = execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(saved[0].text, /^script: tests\/live\/sub\/check\.js\nargs: --tempo 97\nmachine: (local|remote)\nstarted: .+\n/);
  assert.ok(saved[0].text.includes(`commit: ${commit}\nuncommitted: no\n\nPASS one\nFAIL two\n\nexit: 1\n`), saved[0].text);
});

test("the second start in a run adds nothing", (t) => {
  const { repo, script } = repoWith(t, "tests/live/check.js", `${started}${started}console.log("once");\n`);
  run(script);
  const saved = logs(repo);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text.match(/once/g).length, 1);
});

test("an uncaught error is saved with its message", (t) => {
  const { repo, script } = repoWith(t, "tests/live/check.js", `${started}throw new Error("broke here");\n`);
  assert.equal(run(script).status, 1);
  const [{ text }] = logs(repo);
  assert.match(text, /Error: broke here/);
  assert.match(text, /\nexit: 1\n$/);
});

test("a killed run has no exit line", (t) => {
  const { repo, script } = repoWith(t, "tests/live/check.js",
    `${started}console.log("before");\nprocess.kill(process.pid, "SIGKILL");\nsetTimeout(() => {}, 5000);\n`);
  run(script);
  const [{ text }] = logs(repo);
  assert.match(text, /before\n/);
  assert.doesNotMatch(text, /exit:/);
});

test("uncommitted counts code changes and not earlier logs", (t) => {
  const { repo, script } = repoWith(t, "tests/live/check.js", started);
  run(script);
  run(script);
  assert.match(logs(repo)[1].text, /uncommitted: no\n/);
  fs.writeFileSync(path.join(repo, "changed.txt"), "x");
  run(script);
  assert.match(logs(repo)[2].text, /uncommitted: yes\n/);
});

test("a script outside tests/live saves nothing", (t) => {
  const { repo, script } = repoWith(t, "harness/tool.js", `${started}console.log("tool");\n`);
  assert.equal(run(script).stdout, "tool\n");
  assert.deepEqual(logs(repo), []);
});

test("connect starts the log", (t) => {
  const { repo, script } = repoWith(t, "tests/live/check.js",
    `require(${JSON.stringify(LIVE)}).connect({ replyPort: 0 }).then((live) => {
       console.log("connected");
       live.close();
     });\n`);
  assert.equal(run(script).status, 0);
  const [{ text }] = logs(repo);
  assert.match(text, /connected\n\nexit: 0\n$/);
});
