"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_PLAN = path.join(__dirname, "..", "skills", "x-review", "scripts", "save-plan.js");
const X_FIX_SKILL = path.join(__dirname, "..", "skills", "x-fix", "SKILL.md");

async function runSavePlan(args, cwd) {
  const dir = cwd || fs.mkdtempSync(path.join(os.tmpdir(), "x-fix-plan-"));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("node", [SAVE_PLAN, ...args], { stdio: ["ignore", "pipe", "pipe"], cwd: dir });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  } finally {
    if (!cwd) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("x-review plan is readable by x-fix", () => {
  it("writes a numbered review plan into the run folder", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "x-fix-plan-"));
    try {
      const res = await runSavePlan(["--slug", "demo"], cwd);
      assert.equal(res.code, 0, res.stderr);

      const runsRoot = path.join(cwd, ".x-skills", "runs");
      const run = fs.readdirSync(runsRoot)[0];
      assert.match(run, /-demo$/);
      assert.deepEqual(fs.readdirSync(path.join(runsRoot, run)), ["E00-review-plan.md"]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("documents both plan kinds as the lookup", () => {
    const skill = fs.readFileSync(X_FIX_SKILL, "utf8");
    assert.match(skill, /E<nn>-fix-plan\.md/);
    assert.match(skill, /E<nn>-review-plan\.md/);
  });
});
