"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-review");
const ANALYSIS = path.join(SKILL, "scripts", "analyze-complexity.js");
const DUPLICATION = path.join(SKILL, "scripts", "check-duplication.js");
const SAVE_PLAN = path.join(SKILL, "scripts", "save-plan.js");
const CONFIG = JSON.parse(fs.readFileSync(path.join(SKILL, "assets", "config.json"), "utf8"));

function run(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...args], { stdio: ["ignore", "pipe", "pipe"], cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const FIXTURE = [
  "function trivial(x) {",
  "  return x + 1;",
  "}",
  "",
  "function branchy(items) {",
  "  let total = 0;",
  "  for (const item of items) {",
  "    if (item > 0 && item < 10) total += item;",
  "    else if (item > 100) total -= item;",
  "  }",
  "  return total;",
  "}",
  "",
].join("\n");

const DUPLICATE_FIXTURE = [
  "function a() {",
  "  const x = 1;",
  "  const y = 2;",
  "  const z = 3;",
  "  const w = 4;",
  "  return x + y + z + w;",
  "}",
  "",
  "function b() {",
  "  const x = 1;",
  "  const y = 2;",
  "  const z = 3;",
  "  const w = 4;",
  "  return x + y + z + w;",
  "}",
  "",
].join("\n");

async function withFixture(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-xreview-"));
  try {
    const file = path.join(dir, "fixture.js");
    fs.writeFileSync(file, FIXTURE);
    await fn({ dir, file });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

describe("x-review analyze-complexity", () => {
  it("reports every function in a file without crashing", async () => {
    await withFixture(async ({ file }) => {
      const res = await run(ANALYSIS, [file]);
      assert.equal(res.code, 0, `exited ${res.code}: ${res.stderr}`);
      const report = JSON.parse(res.stdout);
      assert.equal(report.summary.totalFiles, 1);
      assert.ok(report.summary.totalFunctions >= 2, "found the fixture's functions");

      const functions = report.files[0].functions;
      const names = functions.map((fn) => fn.name);
      assert.ok(names.includes("trivial") && names.includes("branchy"), `names: ${names.join(", ")}`);
      assert.ok(names.every((name) => typeof name === "string" && name.length > 0), "no anonymous entries");

      for (const fn of functions) {
        assert.ok(fn.line >= 1, `${fn.name} has a line`);
        assert.ok(fn.length >= 1, `${fn.name} has a length`);
        assert.ok(fn.complexity >= 1, `${fn.name} has a complexity`);
        assert.equal(typeof fn.paramCount, "number", `${fn.name} has a numeric param count`);
      }

      const branchy = functions.find((fn) => fn.name === "branchy");
      assert.ok(branchy.complexity > 1, "branches raise complexity above the floor");
    });
  });

  it("names the engine it used and the thresholds it applied", async () => {
    await withFixture(async ({ file }) => {
      const report = JSON.parse((await run(ANALYSIS, [file])).stdout);
      assert.ok(
        ["tree-sitter (AST-based)", "regex fallback"].includes(report.summary.language),
        `unexpected engine: ${report.summary.language}`
      );
      for (const key of ["maxComplexity", "maxLength", "maxParams"]) {
        assert.equal(
          report.summary.thresholds[key],
          CONFIG[key],
          `${key} must match assets/config.json so the plan counts with the same numbers`
        );
      }
    });
  });

  it("exits non-zero when it is given nothing to analyse", async () => {
    const res = await run(ANALYSIS, ["--root", path.join(os.tmpdir(), "xskills-no-such-dir")]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /No source files found/);
  });
});

describe("x-review save-plan", () => {
  const plan = require(SAVE_PLAN);

  const stats = {
    totalFilesAnalyzed: new Set(["a.js", "b.js"]),
    functionsHighComplexity: 3,
    functionsLong: 2,
    functionsTooManyParams: 0,
    duplicatedBlocks: 1,
    refactorSuggestions: 0,
    byType: {},
  };

  it("states the counts when every analysis ran", () => {
    const header = plan.generatePlanHeader(stats, "main", []);
    assert.match(header, /\*\*Total files analyzed:\*\* 2/);
    assert.match(header, /\*\*Functions with complexity > 5:\*\* 3/);
    assert.match(header, /\*\*Duplicated blocks found:\*\* 1/);
    assert.doesNotMatch(header, /unknown/);
  });

  it("says its counts are repo-wide, not the scope that was asked for", () => {
    const header = plan.generatePlanHeader(stats, "main", []);
    assert.match(header, /\*\*Counts below:\*\* repo-wide \(`--all`\)/, "a scoped review must not read these as its own numbers");
    const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
    assert.match(skill, /\*\*Counts below:\*\* repo-wide/, "the template an agent rewrites carries the label too");
  });

  it("never prints a zero for an analysis that failed", () => {
    const failed = [{ ok: false, script: "analyze-complexity.js", error: "Error: lines is not defined" }];
    const header = plan.generatePlanHeader({ ...stats, functionsHighComplexity: 0 }, "main", failed);
    assert.match(header, /\*\*Functions with complexity > 5:\*\* unknown — analyze-complexity\.js failed/);
    assert.match(header, /Functions longer than 20 lines:\*\* unknown/);
    assert.match(header, /Analysis incomplete/);
    assert.match(header, /Error: lines is not defined/, "the reason is in the plan, not only stderr");
    assert.match(header, /\*\*Duplicated blocks found:\*\* 1/, "the analyses that ran still report");
  });

  it("writes a plan whose header carries real numbers", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-xreview-plan-"));
    try {
      const res = await run(SAVE_PLAN, ["--output", dir]);
      assert.equal(res.code, 0, res.stderr);
      const written = fs.readFileSync(res.stdout, "utf8");
      assert.match(written, /^# Code Review — Fix Plan/m);
      assert.match(written, /\*\*Total files analyzed:\*\* [1-9]\d*/);
      assert.doesNotMatch(written, /unknown —/, "the bundled analyses should have run");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ── documented JSON shapes ───────────────────────────────────────────

describe("x-review — the JSON shapes its SKILL.md documents", () => {
  const keys = (value) => Object.keys(value).sort();

  it("emits the key sets the SKILL.md names, for both analyzers", async () => {
    await withFixture(async ({ dir, file }) => {
      const complexity = JSON.parse((await run(ANALYSIS, [file])).stdout);
      assert.deepEqual(keys(complexity), ["files", "summary"], "functions are nested in a file, never at the top level");
      assert.deepEqual(keys(complexity.files[0]), ["file", "functionCount", "functions"]);
      assert.deepEqual(keys(complexity.files[0].functions[0]), ["complexity", "issues", "length", "line", "name", "paramCount"]);
      assert.deepEqual(keys(complexity.summary), ["highComplexity", "language", "longFunctions", "thresholds", "tooManyParams", "totalFiles", "totalFunctions"]);

      const dupFile = path.join(dir, "dup.js");
      fs.writeFileSync(dupFile, DUPLICATE_FIXTURE);
      const duplication = JSON.parse((await run(DUPLICATION, [dupFile])).stdout);
      assert.deepEqual(keys(duplication), ["duplicatedBlocks", "duplicates", "totalFiles"]);
      assert.equal(typeof duplication.duplicatedBlocks, "number", "duplicatedBlocks is a count, not the block list");
      assert.ok(Array.isArray(duplication.duplicates) && duplication.duplicates.length > 0, "duplicates is the list");
      assert.deepEqual(keys(duplication.duplicates[0]), ["file", "lines", "occurrences", "sample"]);

      const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
      const documented = [
        "functions: [ { name, line, length, complexity, paramCount, issues[] } ]",
        "duplicates: [ { file, lines, occurrences[], sample } ]",
      ];
      const missing = documented.filter((shape) => !skill.includes(shape));
      assert.deepEqual(missing, [], "a shape the script emits is not the shape the SKILL.md shows");
    });
  });
});
