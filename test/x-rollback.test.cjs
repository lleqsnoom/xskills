"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT = path.join(__dirname, "..", "skills", "x-rollback", "scripts", "revert.js");

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd || process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-rollback-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);

  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);

  fs.writeFileSync(path.join(dir, "a.txt"), "two\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "second"]);

  return { dir, sha: git(dir, ["rev-parse", "HEAD"]) };
}

describe("x-rollback revert.js", () => {
  it("exits 1 with a usage error when no target is given", async () => {
    const { dir } = initRepo();
    try {
      const res = await run([], dir);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /--commit|--last/);
      assert.equal(res.stdout, "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to run on a dirty working tree", async () => {
    const { dir, sha } = initRepo();
    try {
      fs.writeFileSync(path.join(dir, "b.txt"), "uncommitted\n");
      const res = await run(["--commit", sha, "--dry-run"], dir);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /not clean/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--dry-run prints a plan and does not revert", async () => {
    const { dir, sha } = initRepo();
    try {
      const res = await run(["--commit", sha, "--dry-run"], dir);
      assert.equal(res.code, 0);
      const plan = JSON.parse(res.stdout);
      assert.equal(plan.dryRun, true);
      assert.equal(plan.sha, sha);
      assert.ok(Array.isArray(plan.files));
      assert.ok(plan.files.some((f) => f.path === "a.txt"), "impact should list a.txt");
      // HEAD must be unchanged after a dry-run
      assert.equal(git(dir, ["rev-parse", "HEAD"]), sha);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
