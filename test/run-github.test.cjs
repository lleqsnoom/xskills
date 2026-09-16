"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_EPIC = path.join(__dirname, "..", "skills", "x-epic", "scripts", "save-epic.js");
const NOTIFY = path.join(__dirname, "..", "skills", "x-implement", "scripts", "notify-github.mjs");

function runSaveEpic(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SAVE_EPIC, ...args], { stdio: ["ignore", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "run-github-"));
}

function epicContent(tmpDir) {
  const runsRoot = path.join(tmpDir, ".x-skills", "runs");
  const run = fs.readdirSync(runsRoot)[0];
  const epic = fs.readdirSync(path.join(runsRoot, run)).find((f) => f.endsWith("-epic.md"));
  return fs.readFileSync(path.join(runsRoot, run, epic), "utf8");
}

describe("epic issue field", () => {
  it("records the issue number when --issue is given", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveEpic(["--topic", "demo", "--issue", "42"], tmpDir);
      assert.equal(res.code, 0, res.stderr);
      assert.match(epicContent(tmpDir), /^issue:\s+42$/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes an empty issue line when the flag is absent", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveEpic(["--topic", "demo"], tmpDir);
      assert.match(epicContent(tmpDir), /^issue:\s*$/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function runNotify(runDir, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [NOTIFY, "--run", runDir], { stdio: ["ignore", "pipe", "pipe"], cwd });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim() }));
  });
}

function makeRun(tmpDir, { issue = "42", summary = true } = {}) {
  const runDir = path.join(tmpDir, ".x-skills", "runs", "2026-09-15-2130-R01-demo");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "E00-epic.md"), `goal:  x\nspec:  y\nissue:        ${issue}\n`);
  if (summary) fs.writeFileSync(path.join(runDir, "E02-summary.md"), "# Summary\n");
  return runDir;
}

describe("x-implement notify-github", () => {
  it("skips when the run has no summary artifact", async () => {
    const tmpDir = createTempDir();
    try {
      const runDir = makeRun(tmpDir, { summary: false });
      const res = await runNotify(runDir, tmpDir);
      assert.equal(res.code, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.action, "skip");
      assert.match(parsed.reason, /summary/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips when the epic carries no issue number", async () => {
    const tmpDir = createTempDir();
    try {
      const runDir = makeRun(tmpDir, { issue: "" });
      const parsed = JSON.parse((await runNotify(runDir, tmpDir)).stdout);
      assert.equal(parsed.action, "skip");
      assert.match(parsed.reason, /issue/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips when the repo has no origin remote", async () => {
    const tmpDir = createTempDir();
    try {
      const runDir = makeRun(tmpDir);
      const parsed = JSON.parse((await runNotify(runDir, tmpDir)).stdout);
      assert.equal(parsed.action, "skip");
      assert.match(parsed.reason, /origin/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("offers a comment once the run and the remote are ready", async () => {
    const tmpDir = createTempDir();
    try {
      const runDir = makeRun(tmpDir);
      spawnSync("git", ["init", "-q"], { cwd: tmpDir });
      spawnSync("git", ["remote", "add", "origin", "https://example.com/x.git"], { cwd: tmpDir });

      const parsed = JSON.parse((await runNotify(runDir, tmpDir)).stdout);
      if (parsed.action === "comment") {
        assert.equal(parsed.issue, "42");
        assert.equal(path.basename(parsed.file), "E02-summary.md");
      } else {
        assert.equal(parsed.action, "skip");
        assert.match(parsed.reason, /gh is not installed/);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("makes no network call", () => {
    const source = fs.readFileSync(NOTIFY, "utf8");
    assert.ok(!/fetch\(|https?:\/\//.test(source), "the helper must not call the network");
  });

  it("exits 2 without --run", () => {
    return new Promise((resolve, reject) => {
      const child = spawn("node", [NOTIFY], { stdio: ["ignore", "ignore", "ignore"] });
      child.on("error", reject);
      child.on("close", (code) => {
        assert.equal(code, 2);
        resolve();
      });
    });
  });
});
