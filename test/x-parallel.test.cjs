"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "x-parallel", "scripts", "parallel.mjs");
const MOD = pathToFileURL(SCRIPT).href;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

describe("x-parallel pure scheduling", async () => {
  const mod = await import(MOD);

  it("parseFiles extracts declared file paths and ignores prose", () => {
    const files = mod.parseFiles("**Files:** src/a.js (new), tests/a.test.js (mod)");
    assert.deepEqual(files, ["src/a.js", "tests/a.test.js"]);
    assert.deepEqual(mod.parseFiles("no files declared here"), []);
  });

  it("escapeRegExp escapes regex metacharacters", () => {
    assert.equal(mod.escapeRegExp("a.b(c)"), "a\\.b\\(c\\)");
  });

  it("slugOf sanitizes and truncates to 60 chars", () => {
    assert.equal(mod.slugOf("Task 0.1: setup"), "Task-0.1--setup");
    assert.ok(mod.slugOf("x".repeat(100)).length <= 60);
  });

  it("detectDependencies links a task to the siblings it names", () => {
    const tasks = [
      { id: "a", content: "does a" },
      { id: "b", content: "depends on a first" },
    ];
    const deps = mod.detectDependencies(tasks);
    assert.deepEqual(deps.a, []);
    assert.deepEqual(deps.b, ["a"]);
  });

  it("buildWaves puts dependent tasks in a later wave", () => {
    const tasks = [
      { id: "a", deps: [], files: [] },
      { id: "b", deps: ["a"], files: [] },
    ];
    const waves = mod.buildWaves(tasks, 4);
    assert.equal(waves.length, 2);
    assert.deepEqual(waves[0].map((t) => t.id), ["a"]);
    assert.deepEqual(waves[1].map((t) => t.id), ["b"]);
  });

  it("buildWaves serializes tasks that share a file", () => {
    const tasks = [
      { id: "a", deps: [], files: ["src/x.js"] },
      { id: "b", deps: [], files: ["src/x.js"] },
    ];
    const waves = mod.buildWaves(tasks, 4);
    const waveOf = (id) => waves.findIndex((w) => w.some((t) => t.id === id));
    assert.notEqual(waveOf("a"), waveOf("b"), "shared-file tasks must not run in the same wave");
  });

  it("buildWaves respects the concurrency limit", () => {
    const tasks = ["a", "b", "c"].map((id) => ({ id, deps: [], files: [] }));
    const waves = mod.buildWaves(tasks, 2);
    assert.ok(waves.every((w) => w.length <= 2));
    assert.equal(waves.flat().length, 3);
  });
});

describe("x-parallel CLI", () => {
  it("exits 2 when --tasks is missing", async () => {
    const res = await run([]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--tasks/);
  });

  it("exits 2 when the task directory does not exist", async () => {
    const res = await run(["--tasks", path.join(__dirname, "no-such-task-dir-xyz")]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /not found/);
  });
});
