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

// ── Helpers ───────────────────────────────────────────────────────────

function runSaveTasks(args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SAVE_TASKS_SCRIPT].concat(args), {
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

function createTempDir(prefix = "save-tasks-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
      assert.match(res.stdout, /\.x-skills\/tasks\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Directory creation and output path ──────────────────────────────

describe("save-tasks.js — directory creation", () => {
  it("creates .x-skills/tasks/ directory in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveTasks(["--epic", "feature-a"], tmpDir);
      const tasksDir = path.join(tmpDir, ".x-skills", "tasks");
      assert.ok(fs.existsSync(tasksDir), `Directory should exist: ${tasksDir}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates a task subdirectory with the epic slug", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "feature-a"], tmpDir);
      assert.equal(res.code, 0);

      const fullPath = res.stdout.trim();
      assert.ok(fs.existsSync(fullPath), `Directory should exist: ${fullPath}`);
      assert.ok(fs.statSync(fullPath).isDirectory(), "Output path must be a directory");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes epic name in the directory name", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "my-cool-topic"], tmpDir);
      assert.equal(res.code, 0);
      const fullPath = res.stdout.trim();
      assert.match(path.basename(fullPath), /my-cool-topic$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes date stamp in the directory name", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveTasks(["--epic", "dated"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "tasks"));
      assert.match(dirContents[0], /^\d{2}-\d{2}-\d{4}-\d{2}:\d{2}-dated$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom date stamp when provided", async () => {
    const tmpDir = createTempDir();
    try {
      await runSaveTasks(["--epic", "custom-date", "--date", "2099-12-31T2359"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "tasks"));
      assert.match(dirContents[0], /^[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9]:[0-9][0-9]-custom-date$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")), "Directory should not exist before run");
      await runSaveTasks(["--epic", "nested"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "tasks")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the tasks directory", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "stdout-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/tasks\//);
      assert.match(res.stdout, /stdout-test$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Directory is empty (zero meta files) ────────────────────────────

describe("save-tasks.js — zero meta files", () => {
  it("creates an empty directory with no meta files", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "empty-check"], tmpDir);
      assert.equal(res.code, 0);

      const fullPath = res.stdout.trim();
      const contents = fs.readdirSync(fullPath);
      assert.equal(contents.length, 0, "Task directory must be empty (no meta files)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("auto-resolves epic path when epic file exists with matching slug", async () => {
    const tmpDir = createTempDir();
    try {
      const saveEpicScript = path.join(__dirname, "..", "skills", "x-epic", "scripts", "save-epic.js");
      await new Promise((resolve, reject) => {
        const child = spawn("node", [saveEpicScript, "--topic", "auto-link"], { cwd: tmpDir });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`save-epic failed with ${code}`)));
      });

      const tasksRes = await runSaveTasks(["--epic", "auto-link"], tmpDir);
      assert.equal(tasksRes.code, 0);
      assert.match(tasksRes.stderr, /resolved epic path/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("logs 'no epic file found' when no epic file exists for topic", async () => {
    const tmpDir = createTempDir();
    try {
      const tasksRes = await runSaveTasks(["--epic", "orphan"], tmpDir);
      assert.equal(tasksRes.code, 0);
      assert.match(tasksRes.stderr, /no epic file found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Logging (stderr verification) ───────────────────────────────────

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
    const res = await runSaveTasks(["--epic", "log-path"]);
    assert.match(res.stderr, /\.x-skills\/tasks\//);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSaveTasks(["--epic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean);
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
      const saveEpicScript = path.join(__dirname, "..", "skills", "x-epic", "scripts", "save-epic.js");
      await new Promise((resolve, reject) => {
        const child = spawn("node", [saveEpicScript, "--topic", "link-test"], { cwd: tmpDir });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`save-epic failed with ${code}`)));
      });

      const res = await runSaveTasks(["--epic", "link-test"], tmpDir);
      assert.match(res.stderr, /resolved epic path/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("logs 'no epic file found' when no matching epic exists", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSaveTasks(["--epic", "orphan-tasks"], tmpDir);
      assert.match(res.stderr, /no epic file found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
