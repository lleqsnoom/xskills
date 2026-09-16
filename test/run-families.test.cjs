"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SKILLS = path.join(__dirname, "..", "skills");

const STEPS = [
  { name: "plan", script: ["x-plan", "scripts", "save-spec.js"], args: ["--topic", "fam"] },
  { name: "analysis", script: ["x-anal", "scripts", "scenario.mjs"], args: ["start", "--slug", "fam"] },
  {
    name: "research",
    script: ["x-research", "scripts", "state.mjs"],
    args: ["start", "--slug", "fam", "--metric", "score", "--target", "1", "--evaluator", "node -e 1"],
  },
  { name: "critique", script: ["x-roast", "scripts", "save-report.mjs"], args: ["--slug", "fam"] },
  { name: "humanize", script: ["x-humanize", "scripts", "save-report.mjs"], args: ["--slug", "fam"] },
  { name: "article", script: ["x-essay", "scripts", "state.mjs"], args: ["start", "--slug", "fam"] },
];

function runStep(step, cwd) {
  const script = path.join(SKILLS, ...step.script);
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...step.args], { stdio: ["ignore", "pipe", "pipe"], cwd });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });
}

async function runAll(cwd) {
  const results = [];
  for (const step of STEPS) {
    const res = await runStep(step, cwd);
    results.push({ name: step.name, ...res });
  }
  return results;
}

describe("text families — one run folder", () => {
  it("numbers every family in execution order in a single run", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "run-families-"));
    try {
      const results = await runAll(cwd);
      for (const res of results) {
        assert.equal(res.code, 0, `${res.name} failed: ${res.stderr}`);
      }

      const runsRoot = path.join(cwd, ".x-skills", "runs");
      const runs = fs.readdirSync(runsRoot);
      assert.equal(runs.length, 1, "every family must join the same run");
      assert.match(runs[0], /^\d{4}-\d{2}-\d{2}-\d{4}-R01-fam$/);

      const artifacts = fs.readdirSync(path.join(runsRoot, runs[0])).sort();
      assert.deepEqual(artifacts, [
        "E00-plan.md",
        "E01-analysis.md",
        "E02-research",
        "E03-critique.md",
        "E04-humanize.md",
        "E05-article",
        "memory.md",
        "state.json",
      ]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps every artifact name free of a colon", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "run-families-"));
    try {
      await runAll(cwd);
      const runsRoot = path.join(cwd, ".x-skills", "runs");
      for (const run of fs.readdirSync(runsRoot)) {
        assert.ok(!run.includes(":"), `run folder contains a colon: ${run}`);
        for (const artifact of fs.readdirSync(path.join(runsRoot, run))) {
          assert.ok(!artifact.includes(":"), `artifact contains a colon: ${artifact}`);
        }
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("starts a fresh run for a different slug", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "run-families-"));
    try {
      await runStep({ script: ["x-roast", "scripts", "save-report.mjs"], args: ["--slug", "one"] }, cwd);
      await runStep({ script: ["x-roast", "scripts", "save-report.mjs"], args: ["--slug", "two"] }, cwd);

      const runs = fs.readdirSync(path.join(cwd, ".x-skills", "runs")).sort();
      assert.equal(runs.length, 2);
      assert.ok(runs[0].endsWith("-one"), runs[0]);
      assert.ok(runs[1].endsWith("-two"), runs[1]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
