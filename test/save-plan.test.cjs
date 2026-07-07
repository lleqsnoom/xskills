"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SAVE_PLAN_SCRIPT = path.join(
  __dirname,
  "..",
  "skills",
  "x-plan",
  "scripts",
  "save-plan.js"
);

// ── Helpers ───────────────────────────────────────────────────────────

function runSavePlan(args = [], cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SAVE_PLAN_SCRIPT].concat(args), {
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

function createTempDir(prefix = "save-plan-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── Argument validation ─────────────────────────────────────────────

describe("save-plan.js — argument validation", () => {
  it("exits with code 1 when --topic is missing", async () => {
    const res = await runSavePlan([]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/);
    assert.match(res.stderr, /--topic/);
  });

  it("accepts --topic with short flag -t", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSavePlan(["-t", "plan-a"], tmpDir);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /\.x-skills\/plans\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── File creation and output path ───────────────────────────────────

describe("save-plan.js — file creation", () => {
  it("creates directory .x-skills/plans/ in cwd", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "plan-a"], tmpDir);
      assert.ok(
        fs.existsSync(path.join(tmpDir, ".x-skills", "plans")),
        ".x-skills/plans/ should exist"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("writes a non-empty plan file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSavePlan(["--topic", "plan-a"], tmpDir);
      assert.equal(res.code, 0);

      const fullPath = res.stdout.trim();
      assert.ok(fs.existsSync(fullPath), `File should exist: ${fullPath}`);

      const content = fs.readFileSync(fullPath, "utf8");
      assert.ok(content.length > 0, "File must not be empty");
      assert.match(content, /# Plan — plan-a/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes topic name in the filename", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "my-cool-plan"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      assert.match(dirContents[0], /my-cool-plan\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("includes date stamp in the filename", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "dated-plan"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      assert.match(dirContents[0], /^\d{4}-\d{2}-\d{2}T\d{4}-dated-plan\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom date stamp when provided", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "cdp", "--date", "2099-12-31T2359"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      assert.match(dirContents[0], /^2099-12-31T2359-cdp\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("uses custom branch in the header", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "bp", "--branch", "feature/plan"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plans", dirContents[0]),
        "utf8"
      );
      assert.ok(content.includes("feature/plan"), `Expected branch in header, got:\n${content}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("stdout contains the full path to the plan file", async () => {
    const tmpDir = createTempDir();
    try {
      const res = await runSavePlan(["--topic", "path-test"], tmpDir);
      assert.match(res.stdout, /\.x-skills\/plans\//);
      assert.match(res.stdout, /path-test\.md$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates nested .x-skills directory if it does not exist", async () => {
    const tmpDir = createTempDir();
    try {
      assert.ok(!fs.existsSync(path.join(tmpDir, ".x-skills")), "Should not exist before");
      await runSavePlan(["--topic", "nested-plan"], tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, ".x-skills", "plans")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Plan content structure ──────────────────────────────────────────

describe("save-plan.js — plan file content", () => {
  it("writes a header template with Date and Branch fields", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "content-plan"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plans", dirContents[0]),
        "utf8"
      );

      assert.match(content, /# Plan — content-plan/);
      assert.match(content, /\*\*Date:\*\*/);
      assert.match(content, /\*\*Branch:\*\*/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("plan file ends with a trailing newline after the separator", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "newline-plan"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plans", dirContents[0]),
        "utf8"
      );
      assert.match(content, /---\n\n$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("header contains the correct topic name after # Plan —", async () => {
    const tmpDir = createTempDir();
    try {
      await runSavePlan(["--topic", "exact-plan"], tmpDir);
      const dirContents = fs.readdirSync(path.join(tmpDir, ".x-skills", "plans"));
      const content = fs.readFileSync(
        path.join(tmpDir, ".x-skills", "plans", dirContents[0]),
        "utf8"
      );
      assert.match(content, /^# Plan — exact-plan$/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Logging (stderr verification) ───────────────────────────────────

describe("save-plan.js — logging", () => {
  it("logs each step to stderr with [x-plan] tag", async () => {
    const res = await runSavePlan(["--topic", "log-test"]);
    assert.match(res.stderr, /\[x-plan\]/);
  });

  it("logs the resolved branch to stderr", async () => {
    const res = await runSavePlan(["--topic", "log-branch"]);
    assert.match(res.stderr, /resolved branch/);
  });

  it("logs the file path to stderr", async () => {
    const res = await runSavePlan(["--topic", "log-path"]);
    assert.match(res.stderr, /\.x-skills\/plans\//);
  });

  it("logs timestamps in ISO format on each line", async () => {
    const res = await runSavePlan(["--topic", "log-ts"]);
    const lines = res.stderr.split("\n").filter(Boolean);
    for (const line of lines) {
      assert.match(
        line,
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\]/,
        `Line missing ISO timestamp: ${line}`
      );
    }
  });

  it("logs 'plan ready' at the end of successful run", async () => {
    const res = await runSavePlan(["--topic", "log-ready"]);
    assert.match(res.stderr, /plan ready/);
  });

  it("logs 'parsing arguments' at the start of every run", async () => {
    const res = await runSavePlan(["--topic", "log-parse"]);
    assert.match(res.stderr, /parsing arguments/);
  });

  it("logs 'creating directory' with the target path", async () => {
    const res = await runSavePlan(["--topic", "log-dir"]);
    assert.match(res.stderr, /creating directory:/);
  });

  it("logs 'writing plan file' with byte count", async () => {
    const res = await runSavePlan(["--topic", "log-bytes"]);
    assert.match(res.stderr, /writing plan file:/);
    assert.match(res.stderr, /\(\d+ bytes\)/);
  });

  it("does not write to stdout on error (missing topic)", async () => {
    const res = await runSavePlan([]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), "");
    assert.match(res.stderr, /Usage:/);
  });

  it("logs 'using date stamp' when custom date is provided", async () => {
    const res = await runSavePlan(["--topic", "lcd", "--date", "2099-12-31T2359"]);
    assert.match(res.stderr, /using date stamp: 2099-12-31T2359/);
  });

  it("logs 'parsing arguments' even when --topic is missing", async () => {
    const res = await runSavePlan([]);
    assert.match(res.stderr, /parsing arguments/);
  });
});
