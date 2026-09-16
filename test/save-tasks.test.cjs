"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_TASKS_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-decompose",
  "scripts",
  "save-tasks.js"
);
const SAVE_EPIC_SCRIPT = path.join(__dirname, "..", "skills", "x-epic", "scripts", "save-epic.js");

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Run a script with the given args. Without an explicit cwd it runs in a fresh
 * temp directory and cleans it up, so the suite never writes into the repo.
 */
async function runScript(script, args = [], cwd) {
  const dir = cwd || createTempDir();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("node", [script].concat(args), {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: dir,
      });
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

function runSaveTasks(args = [], cwd) {
  return runScript(SAVE_TASKS_SCRIPT, args, cwd);
}

function createTempDir(prefix = "save-tasks-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Path of the single run folder created in a temp dir. */
function runFolder(tmpDir) {
  const runsRoot = path.join(tmpDir, ".x-skills", "runs");
  return path.join(runsRoot, fs.readdirSync(runsRoot)[0]);
}

// ── Argument validation ─────────────────────────────────────────────

describe("save-tasks.js — argument validation", () => {
  it("exits with code 1 when --epic is missing", async () => {
    const res = await runSaveTasks([]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/);
    assert.match(res.stderr, /--epic/);
  });

  it("exits with code 1 when --epic is empty string", async () => {
    const res = await runSaveTasks(["--epic", ""]);
    assert.equal(res.code, 1);
  });

  it("accepts --epic with short flag -e", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["-e", "my-feature"], tmpDir);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /\.x-skills\/runs\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Directory creation ──────────────────────────────────────────────

describe("save-tasks.js — directory creation", () => {
  it("creates the run folder in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveTasks(["--epic", "feature-a"], tmpDir);
      const runsRoot = path.join(tmpDir, ".x-skills", "runs");
      assert.ok(fs.existsSync(runsRoot), `Directory should exist: ${runsRoot}`);
      assert.equal(fs.readdirSync(runsRoot).length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates a numbered tasks directory inside the run folder", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "feature-a"], tmpDir);
      assert.equal(res.code, 0);
      const fullPath = res.stdout.trim();
      assert.ok(fs.existsSync(fullPath), `Directory should exist: ${fullPath}`);
      assert.ok(fs.statSync(fullPath).isDirectory(), "Output path must be a directory");
      assert.equal(path.dirname(fullPath), runFolder(tmpDir));
      assert.equal(path.basename(fullPath), "E00-tasks");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("numbers the tasks directory after the epic", async () => {
    const tmpDir = createTempDir();
    try {
      await runScript(SAVE_EPIC_SCRIPT, ["--topic", "dated"], tmpDir);
      await runSaveTasks(["--epic", "dated"], tmpDir);
      assert.deepEqual(fs.readdirSync(runFolder(tmpDir)).sort(), ["E00-epic.md", "E01-tasks"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("reuses the tasks directory on a second run", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveTasks(["--epic", "once"], tmpDir);
      await runSaveTasks(["--epic", "once"], tmpDir);
      assert.deepEqual(fs.readdirSync(runFolder(tmpDir)), ["E00-tasks"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")));
      await runSaveTasks(["--epic", "nested"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "runs")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the tasks directory", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "stdout-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/runs\//);
      assert.match(res.stdout, /E00-tasks$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Zero meta files ─────────────────────────────────────────────────

describe("save-tasks.js — zero meta files", () => {
  it("creates an empty directory with no meta files", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "bare"], tmpDir);
      assert.deepEqual(fs.readdirSync(res.stdout.trim()), []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("auto-resolves epic path when epic file exists with matching slug", async () => {
    const tmpDir = createTempDir();
    try {
      await runScript(SAVE_EPIC_SCRIPT, ["--topic", "link-test"], tmpDir);
      const res = await runSaveTasks(["--epic", "link-test"], tmpDir);
      assert.match(res.stderr, /resolved epic path/);
      assert.match(res.stderr, /E00-epic\.md/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("logs 'no epic file found' when no epic file exists for topic", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "orphan"], tmpDir);
      assert.match(res.stderr, /no epic file found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Logging ─────────────────────────────────────────────────────────

describe("save-tasks.js — logging", () => {
  it("logs each step to stderr with [x-decompose] tag", async () => {
    const res = await runSaveTasks(["--epic", "log-test"]);
    assert.match(res.stderr, /\[x-decompose\]/);
  });

  it("logs 'parsing arguments' at the start of every run", async () => {
    const res = await runSaveTasks(["--epic", "log-parse"]);
    assert.match(res.stderr, /parsing arguments/);
  });

  it("logs the directory path to stderr", async () => {
    const res = await runSaveTasks(["--epic", "log-dir"]);
    assert.match(res.stderr, /\.x-skills\/runs\//);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSaveTasks(["--epic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean).filter((line) => !line.startsWith("Warning:"));
    for (const line of lines) {
      assert.match(
        line,
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\]/,
        `Line missing ISO timestamp: ${line}`
      );
    }
  });

  it("logs 'tasks directory ready' at the end of successful run", async () => {
    const res = await runSaveTasks(["--epic", "log-ready"]);
    assert.match(res.stderr, /tasks directory ready/);
  });

  it("does not write to stdout on error (missing --epic)", async () => {
    const res = await runSaveTasks([]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), "");
    assert.match(res.stderr, /Usage:/);
  });

  it("logs 'resolved epic path' when epic file is found", async () => {
    const tmpDir = createTempDir();
    try {
      await runScript(SAVE_EPIC_SCRIPT, ["--topic", "link-log"], tmpDir);
      const res = await runSaveTasks(["--epic", "link-log"], tmpDir);
      assert.match(res.stderr, /resolved epic path/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("logs 'no epic file found' when no matching epic exists", async () => {
    const res = await runSaveTasks(["--epic", "no-epic-here"]);
    assert.match(res.stderr, /no epic file found/);
  });
});
