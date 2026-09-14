"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT = path.join(__dirname, "..", "skills", "x-migrate", "scripts", "analyze.js");
const migrate = require(SCRIPT);

// ── Helpers ───────────────────────────────────────────────────────────

function runAnalyze(args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT].concat(args), {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd || process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function tempDirWithPkg(pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-migrate-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

// ── Pure functions ───────────────────────────────────────────────────

describe("x-migrate analyze.js — pure functions", () => {
  it("parseArgs reads --target, --source, --output and --all", () => {
    const args = migrate.parseArgs(["node", "analyze.js", "--target", "react@19", "--source", "react@18", "--output", "plan.md"]);
    assert.deepEqual(args, { target: "react@19", source: "react@18", outputFile: "plan.md", allDeps: false });

    const all = migrate.parseArgs(["node", "analyze.js", "--all"]);
    assert.equal(all.allDeps, true);
    assert.equal(all.target, null);
  });

  it("parseArgs accepts a bare positional package as the target", () => {
    const args = migrate.parseArgs(["node", "analyze.js", "typescript@5"]);
    assert.equal(args.target, "typescript@5");
  });

  it("getCurrentVersions strips range prefixes from deps and devDeps", () => {
    const versions = migrate.getCurrentVersions({
      dependencies: { express: "^4.18.2" },
      devDependencies: { typescript: "~5.1.6", react: "18.2.0" },
    });
    assert.deepEqual(versions, { express: "4.18.2", typescript: "5.1.6", react: "18.2.0" });
  });

  it("generateMigrationPlan resolves the source version from currentVersions", () => {
    const plan = migrate.generateMigrationPlan("express@5", null, { express: "4.18.2" });
    assert.ok(plan.length >= 1);
    for (const step of plan) {
      assert.equal(step.package, "express");
      assert.equal(step.toVersion, "express@5");
      assert.ok(typeof step.fix === "string" && step.fix.length > 0);
      assert.equal(step.automated, step.severity === "minor" || step.severity === "feature");
    }
  });

  it("generateMigrationPlan marks an unknown package for manual review", () => {
    const plan = migrate.generateMigrationPlan("svelte@5", null, {});
    assert.equal(plan.length, 1);
    assert.match(plan[0].message, /Manual review required/);
  });

  it("generateAllPlan only reports packages present in the project", () => {
    const plan = migrate.generateAllPlan({ express: "4.18.2" });
    assert.ok(plan.length >= 1);
    assert.ok(plan.every((step) => step.package === "express"));
    assert.equal(plan[0].toVersion, "express@5.0.0");
  });

  it("formatMarkdownPlan renders a heading per package and a heading for an empty plan", () => {
    const plan = migrate.generateMigrationPlan("express@5", null, { express: "4.18.2" });
    const md = migrate.formatMarkdownPlan(plan, { packagesAnalyzed: 1 });
    assert.match(md, /# Migration Plan/);
    assert.match(md, /## express/);

    const empty = migrate.formatMarkdownPlan([], { packagesAnalyzed: 1 });
    assert.match(empty, /No migration steps identified/);
  });
});

// ── CLI ──────────────────────────────────────────────────────────────

describe("x-migrate analyze.js — CLI", () => {
  it("prints a JSON plan to stdout and markdown to stderr (happy path)", async () => {
    const dir = tempDirWithPkg({ dependencies: { express: "^4.18.2" } });
    try {
      const res = await runAnalyze(["--target", "express@5"], dir);
      assert.equal(res.code, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.packagesAnalyzed, 1);
      assert.ok(Array.isArray(parsed.plan) && parsed.plan.length >= 1);
      assert.match(res.stderr, /# Migration Plan/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the markdown plan to --output and exits 0", async () => {
    const dir = tempDirWithPkg({ dependencies: { express: "^4.18.2" } });
    try {
      const out = path.join(dir, "migration-plan.md");
      const res = await runAnalyze(["--all", "--output", out], dir);
      assert.equal(res.code, 0);
      assert.ok(fs.existsSync(out));
      assert.match(fs.readFileSync(out, "utf8"), /# Migration Plan/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 with a usage error when neither --target nor --all is given", async () => {
    const dir = tempDirWithPkg({ dependencies: { express: "^4.18.2" } });
    try {
      const res = await runAnalyze([], dir);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /--target|--all/);
      assert.equal(res.stdout.trim(), "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when no package.json exists in the working directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-migrate-empty-"));
    try {
      const res = await runAnalyze(["--target", "express@5"], dir);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /package\.json/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
